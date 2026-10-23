/**
 * clientPrefs.ts — "Minhas preferências" (spec 37 §5.3), 100% client-side.
 *
 * REQ-CFG-020..023, REQ-CFG-072, RNF-CFG-01: the three audio channels (`music`,
 * `environment`, `interface` — REQ-AUD-015/016) and the client's notification toggles
 * (chat sound, turn alert) live in `localStorage`, scoped by world + user — the same
 * shape `lib/sidebar/preferences.ts` and `lib/chat/rollModePreference.ts` already use —
 * and NEVER leave the device: this module has no socket dependency, emits no op and
 * writes no Document (REQ-CFG-022, RNF-CFG-01). There is deliberately no idiom control
 * (REQ-CFG-023). The theme is per browser, not per world/seat, so it lives in
 * `lib/ui/theme.ts` (DEC-CFG-11), not here.
 *
 * Consumer contract: a future client audio mixer reads `volume` from here instead of
 * inventing its own storage (REQ-AUD-016 names the intent, not this exact key — no
 * audio store exists yet in this repo, see brief §4.8/§2.7). `PreferencesSection.svelte`
 * is the only writer.
 */

import {
  CANTOS,
  TAMANHO_MAXIMO,
  TAMANHO_MINIMO,
  TAMANHO_PADRAO,
  type CantoDoAvatar,
  type PosicaoLivre,
} from "../avatar/posicao.js";

/** The three audio channels REQ-AUD-015 defines. */
export type VolumeChannel = "music" | "environment" | "interface";

const VOLUME_CHANNELS: readonly VolumeChannel[] = ["music", "environment", "interface"];

/** Client notification toggles (REQ-CFG-021: at minimum chat sound + turn alert). */
export interface NotificationPreferences {
  readonly chatSound: boolean;
  readonly turnAlert: boolean;
}

/**
 * Token display toggles (spec 41-token.md REQ-TOK-074, TK080, DEC-TOK-11).
 *
 * Pure client-local ergonomy — the SAME contract as everything else in this
 * module: never sent to the server, never changes what a payload contains.
 * REQ-TOK-075/076 (CA-TOK-011) is the hard requirement this exists to keep
 * true: the preference may only ever SUBTRACT from what the user's own
 * socket already received (server redaction, `net/redaction.ts`) — turning
 * it on must never reveal a name or a bar the server did not already emit.
 * `TokenSprite`/`TokenLayer` are the only readers; this module writes
 * nothing to the canvas itself.
 */
export interface TokenDisplayPreferences {
  readonly showNames: boolean;
  readonly showBars: boolean;
}

/**
 * The avatar overlay on THIS viewer's screen (spec 35): whether it shows, how
 * big, and where — a corner, or a spot dragged by hand (`livre`, the box's
 * top-left as a fraction of the viewport, so it survives a resize). Same
 * client-only contract: it changes what this screen draws, nothing else.
 */
export interface AvatarOverlayPreferences {
  readonly visivel: boolean;
  /** Side of the box in px, {@link TAMANHO_MINIMO}..{@link TAMANHO_MAXIMO}. */
  readonly tamanho: number;
  readonly canto: CantoDoAvatar;
  readonly livre: PosicaoLivre | null;
}

/** The whole shape of "Minhas preferências". */
export interface ClientPreferences {
  readonly volume: Readonly<Record<VolumeChannel, number>>;
  readonly notifications: NotificationPreferences;
  readonly tokenDisplay: TokenDisplayPreferences;
  readonly avatarOverlay: AvatarOverlayPreferences;
}

/** Volume is a `[0, 1]` multiplier (REQ-AUD-017); sliders in the UI show 0–100%. */
export const DEFAULT_VOLUME = 1;

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  chatSound: true,
  turnAlert: true,
};

/** Both on by default — the preference only ever hides what would otherwise show. */
export const DEFAULT_TOKEN_DISPLAY: TokenDisplayPreferences = {
  showNames: true,
  showBars: true,
};

