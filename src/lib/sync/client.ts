import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { get } from "svelte/store";
import { persisted } from "svelte-persisted-store";
import { anilistToken } from "$lib/anilist/auth";
import { kitsuToken, malToken, simklToken } from "$lib/trackers/config";
// Durable stores only: an incognito overlay change must not schedule a device-sync push (and
// exportJson reads the durable stores anyway, so pushing on overlay edits would be pure noise).
import { durableHistory } from "$lib/player/history";
import { durablePositions } from "$lib/player/progress";
import { episodeSourceOrigins, sourceOrigins } from "$lib/player/source-origin";
import { localLibrary } from "$lib/library/local-lists";
import { seriesTrackPreferences } from "$lib/player/track-preferences";
import { sceneBookmarkRecords } from "$lib/player/scene-bookmarks";
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
import {
  collectSyncMembers,
  fallbackDeviceName,
  presenceName,
  type SyncMember,
} from "./members";
import {
  checkCloudflareWorkerUpdate,
  cloudflareSetupSecret,
  cloudflareSyncConfig,
  cloudflareWorkerUpdateAvailable,
  createCloudflareCompanionEnrollment,
  createCloudflareCompanionPairing,
  createCloudflareInvite,
  claimCloudflareWorker,
  disableCloudflareSync,
  enableCloudflareSync,
  generateCloudflareSetupSecret,
  getCloudflareSyncStatus,
  joinCloudflareInvite,
  leaveCloudflareSync,
  readCloudflareRecords,
  removeCloudflareCompanionPairing,
  revokeCloudflareCompanionTransport,
  startCloudflareWorkerUpdateChecks,
  syncProvider,
  writeCloudflareRecord,
} from './cloudflare'
import { isCompanionSnapshot, type CompanionHomeSnapshot } from '$lib/companion/protocol'

export {
  checkCloudflareWorkerUpdate,
  cloudflareSetupSecret,
  cloudflareSyncConfig,
  cloudflareWorkerUpdateAvailable,
  createCloudflareCompanionEnrollment,
  createCloudflareCompanionPairing,
  createCloudflareInvite,
  claimCloudflareWorker,
  generateCloudflareSetupSecret,
  joinCloudflareInvite,
  removeCloudflareCompanionPairing,
  revokeCloudflareCompanionTransport,
  syncProvider,
}
export type { CloudflareCompanionTransport } from './cloudflare'

export async function setSyncProvider(provider: 'iroh' | 'cloudflare'): Promise<void> {
  if (provider === get(syncProvider)) return
  if (provider === 'cloudflare') {
    // Selecting the hosted provider must also stop the persisted native listener; otherwise an old
    // Iroh room could remain reachable even though the UI says Cloudflare is active.
    await invoke<void>('sync_disable').catch(() => {})
  }
  syncProvider.set(provider)
}

export type { SyncMember }

export const syncDeviceName = persisted<string>("sync-device-name", "");

export const trackersOwnProgress = () => !!get(anilistToken) || !!get(malToken) || !!get(kitsuToken) || !!get(simklToken);
export const getSyncStatus = () => get(syncProvider) === 'cloudflare'
  ? getCloudflareSyncStatus()
  : invoke<SyncStatus>("sync_status");
export const getSyncRelayConfig = () => invoke<{ customUrl?: string | null }>("sync_relay_config");
export const setSyncRelay = (customUrl?: string | null) =>
  invoke<void>("sync_set_relay", { customUrl: customUrl?.trim() || null });
export const enableDeviceSync = async () => {
  if (get(syncProvider) === 'cloudflare') return enableCloudflareSync()
  return invoke<void>("sync_enable")
}
export const disableDeviceSync = async () => {
  if (get(syncProvider) === 'cloudflare') return disableCloudflareSync()
  return invoke<void>("sync_disable")
}
export const createSyncGroup = () => invoke<string>("sync_create");
export const joinSyncGroup = (ticket: string) =>
  invoke<void>("sync_join", { ticket });
export const leaveSyncGroup = () => get(syncProvider) === 'cloudflare'
  ? leaveCloudflareSync()
  : invoke<void>("sync_leave");
