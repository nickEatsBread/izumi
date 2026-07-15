import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { persisted } from "svelte-persisted-store";
import { anilistToken } from "$lib/anilist/auth";
import { malToken } from "$lib/trackers/config";
import { localHistory } from "$lib/player/history";
import { positions } from "$lib/player/progress";
import { exportJson, importJson } from "$lib/player/history-io";
import {
  applyManualSnapshot,
  createManualSnapshot,
  parseManualSnapshot,
} from "./manual";
import type {
  ManualDevice,
  NearbyDevice,
  PairingWindow,
  SyncRecord,
  SyncStatus,
} from "./types";

export const syncDeviceName = persisted<string>("sync-device-name", "");

export const trackersOwnProgress = () => !!get(anilistToken) || !!get(malToken);
export const getSyncStatus = () => invoke<SyncStatus>("sync_status");
export const createSyncGroup = () => invoke<string>("sync_create");
export const joinSyncGroup = (ticket: string) =>
  invoke<void>("sync_join", { ticket });
export const leaveSyncGroup = () => invoke<void>("sync_leave");
export const listNearbyDevices = () =>
  invoke<NearbyDevice[]>("sync_nearby_list");
export const openNearbyPairing = () =>
  invoke<PairingWindow>("sync_pairing_open");
export const respondToPairRequest = (requestId: string, approved: boolean) =>
  invoke<void>("sync_pair_respond", { requestId, approved });

export async function joinNearbyDevice(endpointId: string): Promise<void> {
  const status = await getSyncStatus();
  if (status.state !== "ready") throw new Error("Sync is still starting.");
  const fallback = `${navigator.platform || "Izumi"} - ${status.endpointId.slice(0, 6)}`;
  await invoke<void>("sync_pair_nearby", {
    endpointId,
    deviceName: get(syncDeviceName) || fallback,
  });
}

async function write(category: "watch" | "manual", payload: string) {
  await invoke("sync_write", { category, payload });
}

async function read(category: "watch" | "manual") {
  return invoke<SyncRecord[]>("sync_read", { category });
}

export async function pushWatchProgress(): Promise<boolean> {
  const status = await getSyncStatus();
  if (status.state !== "ready" || !status.paired) return false;
  // AniList/MAL own anime-level episode counts. Iroh still owns exact
  // per-episode resume positions because trackers cannot represent them.
  await write("watch", exportJson({ includeHistory: !trackersOwnProgress() }));
  return true;
}

export async function pullWatchProgress(): Promise<number> {
  const status = await getSyncStatus();
  if (status.state !== "ready" || !status.paired) return 0;
  let imported = 0;
  const includeHistory = !trackersOwnProgress();
  for (const record of await read("watch")) {
    try {
      const merged = importJson(record.payload, { includeHistory });
      imported += merged.imported + merged.positionsImported;
    } catch {
      /* skip malformed peer record */
    }
  }
  return imported;
}

export async function sendManualSnapshot(): Promise<void> {
  const status = await getSyncStatus();
  if (status.state !== "ready" || !status.paired)
    throw new Error("This device is not paired.");
  const fallback = `${navigator.platform || "Izumi"} - ${status.endpointId.slice(0, 6)}`;
  await write(
    "manual",
    JSON.stringify(
      createManualSnapshot(status.endpointId, get(syncDeviceName) || fallback),
    ),
  );
}

export async function listManualDevices(): Promise<ManualDevice[]> {
  const status = await getSyncStatus();
  if (status.state !== "ready" || !status.paired) return [];
  return (await read("manual"))
    .map((record) => {
      const snapshot = parseManualSnapshot(record.payload);
      return snapshot ? { ...snapshot, deviceId: record.deviceId } : null;
    })
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => !!snapshot)
    .map((snapshot) => ({
      ...snapshot,
      isThisDevice: snapshot.deviceId === status.endpointId,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function receiveManualSnapshot(snapshot: ManualDevice) {
  applyManualSnapshot(snapshot);
}

let initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let writing = false;

function scheduleWatchPush() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (writing) return scheduleWatchPush();
    writing = true;
    try {
      await pushWatchProgress();
    } catch {
      /* offline/unpaired: next edit or launch retries */
    } finally {
      writing = false;
    }
  }, 1500);
}

/** Start automatic watch sync once for the app lifetime. */
export function initDeviceSync() {
  if (initialized) return;
  initialized = true;
  let primed = false;
  localHistory.subscribe(() => {
    if (primed && !trackersOwnProgress()) scheduleWatchPush();
  });
  positions.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  anilistToken.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  malToken.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  primed = true;

  const refresh = async () => {
    try {
      await pullWatchProgress();
      scheduleWatchPush();
    } catch {
      /* backend may still be starting */
    }
  };
  listen("iroh-sync-ready", refresh).catch(() => {});
  listen("iroh-sync-update", () => {
    void pullWatchProgress();
  }).catch(() => {});
  // Cover both startup orderings: the ready event may fire before this listener,
  // or native Iroh startup may take longer than one fixed delay.
  void (async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const status = await getSyncStatus();
        if (status.state !== "starting") {
          await refresh();
          return;
        }
      } catch {
        /* native runtime is not ready yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  })();
}
