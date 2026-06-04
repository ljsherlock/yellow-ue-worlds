#include "CreatureDirector.h"

#include "SceneCreature.h"
#include "CreatureDef.h"
#include "Engine/DataTable.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "CollisionQueryParams.h"

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
	const FString& ClipsCsv, float WalkSpeed, float RunSpeed, float UniformScale)
{
	FCreatureDef Def;
	if (WalkSpeed > 0.f) { Def.WalkSpeed = WalkSpeed; }
	if (RunSpeed > 0.f) { Def.RunSpeed = RunSpeed; }
	Def.UniformScale = UniformScale > 0.f ? UniformScale : 1.f;

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
	Notify(FString::Printf(TEXT("DefineCreatureType '%s' mesh='%s' clips=%d walk=%.0f run=%.0f scale=%.2f"),
		*Type, *MeshPath, NumClips, Def.WalkSpeed, Def.RunSpeed, Def.UniformScale));
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

	const FCreatureDef* Def = ResolveDef(FName(*Type));
	if (Def)
	{
		Creature->ApplyDef(*Def);
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
