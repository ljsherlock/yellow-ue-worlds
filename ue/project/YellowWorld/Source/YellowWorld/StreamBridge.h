#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "StreamBridge.generated.h"

class ACreatureDirector;

/**
 * Pushes live creature state (incl. drives) to the Pixel Streaming web frontend
 * so a custom overlay can render a drives panel without exposing Remote Control
 * publicly. It owns a PixelStreaming2 input component and, a few times a second,
 * sends QueryCreatures() JSON via SendPixelStreaming2Response; the frontend
 * consumes it through addResponseEventListener.
 *
 * The component is created by class and invoked via reflection on purpose: the
 * UPixelStreaming2Input header lives under the plugin's Internal/ folder, so a
 * direct C++ include from this game module is not a supported (or stable) build
 * dependency. Reflection needs only the plugin to be loaded at runtime (it is).
 */
UCLASS()
class YELLOWWORLD_API AStreamBridge : public AActor
{
	GENERATED_BODY()

public:
	AStreamBridge();

	virtual void BeginPlay() override;

	/** How often to push state to the browser (seconds). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Stream")
	float PushIntervalSec = 0.5f;

private:
	UPROPERTY()
	TObjectPtr<UActorComponent> InputComp;

	/** Cached UPixelStreaming2Input::SendPixelStreaming2Response. */
	UFunction* SendFn = nullptr;

	TWeakObjectPtr<ACreatureDirector> Director;
	FTimerHandle PushTimer;

	void PushState();
};
