import { get } from "svelte/store";
import { addonUrls, disabledSources } from "$lib/stremio/sources";
import {
  debridKey,
  debridProvider,
  disabledExtensions,
  extensionUrls,
} from "$lib/settings/ui";
import type { ManualSnapshot } from "./types";

// Preferences that have the same meaning on Android, Deck, and desktop. Paths,
// account tokens, downloads, and external-player configuration stay per-device.
export const SYNCED_SETTING_KEYS = [
  "episode-layout",
  "title-language",
  "player-title-top",
  "player-auto-skip",
  "player-skip-filler",
  "preferred-audio-lang",
  "preferred-sub-lang",
  "autoplay-best",
  "auto-select-animate",
  "preferred-quality",
  "show-dead-sources",
  "preferred-stream-sort",
  "player-autoplay-next",
  "player-binge-preload",
  "player-seek-seconds",
  "player-scrub-thumbnails",
  "player-cache-mb",
  "video-fit",
  "save-local-history",
  "hide-spoilers",
  "carousel-wheel-scroll",
  "ui-scale",
  "show-adult",
  "schedule-layout",
  "doh-enabled",
  "doh-url",
  "transfer-speed-limit",
  "comments-enabled",
  "comments-default-platform",
] as const;

function readSettings(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try {
      result[key] = JSON.parse(raw);
    } catch {
      /* ignore corrupt local state */
    }
  }
  return result;
}

export function createManualSnapshot(
  deviceId: string,
  deviceName: string,
): ManualSnapshot {
  return {
    app: "izumi",
    kind: "device-sync",
    version: 1,
    deviceId,
    deviceName: deviceName.trim() || "Izumi device",
    updatedAt: Date.now(),
    sources: {
      addonUrls: get(addonUrls),
      disabledSources: get(disabledSources),
    },
    extensions: {
      extensionUrls: get(extensionUrls),
      disabledExtensions: get(disabledExtensions),
      debridProvider: get(debridProvider),
      debridKey: get(debridKey),
    },
    settings: readSettings(),
  };
}

export function parseManualSnapshot(payload: string): ManualSnapshot | null {
  try {
    const value = JSON.parse(payload) as Partial<ManualSnapshot>;
    if (
      value.app !== "izumi" ||
      value.kind !== "device-sync" ||
      value.version !== 1 ||
      typeof value.deviceId !== "string" ||
      typeof value.deviceName !== "string" ||
      typeof value.updatedAt !== "number" ||
      !value.sources ||
      !value.extensions ||
      !value.settings ||
      !Array.isArray(value.sources.addonUrls) ||
      !Array.isArray(value.sources.disabledSources) ||
      !Array.isArray(value.extensions.extensionUrls) ||
      !Array.isArray(value.extensions.disabledExtensions) ||
      typeof value.settings !== "object"
    )
      return null;
    return value as ManualSnapshot;
  } catch {
    return null;
  }
}

/** Apply a user-selected device snapshot. Returns true when a reload is needed. */
export function applyManualSnapshot(snapshot: ManualSnapshot): boolean {
  addonUrls.set(
    snapshot.sources.addonUrls.filter(
      (x): x is string => typeof x === "string",
    ),
  );
  disabledSources.set(
    snapshot.sources.disabledSources.filter(
      (x): x is string => typeof x === "string",
    ),
  );
  extensionUrls.set(
    snapshot.extensions.extensionUrls.filter(
      (x): x is string => typeof x === "string",
    ),
  );
  disabledExtensions.set(
    snapshot.extensions.disabledExtensions.filter(
      (x): x is string => typeof x === "string",
    ),
  );
  if (typeof snapshot.extensions.debridProvider === "string")
    debridProvider.set(snapshot.extensions.debridProvider);
  if (typeof snapshot.extensions.debridKey === "string")
    debridKey.set(snapshot.extensions.debridKey);
  for (const key of SYNCED_SETTING_KEYS) {
    if (Object.hasOwn(snapshot.settings, key))
      localStorage.setItem(key, JSON.stringify(snapshot.settings[key]));
  }
  return true;
}
