#include "StreamBridge.h"

#include "CreatureDirector.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UnrealType.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

AStreamBridge::AStreamBridge()
{
	PrimaryActorTick.bCanEverTick = false;
}

void AStreamBridge::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	// Create + register the PS2 input component BEFORE BeginPlay. The component
	// registers itself into the plugin's global InputComponents map in its OWN
	// BeginPlay, and that map is what EpicRtcStreamer broadcasts UI interactions
	// to. Creating it here means the actor's BeginPlay dispatch reliably calls
	// the component's BeginPlay; creating it inside our BeginPlay (after
	// Super::BeginPlay already dispatched component BeginPlays) left it out of
	// the map, so emitUIInteraction never reached us (outbound still worked
	// because SendPixelStreaming2Response bypasses the map via ForEachStreamer).
	if (UClass* Cls = FindObject<UClass>(nullptr, TEXT("/Script/PixelStreaming2.PixelStreaming2Input")))
	{
		InputComp = NewObject<UActorComponent>(this, Cls, TEXT("PSInput"));
		if (InputComp)
		{
			InputComp->RegisterComponent();
		}
	}
}

void AStreamBridge::BeginPlay()
{
	Super::BeginPlay();

	if (InputComp)
	{
		SendFn = InputComp->FindFunction(FName(TEXT("SendPixelStreaming2Response")));
		BindUiInput();
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

void AStreamBridge::BindUiInput()
{
	if (!InputComp)
	{
		return;
	}

	FMulticastDelegateProperty* OnInput = FindFProperty<FMulticastDelegateProperty>(
		InputComp->GetClass(), TEXT("OnInputEvent"));
	if (!OnInput)
	{
		UE_LOG(LogTemp, Warning, TEXT("[StreamBridge] OnInputEvent not found on PixelStreaming2Input"));
		return;
	}

	FScriptDelegate Delegate;
	Delegate.BindUFunction(this, GET_FUNCTION_NAME_CHECKED(AStreamBridge, HandleUiInteraction));
	OnInput->AddDelegate(Delegate, InputComp);
	UE_LOG(LogTemp, Display,
		TEXT("[StreamBridge] bound HandleUiInteraction to OnInputEvent on %s"),
		*InputComp->GetClass()->GetName());
}

void AStreamBridge::HandleUiInteraction(const FString& Descriptor)
{
	TSharedPtr<FJsonObject> Json;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Descriptor);
	if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
	{
		return;
	}

	FString Cmd;
	if (!Json->TryGetStringField(TEXT("hyCmd"), Cmd))
	{
		return;
	}

	UE_LOG(LogTemp, Display, TEXT("[StreamBridge] UI cmd '%s' (%s)"), *Cmd, *Descriptor);

	if (!Director.IsValid())
	{
		if (AActor* D = UGameplayStatics::GetActorOfClass(this, ACreatureDirector::StaticClass()))
		{
			Director = Cast<ACreatureDirector>(D);
		}
	}
	ACreatureDirector* Dir = Director.Get();
	if (!Dir)
	{
		return;
	}

	if (Cmd == TEXT("StopFocus"))
	{
		Dir->StopFocus();
	}
	else if (Cmd == TEXT("FocusHerdOverview"))
	{
		Dir->FocusHerdOverview();
	}
	else if (Cmd == TEXT("FocusCamera"))
	{
		FString Id;
		if (Json->TryGetStringField(TEXT("id"), Id) && !Id.IsEmpty())
		{
			Dir->FocusCamera(Id);
		}
	}
}

void AStreamBridge::PushState()
{
	if (!InputComp || !SendFn)
	{
		return;
	}

	if (!Director.IsValid())
	{
		if (AActor* D = UGameplayStatics::GetActorOfClass(this, ACreatureDirector::StaticClass()))
		{
			Director = Cast<ACreatureDirector>(D);
		}
	}

	const FString Creatures = Director.IsValid() ? Director->QueryCreatures() : FString(TEXT("[]"));
	const FString Payload = FString::Printf(TEXT("{\"t\":\"creatures\",\"creatures\":%s}"), *Creatures);

	struct FSendParams
	{
		FString Descriptor;
	};
	FSendParams Params;
	Params.Descriptor = Payload;
	InputComp->ProcessEvent(SendFn, &Params);
}
