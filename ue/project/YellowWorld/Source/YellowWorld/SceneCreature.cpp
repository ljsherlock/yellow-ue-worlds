#include "SceneCreature.h"

#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequenceBase.h"
#include "Animation/AnimInstance.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"

namespace
{
	constexpr float kTraceHalfRange = 100000.f; // 1 km up/down — covers the 8 km savanna's relief
}

ASceneCreature::ASceneCreature()
{
	PrimaryActorTick.bCanEverTick = true;

	Mesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	// Kinematic mover: no physics, and don't let our own mesh block the ground
	// trace. The landscape (WorldStatic) is what we snap to.
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
}

// --- tick / movement --------------------------------------------------------

void ASceneCreature::Tick(float Dt)
{
	Super::Tick(Dt);

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

	// Shoreline stop: the landscape continues below the lake (water has no
	// collision), so without this the creature walks down the lakebed. If the
	// next footstep would sit at/under the waterline, halt here at the edge.
	if (bAvoidWater && NewGroundZ <= WaterZ + WaterEdgeMargin)
	{
		Path.Reset();
		PathIndex = 0;
		bHasTarget = false;
		bWander = false;
		Leader = nullptr;
		CurrentSpeed = 0.f;
		// Face the water, then idle until the director sends an action (drink).
		FaceDirection(Dir, Dt);
		SetLocomotionState(TEXT("idle"));
		return;
	}

	NewLoc.Z = NewGroundZ;
	SetActorLocation(NewLoc);
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
				SetLocomotionState(TEXT("idle"));
			}
		}
		return;
	}
	// Single MoveTo reached.
	bHasTarget = false;
	CurrentSpeed = 0.f;
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
