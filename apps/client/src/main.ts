import "./styles.css";
import {
  DEFAULT_TRACK_ID,
  TRACKS,
  sanitizeKartColor,
  sanitizeTrackId,
  type TrackDefinition,
  type TrackId
} from "@bumpshift/shared";
import { BumpshiftGame, type HudElements } from "./game/BumpshiftGame";
import { KART_PALETTES } from "./game/KartVisual";
import {
  DEFAULT_GAME_SETTINGS,
  sanitizeGameSettings,
  type GameSettings,
  type GraphicsQuality
} from "./game/settings";

type MenuPanel = "home" | "play" | "garage" | "settings";
type GamepadMenuAction = "next" | "previous" | "confirm" | "back";

const requireElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Élément d'interface introuvable : ${selector}`);
  }
  return element;
};

const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Le stockage local reste optionnel.
  }
};

const createTrackPath = (track: TrackDefinition): string => {
  const points = track.centerline;
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumZ = Math.min(...points.map((point) => point.z));
  const maximumZ = Math.max(...points.map((point) => point.z));
  const width = Math.max(1, maximumX - minimumX);
  const height = Math.max(1, maximumZ - minimumZ);
  const scale = Math.min(154 / width, 94 / height);
  const offsetX = (180 - width * scale) * 0.5;
  const offsetY = (120 - height * scale) * 0.5;

  const projected = points.map((point) => ({
    x: offsetX + (point.x - minimumX) * scale,
    y: offsetY + (maximumZ - point.z) * scale
  }));
  const first = projected[0];
  if (!first) {
    return "";
  }

  return [
    `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`,
    ...projected
      .slice(1)
      .map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`),
    "Z"
  ].join(" ");
};

const bootstrap = async (): Promise<void> => {
  const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
  const touchRoot = requireElement<HTMLElement>("#touch-controls");
  const menu = requireElement<HTMLElement>("#menu");
  const form = requireElement<HTMLFormElement>("#join-form");
  const nameInput = requireElement<HTMLInputElement>("#player-name");
  const joinButton = requireElement<HTMLButtonElement>("#join-button");
  const menuError = requireElement<HTMLElement>("#menu-error");
  const kartColorName = requireElement<HTMLElement>("#kart-color-name");
  const kartColors = requireElement<HTMLElement>("#kart-colors");
  const garageKart = requireElement<HTMLElement>("#garage-kart");
  const cameraMotion =
    requireElement<HTMLInputElement>("#camera-motion");
  const cameraMotionValue =
    requireElement<HTMLOutputElement>("#camera-motion-value");
  const vibration =
    requireElement<HTMLInputElement>("#gamepad-vibration");
  const fullscreenButton =
    requireElement<HTMLButtonElement>("#fullscreen-button");

  const rememberedName = readStorage("bumpshift:player-name");
  if (rememberedName) {
    nameInput.value = rememberedName;
  }

  let selectedTrack = sanitizeTrackId(
    readStorage("bumpshift:track") ?? DEFAULT_TRACK_ID
  );
  let selectedColor = sanitizeKartColor(
    Number(readStorage("bumpshift:kart-color") ?? 0)
  );
  let settings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
  const storedSettings = readStorage("bumpshift:settings");
  if (storedSettings) {
    try {
      settings = sanitizeGameSettings(JSON.parse(storedSettings));
    } catch {
      settings = { ...DEFAULT_GAME_SETTINGS };
    }
  }

  const hud: HudElements = {
    hud: requireElement<HTMLElement>("#hud"),
    connectionLabel: requireElement<HTMLElement>("#connection-label"),
    playerCount: requireElement<HTMLElement>("#player-count"),
    latency: requireElement<HTMLElement>("#latency"),
    position: requireElement<HTMLElement>("#position"),
    fieldSize: requireElement<HTMLElement>("#field-size"),
    lap: requireElement<HTMLElement>("#lap"),
    speed: requireElement<HTMLElement>("#speed"),
    driftFill: requireElement<HTMLElement>("#drift-fill"),
    driftLevel: requireElement<HTMLElement>("#drift-level"),
    raceOverlay: requireElement<HTMLElement>("#race-overlay"),
    phaseEyebrow: requireElement<HTMLElement>("#phase-eyebrow"),
    phaseTitle: requireElement<HTMLElement>("#phase-title"),
    phaseDetail: requireElement<HTMLElement>("#phase-detail"),
    phaseLights: requireElement<HTMLElement>("#phase-lights"),
    phaseStandings: requireElement<HTMLElement>("#phase-standings"),
    readyButton: requireElement<HTMLButtonElement>("#ready-button"),
    controllerStatus: requireElement<HTMLElement>("#controller-status")
  };

  const game = await BumpshiftGame.create(canvas, touchRoot, hud);
  game.applySettings(settings);

  const panels = [
    ...menu.querySelectorAll<HTMLElement>("[data-panel]")
  ];
  const navItems = [
    ...menu.querySelectorAll<HTMLButtonElement>(".menu-nav__item")
  ];
  let activePanel: MenuPanel = "home";

  const visibleFocusableElements = (root: HTMLElement): HTMLElement[] =>
    [
      ...root.querySelectorAll<HTMLElement>(
        "button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden])"
      )
    ].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        element.getAttribute("aria-hidden") !== "true"
    );

  const openPanel = (
    target: MenuPanel,
    focusFromGamepad = false
  ): void => {
    activePanel = target;
    for (const panel of panels) {
      const isTarget = panel.dataset.panel === target;
      panel.hidden = !isTarget;
      panel.classList.toggle("is-active", isTarget);
    }
    for (const item of navItems) {
      item.classList.toggle(
        "is-active",
        item.dataset.openPanel === target
      );
    }

    if (target === "play") {
      game.previewTrack(selectedTrack);
    }
    if (focusFromGamepad) {
      const panel = panels.find(
        (candidate) => candidate.dataset.panel === target
      );
      visibleFocusableElements(panel ?? menu)[0]?.focus();
    }
  };

  const selectTrack = (trackId: TrackId): void => {
    selectedTrack = trackId;
    writeStorage("bumpshift:track", trackId);
    for (const card of menu.querySelectorAll<HTMLButtonElement>(
      "[data-track-id]"
    )) {
      const selected = card.dataset.trackId === trackId;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-checked", String(selected));
    }
    game.previewTrack(trackId);
  };

  for (const track of TRACKS) {
    const card = menu.querySelector<HTMLButtonElement>(
      `[data-track-id="${track.id}"]`
    );
    const path = card?.querySelector<SVGPathElement>("path");
    path?.setAttribute("d", createTrackPath(track));
  }

  menu.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button"
    );
    if (!button) {
      return;
    }

    const trackId = button.dataset.trackId;
    if (trackId) {
      selectTrack(sanitizeTrackId(trackId));
    }

    const preferredTrack = button.dataset.selectTrack;
    if (preferredTrack) {
      selectTrack(sanitizeTrackId(preferredTrack));
    }

    const panel = button.dataset.openPanel as MenuPanel | undefined;
    if (panel) {
      openPanel(panel);
    } else if (button.hasAttribute("data-menu-back")) {
      openPanel("home");
    }
  });

  const selectKartColor = (colorIndex: number): void => {
    selectedColor = sanitizeKartColor(colorIndex);
    const palette = KART_PALETTES[selectedColor] ?? KART_PALETTES[0];
    kartColorName.textContent = palette.name;
    garageKart.style.setProperty("--kart-color", palette.color);
    writeStorage("bumpshift:kart-color", String(selectedColor));
    for (const swatch of kartColors.querySelectorAll<HTMLButtonElement>(
      ".kart-color"
    )) {
      const selected = Number(swatch.dataset.colorIndex) === selectedColor;
      swatch.classList.toggle("is-selected", selected);
      swatch.setAttribute("aria-checked", String(selected));
    }
  };

  for (const [index, palette] of KART_PALETTES.entries()) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "kart-color";
    swatch.dataset.colorIndex = String(index);
    swatch.setAttribute("role", "radio");
    swatch.setAttribute("aria-label", palette.name);
    swatch.style.setProperty("--swatch", palette.color);
    swatch.addEventListener("click", () => {
      selectKartColor(index);
    });
    kartColors.append(swatch);
  }

  const persistSettings = (): void => {
    settings = sanitizeGameSettings(settings);
    writeStorage("bumpshift:settings", JSON.stringify(settings));
    game.applySettings(settings);
  };

  const selectQuality = (quality: GraphicsQuality): void => {
    settings.graphicsQuality = quality;
    for (const button of menu.querySelectorAll<HTMLButtonElement>(
      "[data-quality]"
    )) {
      button.classList.toggle(
        "is-selected",
        button.dataset.quality === quality
      );
    }
    persistSettings();
  };

  for (const qualityButton of menu.querySelectorAll<HTMLButtonElement>(
    "[data-quality]"
  )) {
    qualityButton.addEventListener("click", () => {
      selectQuality(qualityButton.dataset.quality as GraphicsQuality);
    });
  }

  cameraMotion.addEventListener("input", () => {
    settings.cameraMotion = Number(cameraMotion.value) / 100;
    cameraMotionValue.value = `${cameraMotion.value}%`;
    persistSettings();
  });
  vibration.addEventListener("change", () => {
    settings.vibration = vibration.checked;
    persistSettings();
  });
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      menuError.textContent =
        "Le plein écran a été refusé par le navigateur.";
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const label = fullscreenButton.querySelector("span");
    if (label) {
      label.lastChild?.remove();
      label.append(
        document.fullscreenElement
          ? "QUITTER LE PLEIN ÉCRAN"
          : "PASSER EN PLEIN ÉCRAN"
      );
    }
  });

  const onGamepadMenuAction = (event: Event): void => {
    const action = (event as CustomEvent<GamepadMenuAction>).detail;
    const raceOverlay = hud.raceOverlay.hidden ? null : hud.raceOverlay;
    const activeRoot =
      raceOverlay ??
      panels.find((panel) => panel.dataset.panel === activePanel) ??
      menu;
    const focusables = visibleFocusableElements(activeRoot);
    const activeElement = document.activeElement as HTMLElement | null;
    const activeIndex = activeElement
      ? focusables.indexOf(activeElement)
      : -1;

    if (action === "back") {
      if (!raceOverlay && activePanel !== "home") {
        openPanel("home", true);
      }
      return;
    }

    if (action === "confirm") {
      if (activeIndex >= 0) {
        (focusables[activeIndex] as HTMLButtonElement | HTMLInputElement)
          .click();
      } else {
        focusables[0]?.focus();
      }
      return;
    }

    if (focusables.length === 0) {
      return;
    }
    const direction = action === "next" ? 1 : -1;
    const nextIndex =
      (activeIndex + direction + focusables.length) % focusables.length;
    focusables[nextIndex]?.focus();
  };
  window.addEventListener("bumpshift:gamepad-action", onGamepadMenuAction);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && activePanel !== "home" && !menu.hidden) {
      openPanel("home");
    }
  });

  selectTrack(selectedTrack);
  selectKartColor(selectedColor);
  selectQuality(settings.graphicsQuality);
  cameraMotion.value = String(Math.round(settings.cameraMotion * 100));
  cameraMotionValue.value = `${cameraMotion.value}%`;
  vibration.checked = settings.vibration;
  openPanel("home");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    menuError.textContent = "";
    joinButton.disabled = true;
    const label = joinButton.querySelector("span");
    const originalMarkup = label?.innerHTML ?? "";
    if (label) {
      label.textContent = "CONNEXION À LA GRILLE…";
    }

    try {
      const playerName = nameInput.value.trim() || "Pilote";
      await game.connect(playerName, selectedTrack, selectedColor);
      writeStorage("bumpshift:player-name", playerName);
      document.body.classList.add("is-racing");
      menu.classList.add("is-hidden");
      window.setTimeout(() => {
        menu.hidden = true;
      }, 450);
      canvas.focus();
    } catch (error) {
      console.error(error);
      menuError.textContent =
        "Impossible de joindre le serveur. Vérifie qu’il est bien démarré.";
      joinButton.disabled = false;
      if (label) {
        label.innerHTML = originalMarkup;
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    window.removeEventListener(
      "bumpshift:gamepad-action",
      onGamepadMenuAction
    );
    void game.dispose();
  });
};

void bootstrap().catch((error: unknown) => {
  console.error("BUMPSHIFT n'a pas pu démarrer.", error);
  const errorElement = document.querySelector<HTMLElement>("#menu-error");
  if (errorElement) {
    errorElement.textContent =
      "Le moteur 3D n’a pas pu démarrer sur ce navigateur.";
  }
});
