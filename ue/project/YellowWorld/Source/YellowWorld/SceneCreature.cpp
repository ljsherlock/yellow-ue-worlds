#include "SceneCreature.h"

#include "CreatureDirector.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequenceBase.h"
#include "Animation/AnimInstance.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"
#include "Engine/OverlapResult.h"
#include "EngineUtils.h"
#include "Math/NumericLimits.h"

namespace
{
	constexpr float kTraceHalfRange = 100000.f; // 1 km up/down — covers the 8 km savanna's relief
}

ASceneCreature::ASceneCreature()
{
	PrimaryActorTick.bCanEverTick = true;

	// Capsule root blocks other creatures; mesh stays visual-only. Landscape
	// collision is ignored — we still line-trace for ground height.
	Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
	SetRootComponent(Capsule);
	Capsule->InitCapsuleSize(200.f, 380.f);
	Capsule->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Capsule->SetCollisionObjectType(ECC_Pawn);
	Capsule->SetCollisionResponseToAllChannels(ECR_Ignore);
	Capsule->SetCollisionResponseToChannel(ECC_Pawn, ECR_Block);
	Capsule->SetGenerateOverlapEvents(false);
	Capsule->SetMobility(EComponentMobility::Movable);

	Mesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Capsule);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ASceneCreature::ApplyDef(const FCreatureDef& Def)
{
	WalkSpeed = Def.WalkSpeed > 0.f ? Def.WalkSpeed : WalkSpeed;
	RunSpeed = Def.RunSpeed > 0.f ? Def.RunSpeed : RunSpeed;
	MeshYawOffset = Def.MeshYawOffset;
	if (Def.UniformScale > 0.f)
	{
		SetActorScale3D(FVector(Def.UniformScale));
	}

	if (USkeletalMesh* SM = Def.Mesh.LoadSynchronous())
	{
		Mesh->SetSkeletalMeshAsset(SM);
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
		Mesh->SetAnimInstanceClass(AnimCls);
		bUsingAnimBP = true;
	}
	else
	{
		bUsingAnimBP = false;
		PlayClip(TEXT("idle"), true);
	}
}

// --- behaviour API ----------------------------------------------------------

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
		// An action (drink/graze/...) is performed in place — stop travelling.
		bHasTarget = false;
		bWander = false;
		Path.Reset();
		PathIndex = 0;
		CurrentSpeed = 0.f;
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
	// The source's Z doubles as the shoreline-stop level.
	bAvoidWater = true;
	WaterZ = Location.Z;
}

