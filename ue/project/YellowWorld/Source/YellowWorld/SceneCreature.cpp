#include "SceneCreature.h"

#include "CreatureDirector.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequenceBase.h"
#include "Animation/AnimInstance.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"
#include "Math/NumericLimits.h"

namespace
{
	constexpr float kTraceHalfRange = 100000.f;
}

ASceneCreature::ASceneCreature(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	PrimaryActorTick.bCanEverTick = true;

	UCapsuleComponent* Cap = GetCapsuleComponent();
	Cap->InitCapsuleSize(200.f, 380.f);
	Cap->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Cap->SetCollisionObjectType(ECC_Pawn);
	Cap->SetCollisionResponseToAllChannels(ECR_Ignore);
	Cap->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	Cap->SetCollisionResponseToChannel(ECC_WorldStatic, ECR_Block);
	Cap->SetGenerateOverlapEvents(false);

	// CharacterMovement rests the capsule BOTTOM on the floor, so the actor
	// origin sits one half-height above the ground. The skeletal mesh pivots at
	// the creature's feet, so drop it by the (unscaled) half-height to plant the
	// feet on the ground instead of floating at the capsule centre. Scales with
	// the actor, so it stays grounded at any UniformScale.
	GetMesh()->SetupAttachment(Cap);
	GetMesh()->SetRelativeLocation(FVector(0.f, 0.f, -Cap->GetUnscaledCapsuleHalfHeight()));
	GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	ConfigureMovement();
}

void ASceneCreature::ConfigureMovement()
{
	UCharacterMovementComponent* Move = GetCharacterMovement();
	if (!Move)
	{
		return;
	}
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, TurnSpeedDeg, 0.f);
	Move->MaxWalkSpeed = WalkSpeed;
	Move->BrakingDecelerationWalking = 1200.f;
	Move->GroundFriction = 8.f;
	Move->MaxStepHeight = 60.f;
	Move->SetWalkableFloorAngle(50.f);
	Move->bUseControllerDesiredRotation = false;
	Move->bRunPhysicsWithNoController = true;

	// RVO avoidance: creatures steer AROUND a blocker instead of marching into
	// it and "walking in place". Everyone is in (and avoids) group 1, so the
	// herd treats each other as obstacles. ConsiderationRadius is generous
	// because the capsules are large (200cm radius) — they need to start
	// veering well before contact. The hard capsule block stays as the backstop
	// for the cases avoidance can't resolve in time.
	Move->bUseRVOAvoidance = true;
	Move->AvoidanceConsiderationRadius = 1500.f;
	Move->AvoidanceWeight = 0.5f;
	Move->SetAvoidanceGroup(1);
	Move->SetGroupsToAvoid(1);
}

void ASceneCreature::StopLocomotion()
{
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->StopMovementImmediately();
	}
	CurrentSpeed = 0.f;
}

void ASceneCreature::SteerToward(const FVector& Goal, float Speed)
{
	UCharacterMovementComponent* Move = GetCharacterMovement();
	if (!Move)
	{
		return;
	}

	Move->bOrientRotationToMovement = true;
	Move->MaxWalkSpeed = FMath::Max(Speed, 1.f);

	FVector ToGoal = Goal - GetActorLocation();
	ToGoal.Z = 0.f;
	if (ToGoal.IsNearlyZero())
	{
		StopLocomotion();
		return;
	}

	AddMovementInput(ToGoal.GetSafeNormal(), 1.f);
	CurrentSpeed = GetVelocity().Size2D();
}

