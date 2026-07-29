import type { KartInput } from "@bumpshift/shared";

type TouchAction = "left" | "right" | "throttle" | "brake" | "drift";
type GamepadMenuAction = "next" | "previous" | "confirm" | "back";

export interface InputEvents {
  onGamepadStatus(connected: boolean, label: string): void;
}

const ACTIONS: readonly TouchAction[] = [
  "left",
  "right",
  "throttle",
  "brake",
  "drift"
];

const buttonValue = (gamepad: Gamepad, index: number): number =>
  gamepad.buttons[index]?.value ?? 0;

const buttonPressed = (gamepad: Gamepad, index: number): boolean =>
  gamepad.buttons[index]?.pressed ?? false;

const applyDeadzone = (value: number, deadzone = 0.14): number => {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) {
    return 0;
  }
  return (
    Math.sign(value) *
    Math.min(1, (magnitude - deadzone) / (1 - deadzone))
  );
};

const dispatchMenuAction = (action: GamepadMenuAction): void => {
  window.dispatchEvent(
    new CustomEvent<GamepadMenuAction>("bumpshift:gamepad-action", {
      detail: action
    })
  );
};

export class InputController {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<TouchAction>();
  private readonly disposers: Array<() => void> = [];
  private readonly events: InputEvents;
  private previousButtons: boolean[] = [];
  private previousMenuAxis = 0;
  private gamepadIndex = -1;
  private vibrationEnabled = true;

