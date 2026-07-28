import "./styles.css";
import { BumpshiftGame, type HudElements } from "./game/BumpshiftGame";

const requireElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Élément d'interface introuvable : ${selector}`);
  }
  return element;
};

const bootstrap = async (): Promise<void> => {
  const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
  const touchRoot = requireElement<HTMLElement>("#touch-controls");
  const menu = requireElement<HTMLElement>("#menu");
  const form = requireElement<HTMLFormElement>("#join-form");
  const nameInput = requireElement<HTMLInputElement>("#player-name");
  const joinButton = requireElement<HTMLButtonElement>("#join-button");
  const menuError = requireElement<HTMLElement>("#menu-error");

  try {
    const rememberedName = window.localStorage.getItem("bumpshift:player-name");
    if (rememberedName) {
      nameInput.value = rememberedName;
    }
  } catch {
    // Le stockage local est optionnel.
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
    readyButton: requireElement<HTMLButtonElement>("#ready-button")
  };

  const game = await BumpshiftGame.create(canvas, touchRoot, hud);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    menuError.textContent = "";
    joinButton.disabled = true;
    const label = joinButton.querySelector("span");
    if (label) {
      label.textContent = "Connexion…";
    }

    try {
      const playerName = nameInput.value.trim() || "Pilote";
      await game.connect(playerName);
      try {
        window.localStorage.setItem("bumpshift:player-name", playerName);
      } catch {
        // Le stockage local est optionnel.
      }
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
        label.textContent = "Rejoindre la course";
      }
    }
  });

  window.addEventListener("beforeunload", () => {
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
