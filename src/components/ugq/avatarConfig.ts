// src/components/ugq/avatarConfig.ts
// Anonymous-video feature — the user's persistent, self-chosen anonymous
// avatar look. Deliberately a small, closed set of options (not a full
// character creator) and deliberately disconnected from the user's real
// appearance — nothing here is ever derived from camera input, only from
// the user's own picks (or, before they've made any, a random default).
// Stored as profiles.anonymous_avatar_config (jsonb) and reused across
// every video that user records while anonymous — see VideoRecorderPanel.tsx
// and avatarRenderer.ts, which is what actually draws this.

export type HairStyle = "short" | "long" | "curly" | "bald";

export type AnonymousAvatarConfig = {
  skinTone: string;
  hairColor: string;
  hairStyle: HairStyle;
  topColor: string;
};

export const SKIN_TONES = ["#f2c9a0", "#e0a877", "#c98a5c", "#8d5a34", "#6b4226"];
export const HAIR_COLORS = ["#2c2115", "#4a3626", "#7a5a3a", "#b8860b", "#1c1c1c", "#8b3a2f"];
export const HAIR_STYLES: HairStyle[] = ["short", "long", "curly", "bald"];
export const TOP_COLORS = ["#3f8f86", "#5b6ee1", "#d85a30", "#4a7c59", "#8a4fbf", "#c9506b"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Called the first time a user records a video while anonymous and has no
// config saved yet — see VideoRecorderPanel.tsx. Never blocks recording on
// customization; the user can change this later in Settings > Privacy.
export function randomAvatarConfig(): AnonymousAvatarConfig {
  return {
    skinTone: pick(SKIN_TONES),
    hairColor: pick(HAIR_COLORS),
    hairStyle: pick(HAIR_STYLES),
    topColor: pick(TOP_COLORS),
  };
}

export function isValidAvatarConfig(raw: unknown): raw is AnonymousAvatarConfig {
  if (!raw || typeof raw !== "object") return false;
  const c = raw as Record<string, unknown>;
  return (
    typeof c.skinTone === "string" &&
    typeof c.hairColor === "string" &&
    typeof c.topColor === "string" &&
    typeof c.hairStyle === "string" &&
    (HAIR_STYLES as string[]).includes(c.hairStyle)
  );
}

export function parseAvatarConfig(raw: unknown): AnonymousAvatarConfig | null {
  return isValidAvatarConfig(raw) ? raw : null;
}