  constructor(touchRoot: HTMLElement, events: InputEvents) {
    this.events = events;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Space"
        ].includes(event.code)
      ) {
        event.preventDefault();
      }
      this.keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      this.keys.delete(event.code);
    };
    const onBlur = (): void => {
      this.keys.clear();
      this.touch.clear();
    };
    const onGamepadConnected = (event: GamepadEvent): void => {
      this.gamepadIndex = event.gamepad.index;
      this.previousButtons = [];
      this.events.onGamepadStatus(true, event.gamepad.id);
    };
    const onGamepadDisconnected = (event: GamepadEvent): void => {
      if (this.gamepadIndex === event.gamepad.index) {
        this.gamepadIndex = -1;
        this.previousButtons = [];
        this.events.onGamepadStatus(false, "");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("gamepadconnected", onGamepadConnected);
    window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
    this.disposers.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
      () => window.removeEventListener("gamepadconnected", onGamepadConnected),
      () =>
        window.removeEventListener(
          "gamepaddisconnected",
          onGamepadDisconnected
        )
    );

    for (const action of ACTIONS) {
      const button = touchRoot.querySelector<HTMLButtonElement>(
        `[data-input="${action}"]`
      );
      if (!button) {
        continue;
      }

      const activate = (event: PointerEvent): void => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add("is-active");
        this.touch.add(action);
      };
      const deactivate = (event: PointerEvent): void => {
        event.preventDefault();
        button.classList.remove("is-active");
        this.touch.delete(action);
      };

      button.addEventListener("pointerdown", activate);
      button.addEventListener("pointerup", deactivate);
      button.addEventListener("pointercancel", deactivate);
      button.addEventListener("lostpointercapture", deactivate);
      this.disposers.push(
        () => button.removeEventListener("pointerdown", activate),
        () => button.removeEventListener("pointerup", deactivate),
        () => button.removeEventListener("pointercancel", deactivate),
        () => button.removeEventListener("lostpointercapture", deactivate)
      );
    }
  }

  setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  updateMenuNavigation(active: boolean): void {
    const gamepad = this.getGamepad();
    if (!gamepad) {
      return;
    }

    const vertical =
      buttonPressed(gamepad, 12) || (gamepad.axes[1] ?? 0) < -0.62
        ? -1
        : buttonPressed(gamepad, 13) || (gamepad.axes[1] ?? 0) > 0.62
          ? 1
          : 0;
    const horizontal =
      buttonPressed(gamepad, 14) || (gamepad.axes[0] ?? 0) < -0.62
        ? -1
        : buttonPressed(gamepad, 15) || (gamepad.axes[0] ?? 0) > 0.62
          ? 1
          : 0;
    const menuAxis = vertical !== 0 ? vertical : horizontal;

    if (active && menuAxis !== 0 && this.previousMenuAxis === 0) {
      dispatchMenuAction(menuAxis > 0 ? "next" : "previous");
    }
    if (
      active &&
      (this.justPressed(gamepad, 0) || this.justPressed(gamepad, 9))
    ) {
      dispatchMenuAction("confirm");
    }
    if (active && this.justPressed(gamepad, 1)) {
      dispatchMenuAction("back");
    }

    this.previousMenuAxis = menuAxis;
    this.previousButtons = gamepad.buttons.map((button) => button.pressed);
  }

  sample(sequence: number): KartInput {
    const gamepad = this.getGamepad();
    const gamepadSteer = gamepad
      ? applyDeadzone(gamepad.axes[0] ?? 0)
      : 0;
    const gamepadLeft = gamepad
      ? buttonPressed(gamepad, 14) || gamepadSteer < -0.01
      : false;
    const gamepadRight = gamepad
      ? buttonPressed(gamepad, 15) || gamepadSteer > 0.01
      : false;
    const left =
      this.keys.has("ArrowLeft") ||
      this.keys.has("KeyA") ||
      this.keys.has("KeyQ") ||
      this.touch.has("left") ||
      gamepadLeft;
    const right =
      this.keys.has("ArrowRight") ||
      this.keys.has("KeyD") ||
      this.touch.has("right") ||
      gamepadRight;
    const digitalSteer = Number(right) - Number(left);

    return {
      sequence,
      throttle: Math.max(
        this.keys.has("ArrowUp") ||
          this.keys.has("KeyW") ||
          this.keys.has("KeyZ") ||
          this.touch.has("throttle")
          ? 1
          : 0,
        gamepad ? buttonValue(gamepad, 7) : 0
      ),
      brake: Math.max(
        this.keys.has("ArrowDown") ||
          this.keys.has("KeyS") ||
          this.touch.has("brake")
          ? 1
          : 0,
        gamepad ? buttonValue(gamepad, 6) : 0
      ),
      steer:
        Math.abs(gamepadSteer) > Math.abs(digitalSteer)
          ? gamepadSteer
          : digitalSteer,
      drift:
        this.keys.has("Space") ||
        this.keys.has("ShiftLeft") ||
        this.keys.has("ShiftRight") ||
        this.touch.has("drift") ||
        (gamepad
          ? buttonPressed(gamepad, 0) ||
            buttonPressed(gamepad, 4) ||
            buttonPressed(gamepad, 5)
          : false)
    };
  }

  rumble(
    durationMilliseconds: number,
    weakMagnitude: number,
    strongMagnitude: number
  ): void {
    if (!this.vibrationEnabled) {
      return;
    }

    const gamepad = this.getGamepad();
    const actuator = gamepad?.vibrationActuator;
    if (!actuator) {
      return;
    }

    void actuator
      .playEffect("dual-rumble", {
        startDelay: 0,
        duration: durationMilliseconds,
        weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
        strongMagnitude: Math.min(1, Math.max(0, strongMagnitude))
      })
      .catch(() => undefined);
  }

  private getGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads?.() ?? [];
    const indexed =
      this.gamepadIndex >= 0 ? gamepads[this.gamepadIndex] : undefined;
    if (indexed?.connected) {
      return indexed;
    }

    const discovered =
      [...gamepads].find((candidate) => candidate?.connected) ?? null;
    if (discovered && discovered.index !== this.gamepadIndex) {
      this.gamepadIndex = discovered.index;
      this.previousButtons = [];
      this.events.onGamepadStatus(true, discovered.id);
    }
    return discovered;
  }

  private justPressed(gamepad: Gamepad, index: number): boolean {
    return (
      buttonPressed(gamepad, index) &&
      !(this.previousButtons[index] ?? false)
    );
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
  }
}