void ASceneCreature::ApplyDef(const FCreatureDef& Def)
{
	WalkSpeed = Def.WalkSpeed > 0.f ? Def.WalkSpeed : WalkSpeed;
	RunSpeed = Def.RunSpeed > 0.f ? Def.RunSpeed : RunSpeed;
	MeshYawOffset = Def.MeshYawOffset;
	// CharacterMovement orients the ACTOR (capsule) to the velocity/target
	// direction. The skeletal mesh art rarely faces +X, so carry the art's yaw
	// correction on the MESH itself; the actor then always faces true heading and
	// the mesh's head points forward. (Previously MeshYawOffset was folded into
	// the actor rotation, which CMC's bOrientRotationToMovement now overrides —
	// leaving the herd crabbing sideways.)
	GetMesh()->SetRelativeRotation(FRotator(0.f, MeshYawOffset, 0.f));
	if (Def.UniformScale > 0.f)
	{
		SetActorScale3D(FVector(Def.UniformScale));
	}

	if (USkeletalMesh* SM = Def.Mesh.LoadSynchronous())
	{
		GetMesh()->SetSkeletalMeshAsset(SM);
	}

	Clips.Reset();
	for (const TPair<FName, TSoftObjectPtr<UAnimSequenceBase>>& Pair : Def.StateToClip)
	{
		if (UAnimSequenceBase* Seq = Pair.Value.LoadSynchronous())
		{
			Clips.Add(Pair.Key, Seq);
		}
	}

	if (UClass* AnimCls = Def.AnimClass.LoadSynchronous())
	{
		GetMesh()->SetAnimInstanceClass(AnimCls);
		bUsingAnimBP = true;
	}
	else
	{
		bUsingAnimBP = false;
		PlayClip(TEXT("idle"), true);
	}

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->MaxWalkSpeed = WalkSpeed;
	}
}

void ASceneCreature::MoveTo(const FVector& World, float Speed)
{
	bWander = false;
	Path.Reset();
	PathIndex = 0;
	Leader = nullptr;
	TargetLoc = World;
	bHasTarget = true;
	DesiredSpeed = Speed > 0.f ? Speed : WalkSpeed;
	bArrived = false;
	bAtWater = false;
	bExplicitOrder = true;
	AutoAction = EAutoAction::None;
}

void ASceneCreature::SetPath(const TArray<FVector>& Points, bool bLoop, float Speed)
{
	bWander = false;
	bHasTarget = false;
	Leader = nullptr;
	Path = Points;
	PathIndex = 0;
	bLoopPath = bLoop;
	DesiredSpeed = Speed > 0.f ? Speed : WalkSpeed;
	bArrived = false;
	bAtWater = false;
	bExplicitOrder = true;
	AutoAction = EAutoAction::None;
}

void ASceneCreature::SetStateName(FName State)
{
	const bool bLocomotion = (State == TEXT("walk") || State == TEXT("run") || State == TEXT("idle"));
	if (!bLocomotion)
	{
		bHasTarget = false;
		bWander = false;
		Path.Reset();
		PathIndex = 0;
		StopLocomotion();
	}
	CurrentState = State;
	PlayClip(State, true);
	bExplicitOrder = true;
	AutoAction = EAutoAction::None;
}

void ASceneCreature::SetOwnerDirector(ACreatureDirector* InDirector)
{
	OwnerDirector = InDirector;
}

void ASceneCreature::SetDrive(FName Drive, float Value)
{
	const float V = FMath::Clamp(Value, 0.f, 1.f);
	if (Drive == TEXT("thirst"))
	{
		Thirst = V;
		bWasThirsty = Thirst >= ThirstSeekThreshold;
	}
	else if (Drive == TEXT("fatigue"))
	{
		Fatigue = V;
		bWasTired = Fatigue >= FatigueRestThreshold;
	}
}

void ASceneCreature::SetWaterSource(const FVector& Location, float Radius)
{
	WaterSource = Location;
	WaterSourceRadius = FMath::Max(Radius, 100.f);
	bHaveWaterSource = true;
	bAvoidWater = true;
	WaterZ = Location.Z;
}

void ASceneCreature::PlayClip(FName StateKey, bool bLoop)
{
	if (bUsingAnimBP || !GetMesh())
	{
		return;
	}
	if (TObjectPtr<UAnimSequenceBase>* Found = Clips.Find(StateKey))
	{
		if (*Found)
		{
			GetMesh()->PlayAnimation(*Found, bLoop);
		}
	}
}

void ASceneCreature::SetLeader(ASceneCreature* InLeader, float Distance)
{
	Leader = InLeader;
	FollowDistance = Distance > 0.f ? Distance : FollowDistance;
	bWander = false;
	Path.Reset();
	PathIndex = 0;
	bHasTarget = false;
	bArrived = false;
	bAtWater = false;
	bExplicitOrder = true;
	AutoAction = EAutoAction::None;
}

