#include "StreamBridge.h"

#include "CreatureDirector.h"
#include "Blueprints/PixelStreaming2InputComponent.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

AStreamBridge::AStreamBridge()
{
	PrimaryActorTick.bCanEverTick = false;

	// Native subobject: the actor lifecycle is guaranteed to route its BeginPlay,
	// which self-registers it into the PixelStreaming2 InputComponents map the
	// streamer broadcasts UI interactions (camera buttons) to. See the header note.
	InputComp = CreateDefaultSubobject<UPixelStreaming2Input>(TEXT("PSInput"));
}

void AStreamBridge::BeginPlay()
{
	Super::BeginPlay();

	if (InputComp)
	{
		// Type-safe bind straight to the dynamic multicast delegate (inline, no
		// external symbol needed). Outbound goes via reflection (see PushState).
		InputComp->OnInputEvent.AddDynamic(this, &AStreamBridge::HandleUiInteraction);
		SendFn = InputComp->FindFunction(FName(TEXT("SendPixelStreaming2Response")));
		UE_LOG(LogTemp, Display,
			TEXT("[StreamBridge] bound HandleUiInteraction (send=%d) begun=%d registered=%d active=%d bound=%d"),
			SendFn != nullptr,
			InputComp->HasBegunPlay(),
			InputComp->IsRegistered(),
			InputComp->IsActive(),
			InputComp->OnInputEvent.IsBound());
		UE_LOG(LogTemp, Display, TEXT("[StreamBridge] my path = %s"), *GetPathName());
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("[StreamBridge] no PS2 input component; inbound UI disabled"));
	}

	if (AActor* D = UGameplayStatics::GetActorOfClass(this, ACreatureDirector::StaticClass()))
	{
		Director = Cast<ACreatureDirector>(D);
	}

	GetWorldTimerManager().SetTimer(PushTimer, this, &AStreamBridge::PushState, PushIntervalSec, true, 1.0f);
	UE_LOG(LogTemp, Display, TEXT("[StreamBridge] pushing creature state every %.2fs"), PushIntervalSec);
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

void AStreamBridge::DebugFireInput()
{
	if (!InputComp)
	{
		UE_LOG(LogTemp, Warning, TEXT("[StreamBridge] DebugFireInput: InputComp is null"));
		return;
	}
	UE_LOG(LogTemp, Display,
		TEXT("[StreamBridge] DebugFireInput: begun=%d registered=%d active=%d bound=%d -> broadcasting test"),
		InputComp->HasBegunPlay(), InputComp->IsRegistered(), InputComp->IsActive(),
		InputComp->OnInputEvent.IsBound());
	// Manually fire the same delegate the streamer broadcasts to. If this reaches
	// HandleUiInteraction, the binding is fine and the real failure is map
	// membership; if not, the binding itself is broken.
	InputComp->OnInputEvent.Broadcast(TEXT("{\"hyCmd\":\"FocusHerdOverview\"}"));
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

	// Outbound to all connected players over the data channel. Called reflectively
	// because UPixelStreaming2Input::SendPixelStreaming2Response isn't exported.
	struct FSendParams
	{
		FString Descriptor;
	};
	FSendParams Params;
	Params.Descriptor = Payload;
	InputComp->ProcessEvent(SendFn, &Params);
}
