#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "CreatureDef.h"
#include "SceneCreature.generated.h"

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
 * ASceneCreature is the generic "living thing" the brain drives. It uses UE's
 * CharacterMovementComponent for swept locomotion and creature/terrain collision.
 * Species-specific detail (mesh, clips) arrives at spawn via FCreatureDef.
 */
UCLASS()
class YELLOWWORLD_API ASceneCreature : public ACharacter
{
	GENERATED_BODY()

public:
	ASceneCreature(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	FName CreatureId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	FName CreatureType;

	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	FName CurrentState = TEXT("idle");

	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	float CurrentSpeed = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	bool bArrived = false;

	UPROPERTY(BlueprintReadOnly, Category = "Creature")
	bool bAtWater = false;

	UPROPERTY(BlueprintReadOnly, Category = "Creature|Drives")
	float Thirst = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Creature|Drives")
	float Fatigue = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature|Drives")
	bool bAutonomous = true;

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

	void SetDrive(FName Drive, float Value);
	void SetWaterSource(const FVector& Location, float Radius);
	void ApplyDef(const FCreatureDef& Def);
	void SetOwnerDirector(ACreatureDirector* InDirector);

	void MoveTo(const FVector& World, float Speed);
	void SetPath(const TArray<FVector>& Points, bool bLoop, float Speed);
	void SetStateName(FName State);
	void PlayClip(FName StateKey, bool bLoop);
	void SetLeader(ASceneCreature* InLeader, float Distance);
	void StartWander(const FVector& Center, float Radius, float Speed);
	void SetWaterLevel(float SurfaceZ);

	virtual void Tick(float Dt) override;

protected:
	UPROPERTY() TMap<FName, TObjectPtr<UAnimSequenceBase>> Clips;
	bool bUsingAnimBP = false;

	float WalkSpeed = 250.f;
	float RunSpeed = 600.f;
	float TurnSpeedDeg = 120.f;
	float AcceptanceRadius = 150.f;
	float ArrivalSpeedThreshold = 35.f;
	float MeshYawOffset = 0.f;

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

	bool bAvoidWater = false;
	float WaterZ = 0.f;
	float WaterEdgeMargin = 80.f;
	float WaterSourceRadius = 26000.f;
	float ShoreStopSlack = 3500.f;

	bool bExplicitOrder = false;
	EAutoAction AutoAction = EAutoAction::None;
	float ActionTimer = 0.f;

	bool bHaveWaterSource = false;
	FVector WaterSource = FVector::ZeroVector;

	bool bHaveHome = false;
	FVector HomeLoc = FVector::ZeroVector;
	float GrazeRadius = 2500.f;

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
	FVector ComputeShoreDrinkPoint() const;

	void ConfigureMovement();
	void StopLocomotion();
	void SteerToward(const FVector& Goal, float Speed);
};
