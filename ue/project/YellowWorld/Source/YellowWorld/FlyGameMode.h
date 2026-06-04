#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "FlyGameMode.generated.h"

/**
 * Minimal GameMode whose only job is to make AFlyPawn the default pawn, so every
 * streamed map (the spike and the imported Savannah) spawns the fast fly camera.
 * Wired in as GlobalDefaultGameMode in DefaultEngine.ini.
 */
UCLASS()
class YELLOWWORLD_API AFlyGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AFlyGameMode();
};
