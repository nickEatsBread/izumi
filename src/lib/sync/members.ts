export type SyncMember = {
  deviceId: string
  name: string
  isThisDevice: boolean
}

export function fallbackDeviceName(endpointId: string) {
  return `Izumi device ${endpointId.slice(0, 6).toUpperCase()}`
}

export function collectSyncMembers(
  localId: string,
  localName: string,
  named: Array<{ deviceId: string; name: string }>,
): SyncMember[] {
  const names = new Map<string, string>()
  for (const item of named) {
    const name = item.name.trim()
    if (name) names.set(item.deviceId, name)
  }
  names.set(localId, localName.trim() || fallbackDeviceName(localId))
  return [...names.entries()]
    .map(([deviceId, name]) => ({
      deviceId,
      name,
      isThisDevice: deviceId === localId,
    }))
    .sort((a, b) => Number(b.isThisDevice) - Number(a.isThisDevice) || a.name.localeCompare(b.name))
}

export function presenceName(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { deviceName?: unknown }
    return typeof parsed.deviceName === 'string' ? parsed.deviceName.trim() : ''
  } catch {
    return ''
  }
}