void ASceneCreature::PlayClip(FName StateKey, bool bLoop)
{
	if (bUsingAnimBP || !Mesh)
	{
		return; // AnimBP drives itself from CurrentState/CurrentSpeed
	}
	if (TObjectPtr<UAnimSequenceBase>* Found = Clips.Find(StateKey))
	{
		if (*Found)
		{
			Mesh->PlayAnimation(*Found, bLoop);
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

// --- tick / movement --------------------------------------------------------

void ASceneCreature::Tick(float Dt)
{
	Super::Tick(Dt);

	// Always depenetrate after movement — even on early returns (idle, atWater).
	struct FOverlapGuard
	{
		ASceneCreature* Owner = nullptr;
		explicit FOverlapGuard(ASceneCreature* InOwner) : Owner(InOwner) {}
		~FOverlapGuard()
		{
			if (Owner)
			{
				Owner->ResolveCreatureOverlaps();
			}
		}
	} OverlapGuard(this);

	if (!bHaveHome)
	{
		HomeLoc = GetActorLocation();
		bHaveHome = true;
	}

	// Drives evolve every tick; the utility layer then fills any idle gap with an
	// autonomous action (seek water / rest / graze). Both run before movement so
	// the chosen goal is resolved this same frame.
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
		CurrentSpeed = 0.f;
		return;
	}

	const FVector Self = GetActorLocation();
	FVector ToGoal = Goal - Self;
	ToGoal.Z = 0.f;
	const float PlanarDist = ToGoal.Size();

	if (PlanarDist <= AcceptanceRadius)
	{
		OnReachedGoal();
		return;
	}

	const FVector Dir = ToGoal / PlanarDist;
	const float Step = FMath::Min(SpeedForGoal * Dt, PlanarDist);
	FVector NewLoc = Self + Dir * Step;
	const float NewGroundZ = GroundZ(NewLoc.X, NewLoc.Y, Self.Z);

	// Shoreline stop: only at the actual lake — planar distance to the water
	// centre must be within the lake radius. Without this gate, any cliff or
	// depression below the water Z elsewhere on the map falsely reads as "atWater".
	const float DistToLakeXY = bHaveWaterSource
		? FVector::Dist2D(FVector(NewLoc.X, NewLoc.Y, 0.f),
			FVector(WaterSource.X, WaterSource.Y, 0.f))
		: TNumericLimits<float>::Max();
	const bool bWithinLakePlanar = bHaveWaterSource &&
		(DistToLakeXY <= WaterSourceRadius + ShoreStopSlack);

	// Only halt at the shoreline while actively seeking water — not during graze
	// wander, or a colocated camp pool turns the whole shelf into a twitchy loop.
	if (bAvoidWater && AutoAction == EAutoAction::SeekWater && bWithinLakePlanar &&
		NewGroundZ <= WaterZ + WaterEdgeMargin)
	{
		Path.Reset();
		PathIndex = 0;
		bHasTarget = false;
		bWander = false;
		Leader = nullptr;
		CurrentSpeed = 0.f;
		bArrived = true;
		bAtWater = true;
		// Reached the water: explicit order (if any) is done — let autonomy take
		// over so a thirsty creature drinks here next tick.
		bExplicitOrder = false;
		ReportEvent(TEXT("atWater"));
		// Face the water, then idle until the director sends an action (drink).
		FaceDirection(Dir, Dt);
		SetLocomotionState(TEXT("idle"));
		return;
	}

	NewLoc.Z = NewGroundZ;
	if (!TryMoveTo(NewLoc))
	{
		// Blocked (crowd jam / cliff) — don't leave walk anim running in place.
		CurrentSpeed = 0.f;
		SetLocomotionState(TEXT("idle"));
		return;
	}
	FaceDirection(Dir, Dt);

	CurrentSpeed = SpeedForGoal;
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
				CurrentSpeed = 0.f;
				bArrived = true;
				bExplicitOrder = false;
				ReportEvent(TEXT("arrived"));
				SetLocomotionState(TEXT("idle"));
			}
		}
		return;
	}
	// Single MoveTo reached.
	bHasTarget = false;
	CurrentSpeed = 0.f;
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
	const float TargetYaw = Dir.Rotation().Yaw + MeshYawOffset;
	const FRotator NewRot = FMath::RInterpConstantTo(
		GetActorRotation(), FRotator(0.f, TargetYaw, 0.f), Dt, TurnSpeedDeg);
	SetActorRotation(NewRot);
}

// --- drives / autonomy ------------------------------------------------------

