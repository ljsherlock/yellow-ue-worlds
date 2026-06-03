#include "WorldDirector.h"

#include "Engine/DirectionalLight.h"
#include "Components/DirectionalLightComponent.h"
#include "Engine/SkyLight.h"
#include "Components/SkyLightComponent.h"
#include "Engine/ExponentialHeightFog.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/VolumetricCloudComponent.h" // also declares AVolumetricCloud
#include "Engine/WindDirectionalSource.h"
#include "Components/WindDirectionalSourceComponent.h"
#include "Engine/PostProcessVolume.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"
#include "Engine/World.h"

namespace
{
	/** Tiny helper: find the first actor of a class in the world (or nullptr). */
	template <typename T>
	T* FindFirst(UWorld* World)
	{
		if (!World)
		{
			return nullptr;
		}
		for (TActorIterator<T> It(World); It; ++It)
		{
			return *It;
		}
		return nullptr;
	}

	void Notify(const FString& Msg)
	{
		UE_LOG(LogTemp, Display, TEXT("[WorldDirector] %s"), *Msg);
		if (GEngine)
		{
			GEngine->AddOnScreenDebugMessage(-1, 4.f, FColor::Yellow, Msg);
		}
	}
}

AWorldDirector::AWorldDirector()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AWorldDirector::BeginPlay()
{
	Super::BeginPlay();
	CacheActors();
	ApplyManualExposure();
	ApplySunRotation();
}

void AWorldDirector::ApplyManualExposure()
{
	// Deterministic exposure: switch metering to Manual so the renderer NEVER
	// eye-adapts. A given time of day then always looks the same, and the scene
	// can't blow out to white the way auto-exposure did. Brightness is driven
	// purely by the sun/sky intensities we set per time-of-day. (Epic 5.7 docs:
	// "Manual metering mode allows ... a single, fixed exposure value that is
	// unaffected by the luminance in the scene.")
	if (!PostProcess)
	{
		return;
	}
	FPostProcessSettings& S = PostProcess->Settings;
	S.bOverride_AutoExposureMethod = true;
	S.AutoExposureMethod = AEM_Manual;
	// Keep exposure in linear-EV terms, independent of any physical-camera
	// (ISO/aperture/shutter) settings, so BaseExposureComp behaves predictably.
	S.bOverride_AutoExposureApplyPhysicalCameraExposure = true;
	S.AutoExposureApplyPhysicalCameraExposure = 0;
	ApplyExposure(0.f);
}

void AWorldDirector::ApplyExposure(float OffsetEV)
{
	if (!PostProcess)
	{
		return;
	}
	PostProcess->Settings.bOverride_AutoExposureBias = true;
	PostProcess->Settings.AutoExposureBias = BaseExposureComp + OffsetEV;
}

void AWorldDirector::CacheActors()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	Sun = FindFirst<ADirectionalLight>(World);
	Sky = FindFirst<ASkyLight>(World);
	Fog = FindFirst<AExponentialHeightFog>(World);
	Clouds = FindFirst<AVolumetricCloud>(World);
	Wind = FindFirst<AWindDirectionalSource>(World);
	PostProcess = FindFirst<APostProcessVolume>(World);
	ViewCamera = FindFirst<ACameraActor>(World);

	// The ground is the StaticMeshActor tagged "ground" by make_map.py.
	for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
	{
		if (It->ActorHasTag(TEXT("ground")))
		{
			Ground = *It;
			break;
		}
	}

	Notify(FString::Printf(TEXT("cached: sun=%d sky=%d fog=%d clouds=%d wind=%d pp=%d cam=%d ground=%d"),
		Sun != nullptr, Sky != nullptr, Fog != nullptr, Clouds != nullptr,
		Wind != nullptr, PostProcess != nullptr, ViewCamera != nullptr, Ground != nullptr));
}

UMaterialInstanceDynamic* AWorldDirector::GetGroundMID()
{
	if (GroundMID)
	{
		return GroundMID;
	}
	if (Ground)
	{
		if (UStaticMeshComponent* Comp = Ground->GetStaticMeshComponent())
		{
			GroundMID = Comp->CreateAndSetMaterialInstanceDynamic(0);
		}
	}
	return GroundMID;
}

void AWorldDirector::ApplySunRotation()
{
	if (Sun)
	{
		Sun->SetActorRotation(FRotator(-CurrentSunPitch, CurrentSunYaw, 0.f));
	}
}

// --- Sun & time ------------------------------------------------------------

