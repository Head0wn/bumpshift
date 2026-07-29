export type GraphicsQuality = "performance" | "balanced" | "quality";

export interface GameSettings {
  graphicsQuality: GraphicsQuality;
  cameraMotion: number;
  vibration: boolean;
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = Object.freeze({
  graphicsQuality: "balanced",
  cameraMotion: 0.7,
  vibration: true
});

const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  value === "performance" || value === "balanced" || value === "quality";

export function sanitizeGameSettings(value: unknown): GameSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_GAME_SETTINGS };
  }

  const candidate = value as Partial<Record<keyof GameSettings, unknown>>;
  const cameraMotion =
    typeof candidate.cameraMotion === "number" &&
    Number.isFinite(candidate.cameraMotion)
      ? Math.min(1, Math.max(0, candidate.cameraMotion))
      : DEFAULT_GAME_SETTINGS.cameraMotion;

  return {
    graphicsQuality: isGraphicsQuality(candidate.graphicsQuality)
      ? candidate.graphicsQuality
      : DEFAULT_GAME_SETTINGS.graphicsQuality,
    cameraMotion,
    vibration:
      typeof candidate.vibration === "boolean"
        ? candidate.vibration
        : DEFAULT_GAME_SETTINGS.vibration
  };
}
