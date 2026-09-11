import type { HistoryEntry } from "$lib/player/history";
import type { Pos } from "$lib/player/progress";
import type { RememberedSource } from "$lib/player/source-origin";
import type { LocalLibraryState } from "$lib/library/local-lists";
import type { SeriesTrackPreferences } from "$lib/player/track-preferences";
import type { SceneBookmarkRecords } from "$lib/player/scene-bookmarks";

export type SyncStatus =
  | { state: "disabled" }
  | { state: "starting" }
  | { state: "failed"; error: string }
  | { state: "ready"; endpointId: string; paired: boolean; ticket?: string | null };

export interface SyncRecord {
  deviceId: string;
  payload: string;
}

export interface NearbyDevice {
  endpointId: string;
  shortId: string;
}

export interface PairingWindow {
  endpointId: string;
  shortId: string;
  expiresAt: number;
}

export interface PairRequest {
  requestId: string;
  deviceName: string;
  code: string;
}

export interface PairOutgoing {
  endpointId: string;
  code: string;
}

/** A device that already holds a room is offering it to this empty one. Carries no capability:
 *  the ticket only arrives after the code below has been matched and accepted. */
export interface AdoptOffer {
  requestId: string;
  deviceName: string;
  code: string;
}

export interface WatchSnapshot {
  app: "izumi";
  kind: "watch-history";
  version: 1;
  exportedAt: number;
  history: Record<number, HistoryEntry>;
  positions: Record<string, Pos>;
  origins?: Record<number, RememberedSource>;
  localLibrary?: LocalLibraryState;
  trackPreferences?: Record<string, SeriesTrackPreferences>;
  sceneBookmarks?: SceneBookmarkRecords;
}

export interface ManualSnapshot {
  profileId?: string;
  app: "izumi";
  kind: "device-sync";
  version: 1;
  deviceId: string;
  deviceName: string;
  updatedAt: number;
  sources: { addonUrls: string[]; disabledSources: string[] };
  extensions: {
    extensionUrls: string[];
    disabledExtensions: string[];
    debridProvider: string;
    debridKey: string;
  };
  settings: Record<string, unknown>;
  /**
   * Signed-in trackers, and the one field here that is a live credential rather than a preference.
   *
   * Absent unless the sending device was explicitly asked to include it for a single transfer —
   * routine device-sync snapshots must never carry it. That is why it is optional and why
   * `createManualSnapshot` defaults to leaving it out: the safe value has to be the one you get
   * by forgetting to think about it.
   */
  accounts?: {
    anilist?: string;
    mal?: string;
    kitsu?: string;
    simkl?: string;
  };
}

export interface ManualDevice extends ManualSnapshot {
  isThisDevice: boolean;
}