void AWorldDirector::SetTimeOfDay(float Hours)
{
	Hours = FMath::Fmod(FMath::Max(Hours, 0.f), 24.f);

	// Continuous arc so EVERY hour is a distinct, visible sun position:
	//  - elevation: -90 (deep night) .. +90 (noon overhead), 0 at 6h/18h,
	//  - azimuth: sweeps the sky across the day (east at dawn -> west at dusk).
	const float ElevationDeg = 90.f * FMath::Sin((Hours - 6.f) / 12.f * PI);
	const float AzimuthDeg = (Hours / 24.f) * 360.f - 180.f;
	CurrentSunPitch = ElevationDeg;
	CurrentSunYaw = AzimuthDeg;
	ApplySunRotation();

	// Drive brightness from the sun's height so dusk/night dim automatically.
	// DayFactor: 0 at/below the horizon, 1 high in the sky.
	const float DayFactor = FMath::Clamp(ElevationDeg / 60.f, 0.f, 1.f);
	if (Sun)
	{
		if (UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			// Direct sun fades to nothing below the horizon (no negative light).
			C->SetIntensity(FMath::Lerp(0.f, 110000.f, DayFactor));
		}
	}
	if (Sky)
	{
		if (USkyLightComponent* C = Sky->GetLightComponent())
		{
			// Ambient floor keeps night moonlit-dark, never pure black.
			C->SetIntensity(FMath::Lerp(0.25f, 1.0f, DayFactor));
		}
	}
	Notify(FString::Printf(TEXT("SetTimeOfDay %.1fh -> elev %.1f az %.1f day %.2f"),
		Hours, ElevationDeg, AzimuthDeg, DayFactor));
}

void AWorldDirector::SetSunIntensity(float Lux)
{
	if (Sun)
	{
		if (UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			C->SetIntensity(Lux);
		}
	}
	Notify(FString::Printf(TEXT("SetSunIntensity %.0f lux"), Lux));
}

void AWorldDirector::SetSunTemperature(float Kelvin)
{
	if (Sun)
	{
		if (UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			C->SetUseTemperature(true);
			C->SetTemperature(Kelvin);
		}
	}
	Notify(FString::Printf(TEXT("SetSunTemperature %.0fK"), Kelvin));
}

void AWorldDirector::SetSkyLightIntensity(float Intensity)
{
	if (Sky)
	{
		if (USkyLightComponent* C = Sky->GetLightComponent())
		{
			C->SetIntensity(Intensity);
		}
	}
	Notify(FString::Printf(TEXT("SetSkyLightIntensity %.2f"), Intensity));
}

// --- Fog -------------------------------------------------------------------

void AWorldDirector::SetFog(float Density, float HeightFalloff)
{
	CurrentFogDensity = Density;
	if (Fog)
	{
		if (UExponentialHeightFogComponent* C = Fog->FindComponentByClass<UExponentialHeightFogComponent>())
		{
			C->SetFogDensity(Density);
			C->SetFogHeightFalloff(HeightFalloff);
		}
	}
	Notify(FString::Printf(TEXT("SetFog density=%.3f falloff=%.3f"), Density, HeightFalloff));
}

void AWorldDirector::SetFogColor(float R, float G, float B)
{
	if (Fog)
	{
		if (UExponentialHeightFogComponent* C = Fog->FindComponentByClass<UExponentialHeightFogComponent>())
		{
			C->SetFogInscatteringColor(FLinearColor(R, G, B, 1.f));
		}
	}
	Notify(FString::Printf(TEXT("SetFogColor %.2f,%.2f,%.2f"), R, G, B));
}

void AWorldDirector::SetVolumetricFog(bool bEnabled)
{
	if (Fog)
	{
		if (UExponentialHeightFogComponent* C = Fog->FindComponentByClass<UExponentialHeightFogComponent>())
		{
			C->SetVolumetricFog(bEnabled);
		}
	}
	Notify(FString::Printf(TEXT("SetVolumetricFog %s"), bEnabled ? TEXT("on") : TEXT("off")));
}

// --- Clouds ----------------------------------------------------------------

void AWorldDirector::SetCloudiness(float Coverage)
{
	CurrentCloudCover = Coverage;
	if (Clouds)
	{
		Clouds->SetActorHiddenInGame(Coverage < 0.05f);
	}
	Notify(FString::Printf(TEXT("SetCloudiness %.2f (%s)"),
		Coverage, Coverage < 0.05f ? TEXT("clear") : TEXT("clouds visible")));
}

// --- Wind ------------------------------------------------------------------