void ASceneCreature::EvolveDrives(float Dt)
{
	const bool bMoving = CurrentSpeed > 1.f;
	const bool bDrinking = (AutoAction == EAutoAction::Drinking) || (CurrentState == TEXT("drink"));
	const bool bResting = (AutoAction == EAutoAction::Resting) || (!bMoving && CurrentState == TEXT("idle"));

	// Thirst: rises with time (faster while moving), drops fast while drinking.
	if (bDrinking)
	{
		Thirst -= ThirstDrinkDropPerSec * Dt;
	}
	else
	{
		Thirst += (ThirstRisePerSec + (bMoving ? ThirstMoveBonusPerSec : 0.f)) * Dt;
	}
	Thirst = FMath::Clamp(Thirst, 0.f, 1.f);

	// Fatigue: accrues with locomotion (run costs more), recovers while resting.
	if (bMoving)
	{
		Fatigue += (CurrentSpeed >= RunSpeed * 0.75f ? FatigueRunRisePerSec : FatigueWalkRisePerSec) * Dt;
	}
	else if (bResting)
	{
		Fatigue -= FatigueRestDropPerSec * Dt;
	}
	Fatigue = FMath::Clamp(Fatigue, 0.f, 1.f);

	// Edge-triggered events for the push channel (only on the flag flip up).
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
	// Autonomy only fills idle gaps; an explicit director order suspends it.
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
		return; // stay put and keep drinking

	case EAutoAction::Resting:
		if (Fatigue <= FatigueRestedThreshold)
		{
			AutoAction = EAutoAction::None; // fall through to choose next
		}
		else
		{
			return; // keep resting
		}
		break;

	case EAutoAction::SeekWater:
		if (bAtWater)
		{
			AutoAction = EAutoAction::Drinking;
			ActionTimer = 0.f;
			CurrentState = TEXT("drink");
			PlayClip(TEXT("drink"), true);
			ReportEvent(TEXT("drinking"));
			return;
		}
		if (HasActiveGoal())
		{
			return; // still travelling to the water
		}
		// Reached the source point without a shoreline halt: drink if still thirsty.
		if (Thirst >= ThirstSeekThreshold)
		{
			AutoAction = EAutoAction::Drinking;
			ActionTimer = 0.f;
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
	// Do not re-issue the same autonomous goal every tick — that resets path/wander
	// and reads as a side-to-side shake at the goal.
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

	// Priority: slake thirst > rest when exhausted > graze near home.
	if (Thirst >= ThirstSeekThreshold && bHaveWaterSource)
	{
		AutoAction = EAutoAction::SeekWater;
		Leader = nullptr;
		bWander = false;
		bHasTarget = false;
		Path.Reset();
		Path.Add(ComputeShoreDrinkPoint()); // nearest rim point, not the lake centre
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
		CurrentSpeed = 0.f;
		SetLocomotionState(TEXT("idle"));
		return;
	}

	// Graze: amble around home at a relaxed pace.
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

void ASceneCreature::ResolveCreatureOverlaps()
{
	if (!Capsule || !GetWorld())
	{
		return;
	}

	const float Radius = Capsule->GetScaledCapsuleRadius();
	const float HalfHeight = Capsule->GetScaledCapsuleHalfHeight();

	FCollisionQueryParams Params(SCENE_QUERY_STAT(CreatureOverlap), false, this);
	const FCollisionShape Shape = FCollisionShape::MakeCapsule(Radius, HalfHeight);

	for (int32 Iter = 0; Iter < 3; ++Iter)
	{
		FVector Loc = GetActorLocation();
		TArray<FOverlapResult> Overlaps;
		GetWorld()->OverlapMultiByChannel(
			Overlaps, Loc, GetActorQuat(), ECC_Pawn, Shape, Params);

		bool bAdjusted = false;
		for (const FOverlapResult& Hit : Overlaps)
		{
			const ASceneCreature* Other = Cast<ASceneCreature>(Hit.GetActor());
			if (!Other || Other == this || !Other->Capsule)
			{
				continue;
			}

			const float OtherRadius = Other->Capsule->GetScaledCapsuleRadius();
			const float MinDist = Radius + OtherRadius + 40.f;

			FVector Delta = Loc - Other->GetActorLocation();
			Delta.Z = 0.f;
			const float DistSq = Delta.SizeSquared();
			if (DistSq >= MinDist * MinDist)
			{
				continue;
			}

			float Dist = FMath::Sqrt(DistSq);
			FVector PushDir;
			if (Dist < KINDA_SMALL_NUMBER)
			{
				const uint32 Hash = GetTypeHash(CreatureId) ^ GetTypeHash(Other->CreatureId);
				const float Angle = static_cast<float>(Hash % 6283) / 1000.f;
				PushDir = FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f);
				Dist = 0.f;
			}
			else
			{
				PushDir = Delta / Dist;
			}

			Loc += PushDir * (MinDist - Dist);
			bAdjusted = true;
		}

		if (!bAdjusted)
		{
			break;
		}

		Loc.Z = GroundZ(Loc.X, Loc.Y, Loc.Z);
		SetActorLocation(Loc, false);
	}
}

bool ASceneCreature::TryMoveTo(const FVector& NewLoc)
{
	const FVector Self = GetActorLocation();
	const FVector Delta = NewLoc - Self;
	if (Delta.IsNearlyZero())
	{
		return true;
	}

	// Landscape height is traced separately; the capsule ignores WorldStatic.
	// Sweeps against other kinematic pawns in the same tick are unreliable, so
	// we teleport and let ResolveCreatureOverlaps push penetrations apart.
	SetActorLocation(NewLoc, false);

	// Crowd jam: if still overlapping another creature, try a half-step retreat.
	ResolveCreatureOverlaps();
	const auto bOverlapsCreature = [this]() -> bool
	{
		TArray<FOverlapResult> Hits;
		FCollisionQueryParams JamParams(SCENE_QUERY_STAT(CreatureJam), false, this);
		const FCollisionShape JamShape = FCollisionShape::MakeCapsule(
			Capsule->GetScaledCapsuleRadius(), Capsule->GetScaledCapsuleHalfHeight());
		if (!GetWorld()->OverlapMultiByChannel(
				Hits, GetActorLocation(), GetActorQuat(), ECC_Pawn, JamShape, JamParams))
		{
			return false;
		}
		for (const FOverlapResult& Hit : Hits)
		{
			const ASceneCreature* Other = Cast<ASceneCreature>(Hit.GetActor());
			if (Other && Other != this)
			{
				return true;
			}
		}
		return false;
	};

	if (bOverlapsCreature())
	{
		FVector Half = Self + Delta * 0.5f;
		Half.Z = GroundZ(Half.X, Half.Y, Half.Z);
		SetActorLocation(Half, false);
		ResolveCreatureOverlaps();
		if (bOverlapsCreature())
		{
			SetActorLocation(Self, false);
			return false;
		}
	}

	return true;
}
