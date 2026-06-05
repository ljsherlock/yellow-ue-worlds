#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CreatureDef.h"
#include "SceneCreature.generated.h"

class UCapsuleComponent;
class USkeletalMeshComponent;
class ACreatureDirector;

/** What the autonomy (utility) layer is currently doing when no explicit order
 *  is active. Explicit director commands suspend autonomy (see bExplicitOrder). */
UENUM()
enum class EAutoAction : uint8
{
	None,
	Graze,
	SeekWater,
	Drinking,
	Resting,
};

/**
 * ASceneCreature is the generic, kinematic "living thing" the brain drives. It
 * is deliberately species-agnostic: a skeletal mesh + a tiny movement/state
 * machine. All the elephant-specific detail (which mesh, which clips) arrives at
 * spawn time via FCreatureDef, so the same class later carries lions, zebras —
 * even the jeep (a creature whose only "animation" is translation).
 *
 * Movement is kinematic (no physics, no NavMesh): we lerp toward a goal each
 * tick and line-trace to stick to the landscape. This is deterministic (ideal
 * for a *directed* scene), cheap, and reusable for vehicles. NavMesh-based free
 * roaming can be added later behind the same MoveTo() entry point.
 *
 * Animation: if a def supplies an AnimBP we hand control to it (it reads
 * CurrentState/CurrentSpeed); otherwise we play single-node clips from the
 * state->clip map so a raw imported pack animates with zero in-editor authoring.
 */
UCLASS()
class YELLOWWORLD_API ASceneCreature : public AActor
{
	GENERATED_BODY()

public:
	ASceneCreature();

	/** Root capsule — blocks other creatures while the mesh stays visual-only. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Creature")
	TObjectPtr<UCapsuleComponent> Capsule;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Creature")
	TObjectPtr<USkeletalMeshComponent> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	FName CreatureId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	FName CreatureType;

	/** Current state name (idle/walk/run/drink/...). Exposed so a future AnimBP can read it. */
	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	FName CurrentState = TEXT("idle");

	/** Planar speed in cm/s, exposed for AnimBP blendspaces. */
	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	float CurrentSpeed = 0.f;

	/** True once the creature has stopped at its goal (path/target finished, or
	 *  halted at the shoreline). Cleared whenever a new movement order is given.
	 *  This is the read-back the brain/sim polls instead of guessing with sleeps. */
	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	bool bArrived = false;

	/** True when the stop was specifically the shoreline halt (i.e. it reached the
	 *  water's edge), as opposed to a plain goal/path completion. */
	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	bool bAtWater = false;

	// --- Drives (minimal ecosystem substrate) ---------------------------------
	// 0 (sated/rested) .. 1 (desperate/exhausted). Seeded by the brain at spawn
	// (e.g. "they walked far" -> high thirst) and then evolve every tick. The
	// utility layer below reads them to choose autonomous actions.
	UPROPERTY(BlueprintReadOnly, Category = "Creature|Drives")
	float Thirst = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Creature|Drives")
	float Fatigue = 0.f;

	/** When true, the creature acts on its own drives whenever it has no explicit
	 *  order in progress. Set false for a fully hand-scripted scene. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	bool bAutonomous = true;

	// Per-second drive evolution + utility thresholds (tunable, sane defaults).
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float ThirstRisePerSec = 0.008f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float ThirstMoveBonusPerSec = 0.010f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float ThirstDrinkDropPerSec = 0.220f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float FatigueWalkRisePerSec = 0.010f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float FatigueRunRisePerSec = 0.028f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float FatigueRestDropPerSec = 0.045f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float ThirstSeekThreshold = 0.60f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float ThirstSatedThreshold = 0.12f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float FatigueRestThreshold = 0.80f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	float FatigueRestedThreshold = 0.20f;

	/** Set one drive ("thirst"/"fatigue") to a 0..1 value (brain seeds these). */
	void SetDrive(FName Drive, float Value);

	/** Lake centre (XY) + surface Z + planar radius (cm). Thirsty creatures path
	 *  to the nearest rim point on the circle, and only halt at the shoreline when
	 *  they are within that radius — not at random cliffs elsewhere on the map. */
	void SetWaterSource(const FVector& Location, float Radius);