void AWorldDirector::SetWind(float DirectionDegrees, float Strength, float Speed)
{
	if (Wind)
	{
		Wind->SetActorRotation(FRotator(0.f, DirectionDegrees, 0.f));
		if (UWindDirectionalSourceComponent* C = Wind->FindComponentByClass<UWindDirectionalSourceComponent>())
		{
			C->SetStrength(Strength);
			C->SetSpeed(Speed);
		}
	}
	Notify(FString::Printf(TEXT("SetWind dir=%.0f strength=%.2f speed=%.2f"),
		DirectionDegrees, Strength, Speed));
}

// --- Ground ----------------------------------------------------------------

void AWorldDirector::SetGroundColor(float R, float G, float B)
{
	if (UMaterialInstanceDynamic* MID = GetGroundMID())
	{
		MID->SetVectorParameterValue(TEXT("BaseColor"), FLinearColor(R, G, B, 1.f));
	}
	Notify(FString::Printf(TEXT("SetGroundColor %.2f,%.2f,%.2f"), R, G, B));
}

// --- Post process ----------------------------------------------------------

void AWorldDirector::SetExposure(float ExposureBias)
{
	if (PostProcess)
	{
		PostProcess->Settings.bOverride_AutoExposureBias = true;
		PostProcess->Settings.AutoExposureBias = ExposureBias;
	}
	Notify(FString::Printf(TEXT("SetExposure %.2f EV (absolute)"), ExposureBias));
}

void AWorldDirector::SetBaseExposure(float ExposureComp)
{
	BaseExposureComp = ExposureComp;
	ApplyExposure(0.f);
	Notify(FString::Printf(TEXT("SetBaseExposure %.2f EV"), BaseExposureComp));
}

void AWorldDirector::SetColorGrade(float WhiteTemp, float Saturation, float Contrast)
{
	if (PostProcess)
	{
		FPostProcessSettings& S = PostProcess->Settings;
		S.bOverride_WhiteTemp = true;
		S.WhiteTemp = WhiteTemp;
		S.bOverride_ColorSaturation = true;
		S.ColorSaturation = FVector4(Saturation, Saturation, Saturation, 1.f);
		S.bOverride_ColorContrast = true;
		S.ColorContrast = FVector4(Contrast, Contrast, Contrast, 1.f);
	}
	Notify(FString::Printf(TEXT("SetColorGrade temp=%.0f sat=%.2f con=%.2f"),
		WhiteTemp, Saturation, Contrast));
}

// --- Camera ----------------------------------------------------------------

void AWorldDirector::SetCameraView(const FString& Preset)
{
	if (!ViewCamera)
	{
		Notify(TEXT("SetCameraView: no CameraActor in level"));
		return;
	}

	const FString P = Preset.ToLower();
	FVector Loc(-1200.f, 0.f, 400.f);
	FRotator Rot(-10.f, 0.f, 0.f);

	if (P == TEXT("aerial"))
	{
		Loc = FVector(0.f, 0.f, 4000.f);
		Rot = FRotator(-80.f, 0.f, 0.f);
	}
	else if (P == TEXT("ground"))
	{
		Loc = FVector(-600.f, 0.f, 120.f);
		Rot = FRotator(-2.f, 0.f, 0.f);
	}
	else if (P == TEXT("wide"))
	{
		Loc = FVector(-2500.f, 1200.f, 800.f);
		Rot = FRotator(-12.f, -20.f, 0.f);
	}
	else if (P == TEXT("closeup"))
	{
		Loc = FVector(-400.f, 0.f, 200.f);
		Rot = FRotator(-8.f, 0.f, 0.f);
	}

	ViewCamera->SetActorLocationAndRotation(Loc, Rot);

	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		PC->SetViewTargetWithBlend(ViewCamera, 0.75f);
	}
	Notify(FString::Printf(TEXT("SetCameraView %s"), *Preset));
}

void AWorldDirector::SetCameraFOV(float FOV)
{
	if (ViewCamera)
	{
		if (UCameraComponent* C = ViewCamera->GetCameraComponent())
		{
			C->SetFieldOfView(FOV);
		}
	}
	Notify(FString::Printf(TEXT("SetCameraFOV %.0f"), FOV));
}

// --- Composite presets -----------------------------------------------------