void ASceneCreature::SetWaterLevel(float SurfaceZ)
{
	bAvoidWater = true;
	WaterZ = SurfaceZ;
}

void ASceneCreature::StartWander(const FVector& Center, float Radius, float Speed)
{
	bWander = true;
	WanderCenter = Center;
	WanderRadius = Radius;
	DesiredSpeed = Speed > 0.f ? Speed : WalkSpeed;
	Leader = nullptr;
	Path.Reset();
	PathIndex = 0;
	bHasTarget = false;
	TargetLoc = PickWanderTarget();
	bArrived = false;
	bAtWater = false;
	bExplicitOrder = true;
	AutoAction = EAutoAction::None;
}

void ASceneCreature::Tick(float Dt)
{
	Super::Tick(Dt);

	CurrentSpeed = GetVelocity().Size2D();

	if (!bHaveHome)
	{
		HomeLoc = GetActorLocation();
		bHaveHome = true;
	}

	EvolveDrives(Dt);
	UpdateAutonomy(Dt);

	FVector Goal = FVector::ZeroVector;
	bool bHaveGoal = false;
	float SpeedForGoal = DesiredSpeed > 0.f ? DesiredSpeed : WalkSpeed;

	if (Leader.IsValid())
	{
		const FVector LeaderLoc = Leader->GetActorLocation();
		if (FVector::Dist2D(LeaderLoc, GetActorLocation()) > FollowDistance)
		{
			Goal = LeaderLoc;
			bHaveGoal = true;
			SpeedForGoal = Leader->CurrentSpeed > 1.f ? FMath::Max(Leader->CurrentSpeed, WalkSpeed) : WalkSpeed;
		}
	}
	else if (bWander)
	{
		Goal = TargetLoc;
		bHaveGoal = true;
	}
	else if (Path.Num() > 0)
	{
		Goal = Path[PathIndex];
		bHaveGoal = true;
	}
	else if (bHasTarget)
	{
		Goal = TargetLoc;
		bHaveGoal = true;
	}

	if (!bHaveGoal)
	{
		StopLocomotion();
		return;
	}

	const FVector Self = GetActorLocation();
	FVector ToGoal = Goal - Self;
	ToGoal.Z = 0.f;
	const float PlanarDist = ToGoal.Size();

	const float DistToLakeXY = bHaveWaterSource
		? FVector::Dist2D(FVector(Self.X, Self.Y, 0.f),
			FVector(WaterSource.X, WaterSource.Y, 0.f))
		: TNumericLimits<float>::Max();
	const bool bWithinLakePlanar = bHaveWaterSource &&
		(DistToLakeXY <= WaterSourceRadius + ShoreStopSlack);

	float FloorZ = GroundZ(Self.X, Self.Y, Self.Z);
	if (const UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		if (Move->CurrentFloor.IsWalkableFloor())
		{
			FloorZ = Move->CurrentFloor.HitResult.ImpactPoint.Z;
		}
	}

	if (bAvoidWater && AutoAction == EAutoAction::SeekWater && bWithinLakePlanar &&
		FloorZ <= WaterZ + WaterEdgeMargin)
	{
		Path.Reset();
		PathIndex = 0;
		bHasTarget = false;
		bWander = false;
		Leader = nullptr;
		StopLocomotion();
		bArrived = true;
		bAtWater = true;
		bExplicitOrder = false;
		ReportEvent(TEXT("atWater"));
		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			Move->bOrientRotationToMovement = false;
		}
		if (!ToGoal.IsNearlyZero())
		{
			FaceDirection(ToGoal / FMath::Max(PlanarDist, 1.f), Dt);
		}
		SetLocomotionState(TEXT("idle"));
		return;
	}

	if (PlanarDist <= AcceptanceRadius)
	{
		if (CurrentSpeed <= ArrivalSpeedThreshold)
		{
			StopLocomotion();
			OnReachedGoal();
		}
		else
		{
			SteerToward(Goal, SpeedForGoal * 0.5f);
		}
		return;
	}

	SteerToward(Goal, SpeedForGoal);
	SetLocomotionState(SpeedForGoal >= RunSpeed * 0.75f ? TEXT("run") : TEXT("walk"));
}

