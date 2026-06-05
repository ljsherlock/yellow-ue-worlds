#include "CreatureDirector.h"

#include "SceneCreature.h"
#include "FlyPawn.h"
#include "CreatureDef.h"
#include "Engine/DataTable.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "CollisionQueryParams.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/PlayerController.h"

namespace
{
	constexpr float kTraceHalfRange = 100000.f;

	void Notify(const FString& Msg)
	{
		UE_LOG(LogTemp, Display, TEXT("[CreatureDirector] %s"), *Msg);
		if (GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 4.f, FColor::Green, Msg);
		}
	}

	/** One creature as a compact JSON object. Ids/types/states are simple tokens
	 *  (no embedded quotes), so a printf-built string is safe and dependency-free. */
	FString DescribeCreature(const FString& Id, const ASceneCreature* C)
	{
		const FVector L = C->GetActorLocation();
		return FString::Printf(
			TEXT("{\"id\":\"%s\",\"type\":\"%s\",\"state\":\"%s\",")
			TEXT("\"x\":%.1f,\"y\":%.1f,\"z\":%.1f,\"speed\":%.1f,")
			TEXT("\"thirst\":%.3f,\"fatigue\":%.3f,")
			TEXT("\"arrived\":%s,\"atWater\":%s}"),
			*Id, *C->CreatureType.ToString(), *C->CurrentState.ToString(),
			L.X, L.Y, L.Z, C->CurrentSpeed,
			C->Thirst, C->Fatigue,
			C->bArrived ? TEXT("true") : TEXT("false"),
			C->bAtWater ? TEXT("true") : TEXT("false"));
	}
}

ACreatureDirector::ACreatureDirector()
{
	PrimaryActorTick.bCanEverTick = false;
}

ASceneCreature* ACreatureDirector::Find(const FString& Id) const
{
	const TObjectPtr<ASceneCreature>* Found = Creatures.Find(FName(*Id));
	return Found ? *Found : nullptr;
}

const FCreatureDef* ACreatureDirector::ResolveDef(const FName& Type) const
{
	// Runtime-defined types win; fall back to the optional DataTable catalog.
	if (const FCreatureDef* Def = DefinedTypes.Find(Type))
	{
		return Def;
	}
	if (CreatureTable)
	{
		return CreatureTable->FindRow<FCreatureDef>(Type, TEXT("ResolveDef"));
	}
	return nullptr;
}

void ACreatureDirector::DefineCreatureType(const FString& Type, const FString& MeshPath,
	const FString& ClipsCsv, float WalkSpeed, float RunSpeed, float UniformScale, float MeshYawOffset)
{
	FCreatureDef Def;
	if (WalkSpeed > 0.f) { Def.WalkSpeed = WalkSpeed; }
	if (RunSpeed > 0.f) { Def.RunSpeed = RunSpeed; }
	Def.UniformScale = UniformScale > 0.f ? UniformScale : 1.f;
	Def.MeshYawOffset = MeshYawOffset;

	if (!MeshPath.IsEmpty())
	{
		Def.Mesh = TSoftObjectPtr<USkeletalMesh>(FSoftObjectPath(MeshPath));
	}

	int32 NumClips = 0;
	TArray<FString> Entries;
	ClipsCsv.ParseIntoArray(Entries, TEXT(";"), true);
	for (const FString& Entry : Entries)
	{
		FString Key, Path;
		if (Entry.Split(TEXT("="), &Key, &Path))
		{
			Key = Key.TrimStartAndEnd();
			Path = Path.TrimStartAndEnd();
			if (!Key.IsEmpty() && !Path.IsEmpty())
			{
				Def.StateToClip.Add(FName(*Key), TSoftObjectPtr<UAnimSequenceBase>(FSoftObjectPath(Path)));
				++NumClips;
			}
		}
	}

	DefinedTypes.Add(FName(*Type), Def);
	Notify(FString::Printf(TEXT("DefineCreatureType '%s' mesh='%s' clips=%d walk=%.0f run=%.0f scale=%.2f yaw=%.0f"),
		*Type, *MeshPath, NumClips, Def.WalkSpeed, Def.RunSpeed, Def.UniformScale, Def.MeshYawOffset));
}

