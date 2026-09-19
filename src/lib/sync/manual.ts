import { get } from "svelte/store";
import { persisted } from "svelte-persisted-store";
import { anilistToken } from "$lib/anilist/auth";
import { kitsuToken, malToken, simklToken } from "$lib/trackers/config";
import { addonUrls, disabledSources } from "$lib/stremio/sources";
import {
  debridKey,
  debridProvider,
  disabledExtensions,
  extensionUrls,
} from "$lib/settings/ui";
import type { ManualSnapshot } from "./types";
import { activeProfileId, DEFAULT_PROFILE_ID } from '$lib/profiles/store'

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
  "adaptive-source-mode",
  "show-dead-sources",
  "preferred-stream-sort",
  "player-autoplay-next",
  "player-up-next-overlay",
  "player-binge-preload",
  "player-seek-seconds",
  "player-subtitle-line-navigation",
  "player-scrub-thumbnails",
  "player-progress-animations",
  "player-cache-mb",
  "video-fit",
  "save-local-history",
  "auto-watchlist-enabled",
  "auto-watchlist-episodes",
  "continue-watching-catalog-scope",
  "catalog-default-provider",
  "catalog-providers",
  "catalog-last-provider",
  "catalog-last-screen",
  "catalog-home-layouts-v1",
  "catalog-collections-v1",
  "stremio-home-hero-artwork",
  "hide-spoilers",
  "carousel-wheel-scroll",
  "show-adult",
  "schedule-layout",
  "doh-enabled",
  "doh-url",
  "comments-default-source",
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

/** Only ever true for a one-off first-run transfer the sender confirmed. Defaults to off so the
 *  routine snapshot that every device publishes keeps carrying no credentials at all. */
export function readAccountTokens(): NonNullable<ManualSnapshot["accounts"]> {
  const accounts: NonNullable<ManualSnapshot["accounts"]> = {};
  const anilist = get(anilistToken);
  const mal = get(malToken);
  const kitsu = get(kitsuToken);
  const simkl = get(simklToken);
  if (anilist) accounts.anilist = anilist;
  if (mal) accounts.mal = mal;
  if (kitsu) accounts.kitsu = kitsu;
  if (simkl) accounts.simkl = simkl;
  return accounts;
}

export function createManualSnapshot(
  deviceId: string,
  deviceName: string,
  includeAccounts = false,
): ManualSnapshot {
  const accounts = includeAccounts ? readAccountTokens() : {};
  return {
    ...(Object.keys(accounts).length ? { accounts } : {}),
    app: "izumi",
    kind: "device-sync",
    profileId: get(activeProfileId),
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
    // A record on the wire is untrusted input. Anything that is not a non-empty string for a
    // known tracker is dropped rather than failing the whole snapshot, so a malformed accounts
    // block costs the sign-ins and not the sources.
    const snapshot = value as ManualSnapshot;
    if (snapshot.accounts) {
      if (typeof snapshot.accounts !== "object" || Array.isArray(snapshot.accounts)) {
        delete snapshot.accounts;
      } else {
        const clean: NonNullable<ManualSnapshot["accounts"]> = {};
        for (const key of ["anilist", "mal", "kitsu", "simkl"] as const) {
          const token = snapshot.accounts[key];
          if (typeof token === "string" && token) clean[key] = token;
        }
        if (Object.keys(clean).length) snapshot.accounts = clean;
        else delete snapshot.accounts;
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** Apply a user-selected device snapshot to storage and the live app stores. */
export function applyManualSnapshot(
  snapshot: ManualSnapshot,
  includeAccounts = true,
): void {
  if ((snapshot.profileId ?? DEFAULT_PROFILE_ID) !== get(activeProfileId)) {
    throw new Error('Switch to the matching profile before receiving these settings.')
  }
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
    if (Object.hasOwn(snapshot.settings, key)) {
      const value = snapshot.settings[key];
      // `persisted` returns the existing store for a key when one has already
      // been created elsewhere. Updating it here keeps the running UI and
      // localStorage in sync, so Android does not need a full WebView reload.
      persisted<unknown>(key, value).set(value);
    }
  }
  if (includeAccounts) applyAccountTokens(snapshot.accounts);
}

/**
 * Present only when the sender was asked to include sign-ins for this one transfer. A missing
 * entry means "nothing to send", never "sign out" — so this only ever writes, never clears.
 *
 * Separate from {@link applyManualSnapshot} so first-run setup can apply the sources first and
 * the sign-ins under their own progress label, instead of claiming a step it already did.
 */
export function applyAccountTokens(accounts: ManualSnapshot["accounts"]): boolean {
  if (!accounts) return false;
  const { anilist, mal, kitsu, simkl } = accounts;
  if (anilist) anilistToken.set(anilist);
  if (mal) malToken.set(mal);
  if (kitsu) kitsuToken.set(kitsu);
  if (simkl) simklToken.set(simkl);
  return Boolean(anilist || mal || kitsu || simkl);
}
