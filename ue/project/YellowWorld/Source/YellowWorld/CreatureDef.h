#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "CreatureDef.generated.h"

class USkeletalMesh;
class UAnimInstance;
class UAnimSequenceBase;

/**
 * One row of the creature catalog (DataTable row name == creature *type*, e.g.
 * "elephant_adult"). This is the single data-driven seam that keeps the C++
 * generic: the director/brain speak in type + state strings, and this struct
 * maps a type to its concrete art (mesh, anims) for *this* species. Adding the
 * jeep or a lion later = one more row, no new code.
 *
 * Animation is intentionally two-tier:
 *   * If AnimClass is set, we use that Animation Blueprint (it reads the
 *     creature's CurrentState / CurrentSpeed) — the eventual production path.
 *   * If AnimClass is empty, we fall back to single-node PlayAnimation using
 *     StateToClip. This lets the proof-of-concept animate a freshly imported
 *     pack (MalberS ships AnimSequences but NO controller/Blueprint) before any
 *     AnimBP is authored in-editor.
 */
USTRUCT(BlueprintType)
struct FCreatureDef : public FTableRowBase
{
	GENERATED_BODY()

	/** Skeletal mesh for this species (soft — loaded on spawn, fine if unset during scaffolding). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	TSoftObjectPtr<USkeletalMesh> Mesh;

	/** Optional Animation Blueprint. Unset => single-node PlayAnimation via StateToClip. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	TSoftClassPtr<UAnimInstance> AnimClass;

	/** Generic state -> this species' clip. Keys are the verbs the brain uses
	 *  ("idle", "walk", "run", "drink", "graze", ...); values are the pack's clips. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	TMap<FName, TSoftObjectPtr<UAnimSequenceBase>> StateToClip;

	/** Planar walk speed (cm/s). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	float WalkSpeed = 250.f;

	/** Planar run speed (cm/s). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	float RunSpeed = 600.f;

	/** Uniform actor scale applied at spawn (pack units vary). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	float UniformScale = 1.f;

	/** Yaw offset (deg) if the mesh's forward axis isn't +X, so it faces travel direction. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Creature")
	float MeshYawOffset = 0.f;
};
