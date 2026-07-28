import type { KartInput } from "@bumpshift/shared";

type TouchAction = "left" | "right" | "throttle" | "brake" | "drift";

const ACTIONS: readonly TouchAction[] = [
  "left",
  "right",
  "throttle",
  "brake",
  "drift"
];

export class InputController {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<TouchAction>();
  private readonly disposers: Array<() => void> = [];

  constructor(touchRoot: HTMLElement) {
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

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.disposers.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur)
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

  sample(sequence: number): KartInput {
    const left =
      this.keys.has("ArrowLeft") ||
      this.keys.has("KeyA") ||
      this.keys.has("KeyQ") ||
      this.touch.has("left");
    const right =
      this.keys.has("ArrowRight") ||
      this.keys.has("KeyD") ||
      this.touch.has("right");

    return {
      sequence,
      throttle:
        this.keys.has("ArrowUp") ||
        this.keys.has("KeyW") ||
        this.keys.has("KeyZ") ||
        this.touch.has("throttle")
          ? 1
          : 0,
      brake:
        this.keys.has("ArrowDown") ||
        this.keys.has("KeyS") ||
        this.touch.has("brake")
          ? 1
          : 0,
      steer: Number(right) - Number(left),
      drift:
        this.keys.has("Space") ||
        this.keys.has("ShiftLeft") ||
        this.keys.has("ShiftRight") ||
        this.touch.has("drift")
    };
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
  }
}