export const DEFAULT_AVATAR_OVERLAY: AvatarOverlayPreferences = {
  visivel: true,
  tamanho: TAMANHO_PADRAO,
  canto: "inferior-direito",
  livre: null,
};

export const DEFAULT_CLIENT_PREFERENCES: ClientPreferences = {
  volume: { music: DEFAULT_VOLUME, environment: DEFAULT_VOLUME, interface: DEFAULT_VOLUME },
  notifications: DEFAULT_NOTIFICATIONS,
  tokenDisplay: DEFAULT_TOKEN_DISPLAY,
  avatarOverlay: DEFAULT_AVATAR_OVERLAY,
};

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const CLIENT_PREFS_KEY_PREFIX = "fusion:clientPrefs";

/**
 * Storage key of one user's client preferences in one world.
 *
 * Both ids are part of the key — a device shared by the GM and a player keeps two
 * independent entries, and moving to another world does not carry the values over.
 */
export function clientPrefsKey(worldId: string, userId: string): string {
  return `${CLIENT_PREFS_KEY_PREFIX}:${worldId}:${userId}`;
}

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function parseVolume(record: Record<string, unknown>): Record<VolumeChannel, number> {
  const raw = record["volume"];
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<VolumeChannel, number>;
  for (const channel of VOLUME_CHANNELS) {
    const value = source[channel];
    result[channel] = typeof value === "number" ? clampVolume(value) : DEFAULT_VOLUME;
  }
  return result;
}

function parseNotifications(record: Record<string, unknown>): NotificationPreferences {
  const raw = record["notifications"];
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    chatSound:
      typeof source["chatSound"] === "boolean"
        ? source["chatSound"]
        : DEFAULT_NOTIFICATIONS.chatSound,
    turnAlert:
      typeof source["turnAlert"] === "boolean"
        ? source["turnAlert"]
        : DEFAULT_NOTIFICATIONS.turnAlert,
  };
}

function parseTokenDisplay(record: Record<string, unknown>): TokenDisplayPreferences {
  const raw = record["tokenDisplay"];
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    showNames:
      typeof source["showNames"] === "boolean"
        ? source["showNames"]
        : DEFAULT_TOKEN_DISPLAY.showNames,
    showBars:
      typeof source["showBars"] === "boolean" ? source["showBars"] : DEFAULT_TOKEN_DISPLAY.showBars,
  };
}

function clampFraction(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function parseAvatarOverlay(record: Record<string, unknown>): AvatarOverlayPreferences {
  const raw = record["avatarOverlay"];
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const tamanho =
    typeof source["tamanho"] === "number" && Number.isFinite(source["tamanho"])
      ? Math.round(Math.min(TAMANHO_MAXIMO, Math.max(TAMANHO_MINIMO, source["tamanho"])))
      : DEFAULT_AVATAR_OVERLAY.tamanho;
  const canto = CANTOS.includes(source["canto"] as CantoDoAvatar)
    ? (source["canto"] as CantoDoAvatar)
    : DEFAULT_AVATAR_OVERLAY.canto;
  const livreRaw = source["livre"];
  const livre =
    typeof livreRaw === "object" &&
    livreRaw !== null &&
    typeof (livreRaw as Record<string, unknown>)["x"] === "number" &&
    typeof (livreRaw as Record<string, unknown>)["y"] === "number" &&
    Number.isFinite((livreRaw as Record<string, number>)["x"]) &&
    Number.isFinite((livreRaw as Record<string, number>)["y"])
      ? {
          x: clampFraction((livreRaw as Record<string, number>)["x"] ?? 0),
          y: clampFraction((livreRaw as Record<string, number>)["y"] ?? 0),
        }
      : null;
  return {
    visivel:
      typeof source["visivel"] === "boolean" ? source["visivel"] : DEFAULT_AVATAR_OVERLAY.visivel,
    tamanho,
    canto,
    livre,
  };
}

/**
 * This user's saved preferences in this world, or the defaults when there is nothing
 * usable (never saved, storage unavailable, corrupt JSON, no world/user identity yet).
 *
 * Pure read: never touches a socket, never emits an op (REQ-CFG-022, RNF-CFG-01).
 */
export function loadClientPreferences(worldId: string, userId: string): ClientPreferences {
  if (!hasIdentity(worldId, userId)) return DEFAULT_CLIENT_PREFERENCES;
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CLIENT_PREFERENCES;
    const raw = localStorage.getItem(clientPrefsKey(worldId, userId));
    if (raw === null) return DEFAULT_CLIENT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CLIENT_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    return {
      volume: parseVolume(record),
      notifications: parseNotifications(record),
      tokenDisplay: parseTokenDisplay(record),
      avatarOverlay: parseAvatarOverlay(record),
    };
  } catch {
    /* localStorage unavailable or unparseable — fall back to defaults. */
    return DEFAULT_CLIENT_PREFERENCES;
  }
}