	/** Apply a catalog row (mesh, anim set, speeds, scale). Safe if soft refs are unset. */
	void ApplyDef(const FCreatureDef& Def);

	/** The director that spawned us, used to report world events for the push
	 *  event channel (DrainEvents). Weak so it never keeps the director alive. */
	void SetOwnerDirector(ACreatureDirector* InDirector);

	// --- behaviour API, driven by ACreatureDirector verbs ---------------------
	void MoveTo(const FVector& World, float Speed);
	void SetPath(const TArray<FVector>& Points, bool bLoop, float Speed);
	void SetStateName(FName State);
	void PlayClip(FName StateKey, bool bLoop);
	void SetLeader(ASceneCreature* InLeader, float Distance);
	void StartWander(const FVector& Center, float Radius, float Speed);

	/** Surface height (cm) of nearby water; the creature stops at the shoreline
	 *  rather than walking down the collision-less lakebed. */
	void SetWaterLevel(float SurfaceZ);

	virtual void Tick(float Dt) override;

protected:
	// Resolved (loaded) clips, keyed by state name, for the single-node path.
	UPROPERTY() TMap<FName, TObjectPtr<UAnimSequenceBase>> Clips;
	bool bUsingAnimBP = false;

	// Tuning copied from the def at spawn.
	float WalkSpeed = 250.f;
	float RunSpeed = 600.f;
	float TurnSpeedDeg = 120.f;
	float AcceptanceRadius = 150.f;
	float MeshYawOffset = 0.f;

	// Movement goal resolution (priority: leader > wander > path > single target).
	bool bHasTarget = false;
	FVector TargetLoc = FVector::ZeroVector;
	float DesiredSpeed = 0.f;

	TArray<FVector> Path;
	int32 PathIndex = 0;
	bool bLoopPath = false;

	TWeakObjectPtr<ASceneCreature> Leader;
	float FollowDistance = 600.f;

	bool bWander = false;
	FVector WanderCenter = FVector::ZeroVector;
	float WanderRadius = 0.f;

	// Shoreline stop: when set, a footstep whose ground would sit at/under
	// (WaterZ + WaterEdgeMargin) is refused and the creature halts at the edge.
	bool bAvoidWater = false;
	float WaterZ = 0.f;
	float WaterEdgeMargin = 80.f;
	/** Planar radius of the water body (cm). Matches the lake spline radius. */
	float WaterSourceRadius = 26000.f;
	/** Extra planar slack beyond the radius where a shoreline halt is allowed. */
	float ShoreStopSlack = 3500.f;

	// --- autonomy / drives state ----------------------------------------------
	// An explicit director order (MoveTo/SetPath/SetLeader/Wander/action state)
	// suspends autonomy until the order completes (creature goes idle). The
	// autonomy layer only fills the idle gaps, so a directed scene wins.
	bool bExplicitOrder = false;
	EAutoAction AutoAction = EAutoAction::None;
	float ActionTimer = 0.f;

	bool bHaveWaterSource = false;
	FVector WaterSource = FVector::ZeroVector;

	bool bHaveHome = false;
	FVector HomeLoc = FVector::ZeroVector;
	float GrazeRadius = 2500.f;

	// Edge-trigger memory so we only enqueue an event when a flag flips.
	bool bWasThirsty = false;
	bool bWasTired = false;

	TWeakObjectPtr<ACreatureDirector> OwnerDirector;

	void EvolveDrives(float Dt);
	void UpdateAutonomy(float Dt);
	void ChooseAutonomousAction();
	bool HasActiveGoal() const;
	void ReportEvent(const FString& Event);

	void OnReachedGoal();
	void SetLocomotionState(FName State);
	FVector PickWanderTarget() const;
	float GroundZ(float X, float Y, float FallbackZ) const;
	void FaceDirection(const FVector& Dir, float Dt);
	/** Nearest drink point on the lake rim toward this creature. */
	FVector ComputeShoreDrinkPoint() const;
	bool TryMoveTo(const FVector& NewLoc);
	/** Planar push-out so overlapping creatures cannot pass through each other. */
	void ResolveCreatureOverlaps();
};
