export interface InstalledExtensionIdentity {
  id: string
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
