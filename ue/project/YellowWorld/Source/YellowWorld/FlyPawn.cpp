#include "FlyPawn.h"

#include "GameFramework/FloatingPawnMovement.h"
#include "GameFramework/PlayerController.h"
#include "Components/InputComponent.h"

AFlyPawn::AFlyPawn()
{
	// ADefaultPawn's constructor created the UFloatingPawnMovement; retune it for
	// a large world. High accel/decel keeps it responsive at these speeds.
	ApplySpeed(CruiseSpeed);
}

void AFlyPawn::ApplySpeed(float Speed)
{
	if (UFloatingPawnMovement* Move = Cast<UFloatingPawnMovement>(GetMovementComponent()))
	{
		Move->MaxSpeed = Speed;
		Move->Acceleration = Speed * 8.f;
		Move->Deceleration = Speed * 8.f;
	}
}

void AFlyPawn::ApplyLookScale()
{
	// DefaultPawn's "Turn"/"LookUp" bindings feed raw mouse delta into
	// AddControllerYaw/PitchInput, which the PlayerController multiplies by its
	// (deprecated) Input Yaw/Pitch scale. On UE 5.7 that scale defaults to 0, so
	// without setting it mouse-look is dead. We push our halved values here.
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->SetDeprecatedInputYawScale(LookYawScale);
		PC->SetDeprecatedInputPitchScale(LookPitchScale);
	}
}

void AFlyPawn::NotifyControllerChanged()
{
	Super::NotifyControllerChanged();
	// Fires whenever the Controller pointer changes (i.e. on possession), which is
	// the reliable moment to apply input scaling — SetupPlayerInputComponent can
	// run earlier, before GetController() is valid, and silently no-op.
	ApplyLookScale();
}

void AFlyPawn::PawnClientRestart()
{
	Super::PawnClientRestart();
	// Belt-and-suspenders: also runs on the owning client after the input stack is
	// (re)built, covering Pixel-Streaming late-join/possession ordering.
	ApplyLookScale();
}

void AFlyPawn::SetupPlayerInputComponent(UInputComponent* InInputComponent)
{
	Super::SetupPlayerInputComponent(InInputComponent);

	// Best-effort here too; the authoritative application is in the possession
	// hooks above (NotifyControllerChanged / PawnClientRestart).
	ApplyLookScale();

	if (InInputComponent)
	{
		// BindKey works without project-defined input mappings (packaged build safe).
		InInputComponent->BindKey(EKeys::LeftShift, IE_Pressed, this, &AFlyPawn::TurboOn);
		InInputComponent->BindKey(EKeys::LeftShift, IE_Released, this, &AFlyPawn::TurboOff);
		InInputComponent->BindKey(EKeys::RightShift, IE_Pressed, this, &AFlyPawn::TurboOn);
		InInputComponent->BindKey(EKeys::RightShift, IE_Released, this, &AFlyPawn::TurboOff);
	}
}

void AFlyPawn::TurboOn()
{
	ApplySpeed(CruiseSpeed * TurboMultiplier);
}

void AFlyPawn::TurboOff()
{
	ApplySpeed(CruiseSpeed);
}
