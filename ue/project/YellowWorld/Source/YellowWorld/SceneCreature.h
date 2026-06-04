#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CreatureDef.h"
#include "SceneCreature.generated.h"

class USkeletalMeshComponent;

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

	/** Apply a catalog row (mesh, anim set, speeds, scale). Safe if soft refs are unset. */
	void ApplyDef(const FCreatureDef& Def);

	// --- behaviour API, driven by ACreatureDirector verbs ---------------------
	void MoveTo(const FVector& World, float Speed);
	void SetPath(const TArray<FVector>& Points, bool bLoop, float Speed);
	void SetStateName(FName State);
	void PlayClip(FName StateKey, bool bLoop);
	void SetLeader(ASceneCreature* InLeader, float Distance);
	void StartWander(const FVector& Center, float Radius, float Speed);

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

	void OnReachedGoal();
	void SetLocomotionState(FName State);
	FVector PickWanderTarget() const;
	float GroundZ(float X, float Y, float FallbackZ) const;
	void FaceDirection(const FVector& Dir, float Dt);
};
