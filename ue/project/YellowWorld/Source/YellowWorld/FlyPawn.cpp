#include "FlyPawn.h"

#include "GameFramework/FloatingPawnMovement.h"
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

void AFlyPawn::SetupPlayerInputComponent(UInputComponent* InInputComponent)
{
	Super::SetupPlayerInputComponent(InInputComponent);
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
