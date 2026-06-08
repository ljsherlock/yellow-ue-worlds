#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "StreamBridge.generated.h"

class ACreatureDirector;

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

	virtual void PostInitializeComponents() override;
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Stream")
	float PushIntervalSec = 0.5f;

private:
	UPROPERTY()
	TObjectPtr<UActorComponent> InputComp;

	UFunction* SendFn = nullptr;

	TWeakObjectPtr<ACreatureDirector> Director;
	FTimerHandle PushTimer;

	void BindUiInput();
	void PushState();

	UFUNCTION()
	void HandleUiInteraction(const FString& Descriptor);
};