void AWorldDirector::SetWeatherPreset(const FString& Preset)
{
	const FString P = Preset.ToLower();
	Notify(FString::Printf(TEXT("SetWeatherPreset %s"), *Preset));

	if (P == TEXT("clear"))
	{
		SetTimeOfDay(11.f);
		SetSunIntensity(100000.f);
		SetSunTemperature(6200.f);
		SetSkyLightIntensity(1.0f);
		SetFog(0.005f, 0.2f);
		SetVolumetricFog(false);
		SetCloudiness(0.0f);
		SetColorGrade(6500.f, 1.05f, 1.0f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("cloudy"))
	{
		SetTimeOfDay(12.f);
		SetSunIntensity(45000.f);
		SetSunTemperature(7000.f);
		SetSkyLightIntensity(1.4f);
		SetFog(0.02f, 0.2f);
		SetCloudiness(0.8f);
		SetColorGrade(7000.f, 0.85f, 0.95f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("storm"))
	{
		SetTimeOfDay(15.f);
		SetSunIntensity(15000.f);
		SetSunTemperature(8000.f);
		SetSkyLightIntensity(0.6f);
		SetFog(0.06f, 0.15f);
		SetVolumetricFog(true);
		SetFogColor(0.25f, 0.27f, 0.3f);
		SetCloudiness(1.0f);
		SetColorGrade(8000.f, 0.7f, 1.15f);
		ApplyExposure(-0.5f);
	}
	else if (P == TEXT("sunset"))
	{
		SetTimeOfDay(18.f);
		SetSunIntensity(35000.f);
		SetSunTemperature(2400.f);
		SetSkyLightIntensity(0.8f);
		SetFog(0.03f, 0.1f);
		SetFogColor(0.8f, 0.5f, 0.3f);
		SetCloudiness(0.4f);
		SetColorGrade(3200.f, 1.2f, 1.05f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("night"))
	{
		SetTimeOfDay(0.f);
		SetSunIntensity(2000.f);
		SetSunTemperature(9000.f);
		SetSkyLightIntensity(0.3f);
		SetFog(0.02f, 0.2f);
		SetCloudiness(0.3f);
		SetColorGrade(9000.f, 0.8f, 1.1f);
		ApplyExposure(1.0f);
	}
	else if (P == TEXT("dusty"))
	{
		SetTimeOfDay(13.f);
		SetSunIntensity(70000.f);
		SetSunTemperature(4200.f);
		SetSkyLightIntensity(1.1f);
		SetFog(0.04f, 0.25f);
		SetFogColor(0.7f, 0.6f, 0.42f);
		SetCloudiness(0.2f);
		SetColorGrade(4500.f, 0.9f, 1.0f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("misty"))
	{
		SetTimeOfDay(7.f);
		SetSunIntensity(30000.f);
		SetSunTemperature(6800.f);
		SetSkyLightIntensity(1.3f);
		SetFog(0.08f, 0.05f);
		SetVolumetricFog(true);
		SetFogColor(0.7f, 0.72f, 0.75f);
		SetCloudiness(0.5f);
		SetColorGrade(6800.f, 0.8f, 0.9f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("sunrise"))
	{
		SetTimeOfDay(6.5f);
		SetSunIntensity(20000.f);
		SetSunTemperature(3000.f);
		SetSkyLightIntensity(0.9f);
		SetFog(0.04f, 0.08f);
		SetFogColor(0.85f, 0.6f, 0.45f);
		SetCloudiness(0.3f);
		SetColorGrade(3400.f, 1.15f, 1.0f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("midday") || P == TEXT("noon"))
	{
		SetTimeOfDay(12.f);
		SetSunIntensity(110000.f);
		SetSunTemperature(6500.f);
		SetSkyLightIntensity(1.0f);
		SetFog(0.004f, 0.2f);
		SetVolumetricFog(false);
		SetCloudiness(0.1f);
		SetColorGrade(6500.f, 1.05f, 1.0f);
		ApplyExposure(0.f);
	}
	else if (P == TEXT("reset") || P == TEXT("default"))
	{
		// Neutral, bright, no-drama baseline — the "undo" for any prior mood.
		SetTimeOfDay(11.f);
		SetSunIntensity(100000.f);
		SetSunTemperature(6500.f);
		SetSkyLightIntensity(1.0f);
		SetFog(0.005f, 0.2f);
		SetVolumetricFog(false);
		SetFogColor(0.5f, 0.55f, 0.6f);
		SetCloudiness(0.1f);
		SetColorGrade(6500.f, 1.0f, 1.0f);
		ApplyExposure(0.f);
	}
	else
	{
		Notify(FString::Printf(TEXT("Unknown preset '%s' (clear|cloudy|storm|sunset|sunrise|midday|night|dusty|misty|reset)"), *Preset));
	}
}

// --- Back-compat -----------------------------------------------------------

void AWorldDirector::SetSkyState(float SunPitchDegrees, float CloudCover, float FogDensity)
{
	CurrentSunPitch = SunPitchDegrees;
	ApplySunRotation();
	SetCloudiness(CloudCover);
	SetFog(FogDensity, 0.2f);
	Notify(FString::Printf(TEXT("SetSkyState sun=%.1f cloud=%.2f fog=%.3f"),
		SunPitchDegrees, CloudCover, FogDensity));
}
