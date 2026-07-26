export interface InstalledExtensionIdentity {
  id: string
}

export interface InstalledJvmExtensionIdentity extends InstalledExtensionIdentity {
  backend: string
  sourceId: string
  sourceIds?: string[]
}

/** Runtime package names are not stable application IDs. Source IDs are stable
 * across the upstream catalog, package manifest, and loaded JVM source. */
export function jvmSourceOwners(
  installed: InstalledJvmExtensionIdentity[],
): Map<string, string> {
  return new Map(
    installed
      .filter((extension) => extension.backend === 'aniyomi-jvm')
      .flatMap((extension) =>
        (extension.sourceIds?.length ? extension.sourceIds : [extension.sourceId])
          .map((sourceId) => [sourceId, extension.id] as const),
      ),
  )
}

/** A source is configured when either a remote manifest is enabled or at least
 * one installed package is enabled. Local `.izumi-ext` packages deliberately do
 * not add a fake manifest URL, so URL-only guards must use this helper. */
export function extensionSourceConfigured(
  enabledManifestUrls: string[],
  installed: InstalledExtensionIdentity[],
  disabledPluginIds: string[],
): boolean {
  return enabledManifestUrls.length > 0
    || installed.some((extension) => !disabledPluginIds.includes(extension.id))
}
