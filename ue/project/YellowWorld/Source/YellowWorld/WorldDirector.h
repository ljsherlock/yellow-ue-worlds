#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "WorldDirector.generated.h"

class ADirectionalLight;
class ASkyLight;
class AExponentialHeightFog;
class AVolumetricCloud;
class AWindDirectionalSource;
class APostProcessVolume;
class ACameraActor;
class AStaticMeshActor;
class UMaterialInstanceDynamic;

/**
 * AWorldDirector is the single, authoritative entry point the LLM brain drives
 * via the Remote Control API. The brain (through our rc-bridge) calls these
 * BlueprintCallable UFUNCTIONs by object path over HTTP; each one mutates the
 * live world. Keeping every world mutation behind one actor mirrors the
 * WorldAPI contract on the TypeScript side (one source of truth per verb).
 *
 * Tier 1 ("open up all the controls"): every verb here mutates a *stock engine
 * actor* (DirectionalLight, SkyLight, ExponentialHeightFog, VolumetricCloud,
 * WindDirectionalSource, PostProcessVolume, CameraActor) or a procedural
 * material instance at runtime. No imported art assets required — make_map.py
 * spawns the actors at build time and this actor caches + drives them.
 */
UCLASS()
class YELLOWWORLD_API AWorldDirector : public AActor
{
	GENERATED_BODY()

public:
	AWorldDirector();

	// --- Sun & time of day -------------------------------------------------

	/** Map a 24h clock (0..24) to a sun elevation and apply it. 6=sunrise, 12=noon, 18=sunset. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetTimeOfDay(float Hours);

	/** Directional light brightness in lux (clear midday ~ 75000–120000). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetSunIntensity(float Lux);

	/** Warm/cool the sun via colour temperature in Kelvin (1700 fire, 6500 noon, 12000 cool). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetSunTemperature(float Kelvin);

	/** Ambient fill from the sky capture (0 = pitch shadows, 1 = flat, higher = blown). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetSkyLightIntensity(float Intensity);

	// --- Fog ---------------------------------------------------------------

	/** ExponentialHeightFog density (0..~0.2 useful) and vertical falloff. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Fog")
	void SetFog(float Density, float HeightFalloff);

	/** Fog inscattering colour (0..1 linear). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Fog")
	void SetFogColor(float R, float G, float B);

	/** Toggle volumetric (light-shafted) fog vs the cheap height fog. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Fog")
	void SetVolumetricFog(bool bEnabled);

	// --- Clouds ------------------------------------------------------------

	/**
	 * Coverage 0..1. NOTE: true volumetric-cloud coverage lives in the cloud
	 * material; until we author a parameterised cloud material this verb toggles
	 * the cloud layer's visibility (coverage < 0.05 hides it) so "clear vs
	 * cloudy" works. Fine-grained density is a documented follow-up.
	 */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetCloudiness(float Coverage);

	// --- Wind --------------------------------------------------------------

	/** Wind heading (degrees), strength (0..1+) and gust speed. Drives foliage/cloth later. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Weather")
	void SetWind(float DirectionDegrees, float Strength, float Speed);

	// --- Ground ------------------------------------------------------------

	/** Recolour the procedural ground material (linear 0..1). Tan=dry, olive=greener. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Ground")
	void SetGroundColor(float R, float G, float B);

	// --- Post process / colour grade --------------------------------------

	/** Exposure compensation in EV (negative = darker, positive = brighter).
	 *  In Manual metering this is the absolute fixed exposure. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Grade")
	void SetExposure(float ExposureBias);

	/** Set the deterministic base exposure (EV) that every preset/time is offset
	 *  from. Lets us re-tune the whole scene's brightness live without a rebuild. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Grade")
	void SetBaseExposure(float ExposureComp);

	/** White balance (Kelvin), saturation (1=neutral) and contrast (1=neutral). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Grade")
	void SetColorGrade(float WhiteTemp, float Saturation, float Contrast);

	// --- Camera / framing --------------------------------------------------

	/** Move the streamed view. Presets: "aerial", "ground", "wide", "closeup", "default". */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Camera")
	void SetCameraView(const FString& Preset);

	/** Field of view in degrees (lower = telephoto/compressed, higher = wide). */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Camera")
	void SetCameraFOV(float FOV);

	// --- Composite ---------------------------------------------------------

	/** One-shot mood: "clear", "cloudy", "storm", "sunset", "night", "dusty", "misty". */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Weather")
	void SetWeatherPreset(const FString& Preset);

	/** Back-compat (Spike 1b): sun pitch + cloud + fog in one call. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "Yellow|Sky")
	void SetSkyState(float SunPitchDegrees, float CloudCover, float FogDensity);

	// State mirror (handy in editor / debugging).
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentSunPitch = 35.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentSunYaw = -45.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentCloudCover = 0.2f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float CurrentFogDensity = 0.02f;

	/** Deterministic Manual-exposure baseline (EV). Daylight at physical lux needs
	 *  a large negative value; tune live via SetBaseExposure, then bake here. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|World")
	float BaseExposureComp = -13.f;

protected:
	virtual void BeginPlay() override;

private:
	/** Find and cache the stock atmosphere/camera actors spawned by make_map.py. */
	void CacheActors();

	/** Lazily create a dynamic material instance on the ground so we can recolour it. */
	UMaterialInstanceDynamic* GetGroundMID();

	/** Force deterministic Manual metering (no eye-adaptation) so a given time of
	 *  day always looks identical regardless of what was previously on screen. */
	void ApplyManualExposure();

	/** Apply BaseExposureComp + a per-mood EV offset to the post-process volume. */
	void ApplyExposure(float OffsetEV);

	/** Apply CurrentSunPitch/Yaw to the cached directional light. */
	void ApplySunRotation();

	UPROPERTY() TObjectPtr<ADirectionalLight> Sun;
	UPROPERTY() TObjectPtr<ASkyLight> Sky;
	UPROPERTY() TObjectPtr<AExponentialHeightFog> Fog;
	UPROPERTY() TObjectPtr<AVolumetricCloud> Clouds;
	UPROPERTY() TObjectPtr<AWindDirectionalSource> Wind;
	UPROPERTY() TObjectPtr<APostProcessVolume> PostProcess;
	UPROPERTY() TObjectPtr<ACameraActor> ViewCamera;
	UPROPERTY() TObjectPtr<AStaticMeshActor> Ground;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> GroundMID;
};