export const listNearbyDevices = () => get(syncProvider) === 'cloudflare'
  ? Promise.resolve([] as NearbyDevice[])
  : invoke<NearbyDevice[]>("sync_nearby_list");
export const openNearbyPairing = () => get(syncProvider) === 'cloudflare'
  ? Promise.reject(new Error('Nearby pairing is only available with peer-to-peer sync.'))
  : invoke<PairingWindow>("sync_pairing_open");
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

type SyncCategory = "watch" | "manual" | "presence" | "companion"

async function write(category: SyncCategory, payload: string) {
  if (get(syncProvider) === 'cloudflare') return writeCloudflareRecord(category, payload)
  await invoke("sync_write", { category, payload });
}

async function read(category: SyncCategory) {
  if (get(syncProvider) === 'cloudflare') return readCloudflareRecords(category)
  return invoke<SyncRecord[]>("sync_read", { category });
}

/** Materialized TV data follows whichever sync provider owns this group; provider/catalog
 * credentials never leave the full client. */
export async function publishCompanionSnapshot(snapshot: CompanionHomeSnapshot): Promise<void> {
  const status = await getSyncStatus()
  if (status.state !== 'ready' || !status.paired) throw new Error('Create or join a sync group before pairing a TV.')
  await write('companion', JSON.stringify(snapshot))
}

export async function latestCompanionSnapshot(): Promise<CompanionHomeSnapshot | null> {
  const records = await read('companion')
  return records
    .flatMap((record) => {
      try {
        const value: unknown = JSON.parse(record.payload)
        return isCompanionSnapshot(value) ? [value] : []
      } catch { return [] }
    })
    .sort((left, right) => right.generatedAt - left.generatedAt)[0] ?? null
}

export async function publishPresence(): Promise<void> {
  const status = await getSyncStatus()
  if (status.state !== 'ready' || !status.paired) return
  const name = get(syncDeviceName).trim() || fallbackDeviceName(status.endpointId)
  await write('presence', JSON.stringify({
    app: 'izumi',
    kind: 'presence',
    version: 1,
    deviceId: status.endpointId,
    deviceName: name,
    updatedAt: Date.now(),
  }))
}

export async function listSyncMembers(): Promise<SyncMember[]> {
  const status = await getSyncStatus()
  if (status.state !== 'ready' || !status.paired) return []
  const named: Array<{ deviceId: string; name: string }> = []
  try {
    for (const record of await read('presence')) {
      const name = presenceName(record.payload)
      if (name) named.push({ deviceId: record.deviceId, name })
    }
  } catch { /* document still empty */ }
  try {
    for (const record of await read('manual')) {
      const snapshot = parseManualSnapshot(record.payload)
      if (snapshot?.deviceName) named.push({ deviceId: record.deviceId, name: snapshot.deviceName })
    }
  } catch { /* optional */ }
  return collectSyncMembers(
    status.endpointId,
    get(syncDeviceName).trim() || fallbackDeviceName(status.endpointId),
    named,
  )
}

export async function pushWatchProgress(): Promise<boolean> {
  const status = await getSyncStatus();
  if (status.state !== "ready" || !status.paired) return false;
  // Connected trackers own anime-level episode counts. Iroh still owns exact
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
      imported += merged.imported + merged.positionsImported + merged.originsImported
        + merged.episodeOriginsImported + merged.sceneBookmarksImported;
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
  startCloudflareWorkerUpdateChecks()
  if (get(syncProvider) === 'cloudflare') void invoke<void>('sync_disable').catch(() => {})
  let primed = false;
  durableHistory.subscribe(() => {
    if (primed && !trackersOwnProgress()) scheduleWatchPush();
  });
  durablePositions.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  sourceOrigins.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  episodeSourceOrigins.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  localLibrary.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  seriesTrackPreferences.subscribe(() => {
    if (primed) scheduleWatchPush();
  });
  sceneBookmarkRecords.subscribe(() => {
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
  // Cloudflare has no long-lived socket. A low-frequency pull keeps background edits from another
  // device converged without creating noisy traffic or putting pressure on free-plan quotas.
  setInterval(() => {
    if (get(syncProvider) === 'cloudflare') void refresh()
  }, 30_000)
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
