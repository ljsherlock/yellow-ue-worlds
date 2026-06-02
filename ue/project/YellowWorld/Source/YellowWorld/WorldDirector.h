#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WorldDirector.generated.h"

/**
 * AWorldDirector is the single, authoritative entry point the LLM brain drives
 * via the Remote Control API. The brain (through our rc-bridge) calls these
 * BlueprintCallable UFUNCTIONs by object path over HTTP; each one mutates the
 * live world. Keeping every world mutation behind one actor mirrors the
 * WorldAPI contract on the TypeScript side (one source of truth per verb).
 */
UCLASS()
class YELLOWWORLD_API AWorldDirector : public AActor
{
	GENERATED_BODY()

public:
	AWorldDirector();

	/** Push atmospheric state. Called remotely by the brain. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|World")
	void SetSkyState(float SunPitchDegrees, float CloudCover, float FogDensity);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentSunPitch = 35.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentCloudCover = 0.2f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentFogDensity = 0.02f;

protected:
	virtual void BeginPlay() override;

private:
	/** Apply CurrentSunPitch to the first DirectionalLight found in the level. */
	void ApplySunPitch();
};