function persist(worldId: string, userId: string, prefs: ClientPreferences): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(clientPrefsKey(worldId, userId), JSON.stringify(prefs));
  } catch {
    /* ignore — private mode, quota, storage disabled. */
  }
}

/**
 * Set one volume channel (REQ-CFG-020) and persist the whole preference object.
 *
 * `value` is clamped to `[0, 1]`; without a world/user identity nothing is written and
 * the unchanged defaults are returned. Client-only: never touches a socket, never emits
 * an op, never writes a Document (REQ-CFG-022, RNF-CFG-01).
 */
export function setVolumeChannel(
  worldId: string,
  userId: string,
  channel: VolumeChannel,
  value: number,
): ClientPreferences {
  const current = loadClientPreferences(worldId, userId);
  const next: ClientPreferences = {
    ...current,
    volume: { ...current.volume, [channel]: clampVolume(value) },
  };
  persist(worldId, userId, next);
  return next;
}

/**
 * Set one notification preference (REQ-CFG-021) and persist the whole preference
 * object. Same client-only contract as `setVolumeChannel` (REQ-CFG-022, RNF-CFG-01).
 */
export function setNotificationPreference(
  worldId: string,
  userId: string,
  key: keyof NotificationPreferences,
  value: boolean,
): ClientPreferences {
  const current = loadClientPreferences(worldId, userId);
  const next: ClientPreferences = {
    ...current,
    notifications: { ...current.notifications, [key]: value },
  };
  persist(worldId, userId, next);
  return next;
}

/**
 * Set one token-display toggle (REQ-TOK-074, TK080) and persist the whole
 * preference object. Same client-only contract as the setters above
 * (REQ-CFG-022, RNF-CFG-01) — and REQ-TOK-076's own contract on top: this
 * function never touches a socket, so the payload every socket already
 * received is exactly as unaffected as `setVolumeChannel`'s.
 */
export function setTokenDisplayPreference(
  worldId: string,
  userId: string,
  key: keyof TokenDisplayPreferences,
  value: boolean,
): ClientPreferences {
  const current = loadClientPreferences(worldId, userId);
  const next: ClientPreferences = {
    ...current,
    tokenDisplay: { ...current.tokenDisplay, [key]: value },
  };
  persist(worldId, userId, next);
  return next;
}

/**
 * Change part of the avatar overlay preference and persist the whole object.
 * The patch goes through the same parser as a load, so junk is repaired on the
 * way in too (size clamped, unknown corner dropped). Client-only, like the rest.
 */
export function setAvatarOverlayPreference(
  worldId: string,
  userId: string,
  patch: Partial<AvatarOverlayPreferences>,
): ClientPreferences {
  const current = loadClientPreferences(worldId, userId);
  const next: ClientPreferences = {
    ...current,
    avatarOverlay: parseAvatarOverlay({ avatarOverlay: { ...current.avatarOverlay, ...patch } }),
  };
  persist(worldId, userId, next);
  return next;
}

/** Drop this user's saved client preferences in this world. */
export function clearClientPreferences(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(clientPrefsKey(worldId, userId));
  } catch {
    /* ignore */
  }
}
