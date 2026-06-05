#include "StreamBridge.h"

#include "CreatureDirector.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"
#include "UObject/UObjectGlobals.h"

AStreamBridge::AStreamBridge()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AStreamBridge::BeginPlay()
{
	Super::BeginPlay();

	// Create the PixelStreaming2 input component by class so we don't take a
	// build dependency on the plugin's internal headers. The class is registered
	// once the (already-enabled) plugin is loaded.
	if (UClass* Cls = FindObject<UClass>(nullptr, TEXT("/Script/PixelStreaming2.PixelStreaming2Input")))
	{
		InputComp = NewObject<UActorComponent>(this, Cls, TEXT("PSInput"));
		if (InputComp)
		{
			InputComp->RegisterComponent();
			SendFn = InputComp->FindFunction(FName(TEXT("SendPixelStreaming2Response")));
		}
	}

	if (!InputComp || !SendFn)
	{
		UE_LOG(LogTemp, Warning,
			TEXT("[StreamBridge] PixelStreaming2 input unavailable; drives push disabled"));
		return;
	}

	if (AActor* D = UGameplayStatics::GetActorOfClass(this, ACreatureDirector::StaticClass()))
	{
		Director = Cast<ACreatureDirector>(D);
	}

	GetWorldTimerManager().SetTimer(PushTimer, this, &AStreamBridge::PushState, PushIntervalSec, true, 1.0f);
	UE_LOG(LogTemp, Display, TEXT("[StreamBridge] pushing creature state every %.2fs"), PushIntervalSec);
}

void AStreamBridge::PushState()
{
	if (!InputComp || !SendFn)
	{
		return;
	}

	// The director may be spawned/baked slightly after us; re-resolve until found.
	if (!Director.IsValid())
	{
		if (AActor* D = UGameplayStatics::GetActorOfClass(this, ACreatureDirector::StaticClass()))
		{
			Director = Cast<ACreatureDirector>(D);
		}
	}

	const FString Creatures = Director.IsValid() ? Director->QueryCreatures() : FString(TEXT("[]"));
	const FString Payload = FString::Printf(TEXT("{\"t\":\"creatures\",\"creatures\":%s}"), *Creatures);

	// Matches UPixelStreaming2Input::SendPixelStreaming2Response(const FString&).
	struct FSendParams
	{
		FString Descriptor;
	};
	FSendParams Params;
	Params.Descriptor = Payload;
	InputComp->ProcessEvent(SendFn, &Params);
}
