#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "StreamBridge.generated.h"

class ACreatureDirector;
class UPixelStreaming2Input;

/**
 * Pushes live creature state to the PS2 frontend and receives overlay commands
 * (camera mode, etc.) via PixelStreaming2 UI interactions.
 */
UCLASS()
class YELLOWWORLD_API AStreamBridge : public AActor
{
	GENERATED_BODY()

public:
	AStreamBridge();

	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Stream")
	float PushIntervalSec = 0.5f;

private:
	// Native default subobject, created in the constructor. The engine's normal
	// actor lifecycle (RegisterAllComponents -> DispatchBeginPlay) guarantees its
	// BeginPlay runs, and that BeginPlay is what self-registers the component in
	// the PixelStreaming2 global InputComponents map that FEpicRtcStreamer
	// broadcasts UI interactions to. Earlier attempts created this via NewObject
	// after construction; that component bound fine but was never routed a
	// BeginPlay, so it never joined the map and inbound camera commands were lost.
	UPROPERTY()
	TObjectPtr<UPixelStreaming2Input> InputComp;

	// UPixelStreaming2Input is not exported (no PIXELSTREAMING2_API), so its
	// methods can't be linked from this module. We can still bind OnInputEvent
	// (inline delegate access) and CreateDefaultSubobject (StaticClass links),
	// but SendPixelStreaming2Response must be called reflectively via ProcessEvent.
	UFunction* SendFn = nullptr;

	TWeakObjectPtr<ACreatureDirector> Director;
	FTimerHandle PushTimer;

	void PushState();

	UFUNCTION()
	void HandleUiInteraction(const FString& Descriptor);

	// DIAGNOSTIC (RC-callable): logs the input component's lifecycle state and
	// manually fires OnInputEvent so we can test the receive-binding without a
	// browser. Lets us isolate "not in the streamer's InputComponents map" from
	// "delegate binding broken".
	UFUNCTION(BlueprintCallable, Category = "Yellow|Stream")
	void DebugFireInput();
};