void ASceneCreature::OnReachedGoal()
{
	if (bWander)
	{
		TargetLoc = PickWanderTarget();
		return;
	}
	if (Path.Num() > 0)
	{
		++PathIndex;
		if (PathIndex >= Path.Num())
		{
			if (bLoopPath)
			{
				PathIndex = 0;
			}
			else
			{
				Path.Reset();
				PathIndex = 0;
				StopLocomotion();
				bArrived = true;
				bExplicitOrder = false;
				ReportEvent(TEXT("arrived"));
				SetLocomotionState(TEXT("idle"));
			}
		}
		return;
	}
	bHasTarget = false;
	StopLocomotion();
	bArrived = true;
	bExplicitOrder = false;
	ReportEvent(TEXT("arrived"));
	SetLocomotionState(TEXT("idle"));
}

void ASceneCreature::SetLocomotionState(FName State)
{
	if (CurrentState == State)
	{
		return;
	}
	CurrentState = State;
	PlayClip(State, true);
}

FVector ASceneCreature::PickWanderTarget() const
{
	const float Ang = FMath::FRandRange(0.f, 2.f * PI);
	const float R = FMath::FRandRange(WanderRadius * 0.25f, FMath::Max(WanderRadius, 1.f));
	return FVector(WanderCenter.X + R * FMath::Cos(Ang),
		WanderCenter.Y + R * FMath::Sin(Ang),
		WanderCenter.Z);
}

float ASceneCreature::GroundZ(float X, float Y, float FallbackZ) const
{
	const UWorld* World = GetWorld();
	if (!World)
	{
		return FallbackZ;
	}
	const FVector Start(X, Y, FallbackZ + kTraceHalfRange);
	const FVector End(X, Y, FallbackZ - kTraceHalfRange);
	FHitResult Hit;
	FCollisionQueryParams Params(FName(TEXT("CreatureGround")), false, this);
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_WorldStatic, Params))
	{
		return Hit.ImpactPoint.Z;
	}
	return FallbackZ;
}

void ASceneCreature::FaceDirection(const FVector& Dir, float Dt)
{
	if (Dir.IsNearlyZero())
	{
		return;
	}
	// Face the true heading; the mesh carries the art yaw offset (set in ApplyDef),
	// so the actor rotation must NOT re-apply MeshYawOffset.
	const float TargetYaw = Dir.Rotation().Yaw;
	const FRotator NewRot = FMath::RInterpConstantTo(
		GetActorRotation(), FRotator(0.f, TargetYaw, 0.f), Dt, TurnSpeedDeg);
	SetActorRotation(NewRot);
}

void ASceneCreature::EvolveDrives(float Dt)
{
	const bool bMoving = CurrentSpeed > 1.f;
	const bool bDrinking = (AutoAction == EAutoAction::Drinking) || (CurrentState == TEXT("drink"));
	const bool bResting = (AutoAction == EAutoAction::Resting) || (!bMoving && CurrentState == TEXT("idle"));

	if (bDrinking)
	{
		Thirst -= ThirstDrinkDropPerSec * Dt;
	}
	else
	{
		Thirst += (ThirstRisePerSec + (bMoving ? ThirstMoveBonusPerSec : 0.f)) * Dt;
	}
	Thirst = FMath::Clamp(Thirst, 0.f, 1.f);

	if (bMoving)
	{
		Fatigue += (CurrentSpeed >= RunSpeed * 0.75f ? FatigueRunRisePerSec : FatigueWalkRisePerSec) * Dt;
	}
	else if (bResting)
	{
		Fatigue -= FatigueRestDropPerSec * Dt;
	}
	Fatigue = FMath::Clamp(Fatigue, 0.f, 1.f);

	const bool bNowThirsty = Thirst >= ThirstSeekThreshold;
	if (bNowThirsty && !bWasThirsty)
	{
		ReportEvent(TEXT("thirsty"));
	}
	bWasThirsty = bNowThirsty;

	const bool bNowTired = Fatigue >= FatigueRestThreshold;
	if (bNowTired && !bWasTired)
	{
		ReportEvent(TEXT("tired"));
	}
	bWasTired = bNowTired;
}

bool ASceneCreature::HasActiveGoal() const
{
	return bHasTarget || Path.Num() > 0 || Leader.IsValid() || bWander;
}

