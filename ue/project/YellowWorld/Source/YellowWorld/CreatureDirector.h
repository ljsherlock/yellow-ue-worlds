#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CreatureDef.h"
#include "CreatureDirector.generated.h"

class ASceneCreature;
class UDataTable;

/**
 * ACreatureDirector is the creature analogue of AWorldDirector: a single actor
 * the LLM brain drives over Remote Control to populate and choreograph living
 * things. AWorldDirector owns atmosphere/camera; this owns actors.
 *
 * Every verb is generic and keyed by a string id + type, never by "elephant",
 * so the same surface drives lions, herds and the jeep once their rows exist in
 * CreatureTable. The proof-of-concept wires only the elephant; the rest of the
 * plan slots in as (a) more DataTable rows and (b) more brain-side verbs that
 * map onto these same RC calls.
 */
UCLASS()
class YELLOWWORLD_API ACreatureDirector : public AActor
{
	GENERATED_BODY()

public:
	ACreatureDirector();

	/** Species catalog: row name == creature type. Assigned in-editor or by the
	 *  authoring script once a pack (e.g. the elephant) is imported. Optional —
	 *  DefineCreatureType can register types at runtime instead. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Creatures")
	TObjectPtr<UDataTable> CreatureTable;

	/**
	 * Register a creature type at runtime (no DataTable asset needed). This is
	 * how the proof-of-concept wires the elephant over Remote Control: the scene
	 * script calls this once per type before spawning. ClipsCsv maps generic
	 * states to this pack's clip object paths, e.g.
	 *   "idle=/Game/Elephant/Animations/Ele_C_Idle_01.Ele_C_Idle_01;
	 *    walk=/Game/Elephant/Animations/Ele_IP_Walk.Ele_IP_Walk;
	 *    run=/Game/Elephant/Animations/Ele_IP_Run_Forward.Ele_IP_Run_Forward;
	 *    drink=/Game/Elephant/Animations/Ele_C_Drink.Ele_C_Drink"
	 * MeshPath is the SkeletalMesh object path. Adding lions/the jeep later = one
	 * more call, no recompile.
	 */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void DefineCreatureType(const FString& Type, const FString& MeshPath, const FString& ClipsCsv,
		float WalkSpeed, float RunSpeed, float UniformScale, float MeshYawOffset);

	/** Spawn a creature of `Type` (a CreatureTable row) with handle `Id` at X,Y (ground-snapped), facing Yaw. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SpawnCreature(const FString& Type, const FString& Id, float X, float Y, float Yaw);

	/** Walk/run `Id` to a world X,Y at Speed cm/s (0 => the def's walk speed). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void MoveCreatureTo(const FString& Id, float X, float Y, float Speed);

	/** Send `Id` along a polyline "x,y;x,y;..." (world cm). bLoop repeats it. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void FollowPath(const FString& Id, const FString& PointsCsv, bool bLoop, float Speed);

	/** Set a state/action ("idle","walk","run","drink","graze",...); non-locomotion states stop travel. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetCreatureState(const FString& Id, const FString& State);

	/** Force a specific clip key from the def's state->clip map (debug/explicit). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void PlayCreatureAnim(const FString& Id, const FString& Clip);

	/** Make `Id` follow `LeaderId`, keeping ~Distance cm (e.g. baby trails the adult). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetCreatureLeader(const FString& Id, const FString& LeaderId, float Distance);

	/** Have `Id` wander randomly within Radius cm of CenterX,CenterY ("random behaviour" demo). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void WanderCreature(const FString& Id, float CenterX, float CenterY, float Radius, float Speed);

	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void DespawnCreature(const FString& Id);

	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void ClearCreatures();

	/** Log the live registry (debug). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void ListCreatures();

	/** Read-back: return a JSON array of every live creature's state
	 *  (id,type,state,x,y,z,speed,arrived,atWater). Unlike ListCreatures (which
	 *  only logs), this RETURNS over Remote Control so the brain/sim can perceive
	 *  the world instead of guessing with wall-clock sleeps. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	FString QueryCreatures();

	/** Read-back for one creature: JSON object as above, or "{}" if unknown. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	FString QueryCreature(const FString& Id);

	/** Seed/override a drive ("thirst"/"fatigue") to a 0..1 value. The brain calls
	 *  this at spawn so the prompt sets initial motivation (e.g. "they walked far"
	 *  -> high thirst), then the creature's utility layer acts on it. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetCreatureDrive(const FString& Id, const FString& Drive, float Value);

	/** Enable/disable a creature's autonomous (drive-driven) behaviour. Off = the
	 *  scene is fully hand-directed; on (default) = drives fill idle gaps. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetCreatureAutonomy(const FString& Id, bool bEnabled);

	/** Where the herd drinks: lake centre (XY), surface Z, and planar radius (cm).
	 *  Thirsty creatures path to the nearest rim point and only halt at the
	 *  shoreline when within that radius. Applies to all live + future creatures. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetWaterSource(float X, float Y, float SurfaceZ, float Radius);

	/** Pop-and-clear the buffered world events as a JSON array
	 *  ([{"id","event"},...]). This is the push event channel the slow LLM loop
	 *  drains instead of re-polling full state every tick. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	FString DrainEvents();

	/** Point the streamed camera at a creature and trail it. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void FocusCamera(const FString& Id);

	/** Release the camera back to free-fly. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void StopFocus();

	/** Park the streamed camera above the herd centroid (no follow-cam). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void FocusHerdOverview();

	/** Append a world event to the drain queue (called by ASceneCreature). Not a
	 *  remote verb — internal plumbing for DrainEvents. */
	void ReportEvent(const FString& Id, const FString& Event);

	/**
	 * Tell every creature the surface height (cm) of the water they're heading
	 * for so they stop at the shoreline instead of walking down the (collision-
	 * less) lakebed. Applies to all live creatures and is remembered for ones
	 * spawned afterwards. Pass a very low Z (or call with the lake's surface)
	 * per scene; e.g. lake1 -8700, lake2 -6000.
	 */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Creatures")
	void SetWaterLevel(float SurfaceZ);

private:
	UPROPERTY() TMap<FName, TObjectPtr<ASceneCreature>> Creatures;

	/** Last SetWaterLevel value, re-applied to creatures spawned later. */
	bool bHaveWaterZ = false;
	float SceneWaterZ = 0.f;

	/** Last SetWaterSource (centre + surface Z + radius), re-applied on spawns. */
	bool bHaveWaterSource = false;
	FVector SceneWaterSource = FVector::ZeroVector;
	float SceneWaterRadius = 26000.f;

	/** Buffered world events, drained over RC by DrainEvents(). Capped so a brain
	 *  that never drains can't grow it without bound. */
	TArray<FString> EventQueue;
	static constexpr int32 MaxEvents = 256;

	/** Types registered at runtime via DefineCreatureType (checked before CreatureTable). */
	UPROPERTY() TMap<FName, FCreatureDef> DefinedTypes;

	ASceneCreature* Find(const FString& Id) const;
	float GroundZAt(float X, float Y) const;
	const FCreatureDef* ResolveDef(const FName& Type) const;
};
