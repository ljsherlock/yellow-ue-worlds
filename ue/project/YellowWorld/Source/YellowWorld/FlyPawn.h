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

	/** Normal cruise speed in cm/s (4000 = 40 m/s). Tuned down from 150 m/s, which
	 *  was too fast for close inspection; Shift turbo still crosses the map fast. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float CruiseSpeed = 4000.f;

	/** Multiplier applied to CruiseSpeed while the turbo key (Shift) is held. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float TurboMultiplier = 10.f;

	/** Mouse look sensitivity (yaw/pitch input scale on the owning PlayerController).
	 *  Halved from the engine default 2.5/-2.5 — the stock speed felt twice too fast. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float LookYawScale = 1.25f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Yellow|Fly")
	float LookPitchScale = -1.25f;

private:
	void ApplySpeed(float Speed);
	void TurboOn();
	void TurboOff();
};