void ASceneCreature::UpdateAutonomy(float Dt)
{
	if (!bAutonomous || bExplicitOrder)
	{
		return;
	}

	switch (AutoAction)
	{
	case EAutoAction::Drinking:
		ActionTimer += Dt;
		if (Thirst <= ThirstSatedThreshold)
		{
			ReportEvent(TEXT("sated"));
			AutoAction = EAutoAction::None;
			bAtWater = false;
		}
		return;

	case EAutoAction::Resting:
		if (Fatigue <= FatigueRestedThreshold)
		{
			AutoAction = EAutoAction::None;
		}
		else
		{
			return;
		}
		break;

	case EAutoAction::SeekWater:
		if (bAtWater)
		{
			AutoAction = EAutoAction::Drinking;
			ActionTimer = 0.f;
			StopLocomotion();
			CurrentState = TEXT("drink");
			PlayClip(TEXT("drink"), true);
			ReportEvent(TEXT("drinking"));
			return;
		}
		if (HasActiveGoal())
		{
			return;
		}
		if (Thirst >= ThirstSeekThreshold)
		{
			AutoAction = EAutoAction::Drinking;
			ActionTimer = 0.f;
			StopLocomotion();
			CurrentState = TEXT("drink");
			PlayClip(TEXT("drink"), true);
			ReportEvent(TEXT("drinking"));
			return;
		}
		AutoAction = EAutoAction::None;
		break;

	default:
		break;
	}

	const bool bGrazingInterruptible = (AutoAction == EAutoAction::Graze &&
		(Thirst >= ThirstSeekThreshold || Fatigue >= FatigueRestThreshold));
	if (!HasActiveGoal() || bGrazingInterruptible)
	{
		ChooseAutonomousAction();
	}
}

void ASceneCreature::ChooseAutonomousAction()
{
	if (AutoAction == EAutoAction::SeekWater && Thirst >= ThirstSeekThreshold && HasActiveGoal())
	{
		return;
	}
	if (AutoAction == EAutoAction::Graze && Thirst < ThirstSeekThreshold &&
		Fatigue < FatigueRestThreshold && HasActiveGoal())
	{
		return;
	}
	if (AutoAction == EAutoAction::Resting && Fatigue >= FatigueRestThreshold)
	{
		return;
	}

	if (Thirst >= ThirstSeekThreshold && bHaveWaterSource)
	{
		AutoAction = EAutoAction::SeekWater;
		Leader = nullptr;
		bWander = false;
		bHasTarget = false;
		Path.Reset();
		Path.Add(ComputeShoreDrinkPoint());
		PathIndex = 0;
		bLoopPath = false;
		DesiredSpeed = WalkSpeed;
		bArrived = false;
		bAtWater = false;
		ReportEvent(TEXT("seek_water"));
		return;
	}

	if (Fatigue >= FatigueRestThreshold)
	{
		AutoAction = EAutoAction::Resting;
		Leader = nullptr;
		bWander = false;
		bHasTarget = false;
		Path.Reset();
		PathIndex = 0;
		StopLocomotion();
		SetLocomotionState(TEXT("idle"));
		return;
	}

	AutoAction = EAutoAction::Graze;
	Leader = nullptr;
	bHasTarget = false;
	Path.Reset();
	PathIndex = 0;
	bWander = true;
	WanderCenter = bHaveHome ? HomeLoc : GetActorLocation();
	WanderRadius = GrazeRadius;
	DesiredSpeed = WalkSpeed * 0.6f;
	TargetLoc = PickWanderTarget();
	bArrived = false;
	bAtWater = false;
}

void ASceneCreature::ReportEvent(const FString& Event)
{
	if (ACreatureDirector* D = OwnerDirector.Get())
	{
		D->ReportEvent(CreatureId.ToString(), Event);
	}
}

FVector ASceneCreature::ComputeShoreDrinkPoint() const
{
	FVector Delta = GetActorLocation() - WaterSource;
	Delta.Z = 0.f;
	if (Delta.IsNearlyZero())
	{
		Delta = FVector(1.f, 0.f, 0.f);
	}
	Delta.Normalize();
	FVector Rim = WaterSource + Delta * WaterSourceRadius;
	Rim.Z = GroundZ(Rim.X, Rim.Y, WaterSource.Z);
	return Rim;
}
