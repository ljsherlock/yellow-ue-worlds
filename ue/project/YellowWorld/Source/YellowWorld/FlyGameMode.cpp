#include "FlyGameMode.h"

#include "FlyPawn.h"

AFlyGameMode::AFlyGameMode()
{
	DefaultPawnClass = AFlyPawn::StaticClass();
}