float ACreatureDirector::GroundZAt(float X, float Y) const
{
	const UWorld* World = GetWorld();
	if (!World)
	{
		return 0.f;
	}
	const FVector Start(X, Y, kTraceHalfRange);
	const FVector End(X, Y, -kTraceHalfRange);
	FHitResult Hit;
	FCollisionQueryParams Params(FName(TEXT("CreatureDirectorGround")), false, this);
	if (World->LineTraceSingleByChannel(Hit, Start, End, ECC_WorldStatic, Params))
	{
		return Hit.ImpactPoint.Z;
	}
	return 0.f;
}

void ACreatureDirector::SpawnCreature(const FString& Type, const FString& Id, float X, float Y, float Yaw)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	const FName IdName(*Id);
	if (Creatures.Contains(IdName))
	{
		DespawnCreature(Id);
	}

	const float Z = GroundZAt(X, Y);
	FActorSpawnParameters SpawnParams;
	SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ASceneCreature* Creature = World->SpawnActor<ASceneCreature>(
		ASceneCreature::StaticClass(), FVector(X, Y, Z), FRotator(0.f, Yaw, 0.f), SpawnParams);
	if (!Creature)
	{
		Notify(FString::Printf(TEXT("SpawnCreature '%s' FAILED"), *Id));
		return;
	}

	Creature->CreatureId = IdName;
	Creature->CreatureType = FName(*Type);
	Creature->SetOwnerDirector(this);

	const FCreatureDef* Def = ResolveDef(FName(*Type));
	if (Def)
	{
		Creature->ApplyDef(*Def);
	}
	if (bHaveWaterZ)
	{
		Creature->SetWaterLevel(SceneWaterZ);
	}
	if (bHaveWaterSource)
	{
		Creature->SetWaterSource(SceneWaterSource, SceneWaterRadius);
	}

	Creatures.Add(IdName, Creature);
	Notify(FString::Printf(TEXT("spawned '%s' type='%s' at (%.0f,%.0f,%.0f)%s"),
		*Id, *Type, X, Y, Z, Def ? TEXT("") : TEXT(" [unknown type — mesh unset; call DefineCreatureType first]")));
}

