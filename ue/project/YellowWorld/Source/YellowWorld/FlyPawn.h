#pragma once

#include "CoreMinimal.h"
#include "GameFramework/DefaultPawn.h"
#include "FlyPawn.generated.h"

/**
 * Spectator-style fly camera for inspecting the big (8 km) imported maps over
 * Pixel Streaming. ADefaultPawn already gives WASD + QE + mouse-look via a
 * UFloatingPawnMovement; the stock MaxSpeed (1200 cm/s = 12 m/s) is uselessly
 * slow on an 8 km terrain. We crank the cruise speed and add a hold-to-boost
 * "turbo" on Shift (default 10x) so you can cross the map in seconds, then slow
 * down for close inspection. Bound directly to keys (no project input mappings
 * required) so it works in the packaged/headless streamed build.
 */
UCLASS()
class YELLOWWORLD_API AFlyPawn : public ADefaultPawn
{
	GENERATED_BODY()

public:
	AFlyPawn();

	virtual void SetupPlayerInputComponent(UInputComponent* InInputComponent) override;

	/** Normal cruise speed in cm/s (15000 = 150 m/s, ~10x the stock DefaultPawn). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float CruiseSpeed = 15000.f;

	/** Multiplier applied to CruiseSpeed while the turbo key (Shift) is held. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float TurboMultiplier = 10.f;

private:
	void ApplySpeed(float Speed);
	void TurboOn();
	void TurboOff();
};
