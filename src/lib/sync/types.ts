import type { HistoryEntry } from "$lib/player/history";
import type { Pos } from "$lib/player/progress";

export type SyncStatus =
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

export interface WatchSnapshot {
  app: "izumi";
  kind: "watch-history";
  version: 1;
  exportedAt: number;
  history: Record<number, HistoryEntry>;
  positions: Record<string, Pos>;
}

export interface ManualSnapshot {
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
}

export interface ManualDevice extends ManualSnapshot {
  isThisDevice: boolean;
}
