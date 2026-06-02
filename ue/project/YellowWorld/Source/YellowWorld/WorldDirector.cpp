#include "WorldDirector.h"

#include "Engine/DirectionalLight.h"
#include "Components/DirectionalLightComponent.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"

AWorldDirector::AWorldDirector()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AWorldDirector::BeginPlay()
{
	Super::BeginPlay();
	ApplySunPitch();
}

void AWorldDirector::SetSkyState(float SunPitchDegrees, float CloudCover, float FogDensity)
{
	CurrentSunPitch = SunPitchDegrees;
	CurrentCloudCover = CloudCover;
	CurrentFogDensity = FogDensity;

	ApplySunPitch();

	UE_LOG(LogTemp, Display,
		TEXT("[WorldDirector] SetSkyState sun=%.1f cloud=%.2f fog=%.3f"),
		SunPitchDegrees, CloudCover, FogDensity);

	if (GEngine)
	{
		GEngine->AddOnScreenDebugMessage(
			-1, 5.f, FColor::Yellow,
			FString::Printf(TEXT("SetSkyState sun=%.1f cloud=%.2f fog=%.3f"),
				SunPitchDegrees, CloudCover, FogDensity));
	}
}

void AWorldDirector::ApplySunPitch()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// Rotate the first directional light to the requested sun pitch. This is a
	// deliberately simple, visible effect so Spike 1b can confirm the full
	// brain -> Remote Control -> world -> stream loop end to end.
	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		const FRotator NewRotation(-CurrentSunPitch, It->GetActorRotation().Yaw, 0.f);
		It->SetActorRotation(NewRotation);
		return;
	}

	UE_LOG(LogTemp, Warning,
		TEXT("[WorldDirector] No DirectionalLight found to apply sun pitch."));
}
