#include "FlyPawn.h"

#include "GameFramework/FloatingPawnMovement.h"
#include "GameFramework/PlayerController.h"
#include "Components/InputComponent.h"

AFlyPawn::AFlyPawn()
{
	// ADefaultPawn's constructor created the UFloatingPawnMovement; retune it for
	// a large world. High accel/decel keeps it responsive at these speeds.
	ApplySpeed(CruiseSpeed);

	// Needed for the follow-camera chase logic.
	PrimaryActorTick.bCanEverTick = true;
}

void AFlyPawn::SetFollowTarget(AActor* Target)
{
	FollowTarget = Target;
	bHaveFollowPrev = false;
}

void AFlyPawn::ClearFollowTarget()
{
	FollowTarget = nullptr;
	bHaveFollowPrev = false;
}

void AFlyPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	AActor* T = FollowTarget.Get();
	if (!T)
	{
		return;
	}

	// Derive the target's travel direction from its motion (the creature is a
	// kinematic mover, so GetVelocity can be 0); fall back to the last heading.
	const FVector Tl = T->GetActorLocation();
	if (bHaveFollowPrev)
	{
		FVector Delta = Tl - FollowPrevTargetLoc;
		Delta.Z = 0.f;
		if (Delta.SizeSquared() > 1.f)
		{
			FollowDir = Delta.GetSafeNormal();
		}
	}
	FollowPrevTargetLoc = Tl;
	bHaveFollowPrev = true;

	const FVector DesiredPos = Tl - FollowDir * FollowDistance + FVector(0.f, 0.f, FollowHeight);
	const FVector NewPos = FMath::VInterpTo(GetActorLocation(), DesiredPos, DeltaSeconds, FollowLag);
	SetActorLocation(NewPos);

	// DefaultPawn frames from the controller's control rotation; point it at the
	// target (slightly above the root so we look at the body, not the feet).
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		const FRotator DesiredRot = (Tl + FVector(0.f, 0.f, 250.f) - NewPos).Rotation();
		PC->SetControlRotation(FMath::RInterpTo(PC->GetControlRotation(), DesiredRot, DeltaSeconds, FollowLag * 1.5f));
	}
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