void ACreatureDirector::MoveCreatureTo(const FString& Id, float X, float Y, float Speed)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->MoveTo(FVector(X, Y, GroundZAt(X, Y)), Speed);
		Notify(FString::Printf(TEXT("MoveCreatureTo '%s' -> (%.0f,%.0f) @ %.0f"), *Id, X, Y, Speed));
	}
	else
	{
		Notify(FString::Printf(TEXT("MoveCreatureTo: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::FollowPath(const FString& Id, const FString& PointsCsv, bool bLoop, float Speed)
{
	ASceneCreature* C = Find(Id);
	if (!C)
	{
		Notify(FString::Printf(TEXT("FollowPath: no creature '%s'"), *Id));
		return;
	}

	TArray<FVector> Points;
	TArray<FString> Pairs;
	PointsCsv.ParseIntoArray(Pairs, TEXT(";"), true);
	for (const FString& Pair : Pairs)
	{
		TArray<FString> XY;
		Pair.ParseIntoArray(XY, TEXT(","), true);
		if (XY.Num() >= 2)
		{
			const float Px = FCString::Atof(*XY[0]);
			const float Py = FCString::Atof(*XY[1]);
			Points.Add(FVector(Px, Py, GroundZAt(Px, Py)));
		}
	}

	if (Points.Num() == 0)
	{
		Notify(FString::Printf(TEXT("FollowPath '%s': no valid points in '%s'"), *Id, *PointsCsv));
		return;
	}
	C->SetPath(Points, bLoop, Speed);
	Notify(FString::Printf(TEXT("FollowPath '%s': %d points loop=%d @ %.0f"), *Id, Points.Num(), bLoop, Speed));
}

void ACreatureDirector::SetCreatureState(const FString& Id, const FString& State)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->SetStateName(FName(*State));
		Notify(FString::Printf(TEXT("SetCreatureState '%s' = '%s'"), *Id, *State));
	}
	else
	{
		Notify(FString::Printf(TEXT("SetCreatureState: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::PlayCreatureAnim(const FString& Id, const FString& Clip)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->PlayClip(FName(*Clip), true);
		Notify(FString::Printf(TEXT("PlayCreatureAnim '%s' clip='%s'"), *Id, *Clip));
	}
	else
	{
		Notify(FString::Printf(TEXT("PlayCreatureAnim: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::SetCreatureLeader(const FString& Id, const FString& LeaderId, float Distance)
{
	ASceneCreature* C = Find(Id);
	ASceneCreature* L = Find(LeaderId);
	if (C && L)
	{
		C->SetLeader(L, Distance);
		Notify(FString::Printf(TEXT("SetCreatureLeader '%s' follows '%s' @ %.0f"), *Id, *LeaderId, Distance));
	}
	else
	{
		Notify(FString::Printf(TEXT("SetCreatureLeader: missing '%s' or '%s'"), *Id, *LeaderId));
	}
}

void ACreatureDirector::WanderCreature(const FString& Id, float CenterX, float CenterY, float Radius, float Speed)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->StartWander(FVector(CenterX, CenterY, GroundZAt(CenterX, CenterY)), Radius, Speed);
		Notify(FString::Printf(TEXT("WanderCreature '%s' around (%.0f,%.0f) r=%.0f"), *Id, CenterX, CenterY, Radius));
	}
	else
	{
		Notify(FString::Printf(TEXT("WanderCreature: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::DespawnCreature(const FString& Id)
{
	const FName IdName(*Id);
	if (TObjectPtr<ASceneCreature>* Found = Creatures.Find(IdName))
	{
		if (*Found)
		{
			(*Found)->Destroy();
		}
		Creatures.Remove(IdName);
		Notify(FString::Printf(TEXT("despawned '%s'"), *Id));
	}
}

void ACreatureDirector::ClearCreatures()
{
	int32 N = 0;
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Pair : Creatures)
	{
		if (Pair.Value)
		{
			Pair.Value->Destroy();
			++N;
		}
	}
	Creatures.Reset();
	Notify(FString::Printf(TEXT("cleared %d creature(s)"), N));
}

void ACreatureDirector::ListCreatures()
{
	Notify(FString::Printf(TEXT("%d creature(s) live:"), Creatures.Num()));
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Pair : Creatures)
	{
		if (Pair.Value)
		{
			Notify(FString::Printf(TEXT("  %s type=%s state=%s"),
				*Pair.Key.ToString(), *Pair.Value->CreatureType.ToString(),
				*Pair.Value->CurrentState.ToString()));
		}
	}
}

FString ACreatureDirector::QueryCreatures()
{
	FString Out = TEXT("[");
	bool bFirst = true;
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Pair : Creatures)
	{
		if (!Pair.Value)
		{
			continue;
		}
		if (!bFirst)
		{
			Out += TEXT(",");
		}
		Out += DescribeCreature(Pair.Key.ToString(), Pair.Value);
		bFirst = false;
	}
	Out += TEXT("]");
	return Out;
}

FString ACreatureDirector::QueryCreature(const FString& Id)
{
	if (const ASceneCreature* C = Find(Id))
	{
		return DescribeCreature(Id, C);
	}
	return TEXT("{}");
}

void ACreatureDirector::SetWaterLevel(float SurfaceZ)
{
	bHaveWaterZ = true;
	SceneWaterZ = SurfaceZ;
	int32 N = 0;
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Pair : Creatures)
	{
		if (Pair.Value)
		{
			Pair.Value->SetWaterLevel(SurfaceZ);
			++N;
		}
	}
	Notify(FString::Printf(TEXT("SetWaterLevel %.0f applied to %d creature(s)"), SurfaceZ, N));
}

void ACreatureDirector::SetWaterSource(float X, float Y, float SurfaceZ, float Radius)
{
	bHaveWaterSource = true;
	SceneWaterSource = FVector(X, Y, SurfaceZ);
	SceneWaterRadius = FMath::Max(Radius, 100.f);
	// SurfaceZ also drives the shoreline stop, so keep the level path in sync.
	bHaveWaterZ = true;
	SceneWaterZ = SurfaceZ;
	int32 N = 0;
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Pair : Creatures)
	{
		if (Pair.Value)
		{
			Pair.Value->SetWaterSource(SceneWaterSource, SceneWaterRadius);
			++N;
		}
	}
	Notify(FString::Printf(TEXT("SetWaterSource (%.0f,%.0f,%.0f) r=%.0f applied to %d creature(s)"),
		X, Y, SurfaceZ, SceneWaterRadius, N));
}

void ACreatureDirector::SetCreatureDrive(const FString& Id, const FString& Drive, float Value)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->SetDrive(FName(*Drive), Value);
		Notify(FString::Printf(TEXT("SetCreatureDrive '%s' %s=%.2f"), *Id, *Drive, Value));
	}
	else
	{
		Notify(FString::Printf(TEXT("SetCreatureDrive: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::SetCreatureAutonomy(const FString& Id, bool bEnabled)
{
	if (ASceneCreature* C = Find(Id))
	{
		C->bAutonomous = bEnabled;
		Notify(FString::Printf(TEXT("SetCreatureAutonomy '%s' = %s"), *Id, bEnabled ? TEXT("on") : TEXT("off")));
	}
	else
	{
		Notify(FString::Printf(TEXT("SetCreatureAutonomy: no creature '%s'"), *Id));
	}
}

void ACreatureDirector::ReportEvent(const FString& Id, const FString& Event)
{
	if (EventQueue.Num() >= MaxEvents)
	{
		EventQueue.RemoveAt(0); // drop oldest; a non-draining consumer can't OOM us
	}
	EventQueue.Add(FString::Printf(TEXT("{\"id\":\"%s\",\"event\":\"%s\"}"), *Id, *Event));
}

FString ACreatureDirector::DrainEvents()
{
	FString Out = TEXT("[");
	for (int32 i = 0; i < EventQueue.Num(); ++i)
	{
		if (i > 0)
		{
			Out += TEXT(",");
		}
		Out += EventQueue[i];
	}
	Out += TEXT("]");
	EventQueue.Reset();
	return Out;
}

void ACreatureDirector::FocusCamera(const FString& Id)
{
	ASceneCreature* C = Find(Id);
	if (!C)
	{
		Notify(FString::Printf(TEXT("FocusCamera: no creature '%s'"), *Id));
		return;
	}
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	AFlyPawn* Pawn = PC ? Cast<AFlyPawn>(PC->GetPawn()) : nullptr;
	if (!Pawn)
	{
		Notify(TEXT("FocusCamera: no AFlyPawn possessed"));
		return;
	}
	Pawn->SetFollowTarget(C);
	Notify(FString::Printf(TEXT("FocusCamera -> '%s'"), *Id));
}

void ACreatureDirector::StopFocus()
{
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	AFlyPawn* Pawn = PC ? Cast<AFlyPawn>(PC->GetPawn()) : nullptr;
	if (Pawn)
	{
		Pawn->ClearFollowTarget();
		Notify(TEXT("StopFocus (free-fly restored)"));
	}
}

void ACreatureDirector::FocusHerdOverview()
{
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	AFlyPawn* Pawn = PC ? Cast<AFlyPawn>(PC->GetPawn()) : nullptr;
	if (!Pawn)
	{
		Notify(TEXT("FocusHerdOverview: no AFlyPawn possessed"));
		return;
	}

	Pawn->ClearFollowTarget();

	FVector Centroid = FVector::ZeroVector;
	int32 N = 0;
	for (const TPair<FName, TObjectPtr<ASceneCreature>>& Kv : Creatures)
	{
		if (ASceneCreature* C = Kv.Value.Get())
		{
			Centroid += C->GetActorLocation();
			++N;
		}
	}
	if (N == 0)
	{
		Notify(TEXT("FocusHerdOverview: no creatures"));
		return;
	}
	Centroid /= static_cast<float>(N);

	// South-east of the herd, elevated — frames the group without chase-cam jitter.
	const FVector CamLoc = Centroid + FVector(2200.f, -1600.f, 2400.f);
	Pawn->SetActorLocation(CamLoc);
	if (PC)
	{
		const FVector LookAt = Centroid + FVector(0.f, 0.f, 200.f);
		PC->SetControlRotation((LookAt - CamLoc).Rotation());
	}
	Notify(FString::Printf(TEXT("FocusHerdOverview (%d creatures)"), N));
}
