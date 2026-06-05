#include "FlyGameMode.h"

#include "FlyPawn.h"
#include "StreamBridge.h"
#include "Engine/World.h"

AFlyGameMode::AFlyGameMode()
{
	DefaultPawnClass = AFlyPawn::StaticClass();
}

void AFlyGameMode::BeginPlay()
{
	Super::BeginPlay();

	// Spawn the Pixel Streaming push bridge once per game so the web overlay can
	// read live creature drives. Spawned here (not authored into the map) so it
	// exists on every streamed map without an extra editor author pass.
	if (UWorld* World = GetWorld())
	{
		World->SpawnActor<AStreamBridge>(AStreamBridge::StaticClass());
	}
}
