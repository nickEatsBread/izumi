import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { addonUrls, disabledSources } from "$lib/stremio/sources";
import {
  debridKey,
  debridProvider,
  disabledExtensions,
  extensionUrls,
  preferredQuality,
} from "$lib/settings/ui";
import {
  applyManualSnapshot,
  createManualSnapshot,
  parseManualSnapshot,
} from "./manual";

describe("manual device sync snapshots", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
    localStorage.clear();
    addonUrls.set([]);
    disabledSources.set([]);
    extensionUrls.set([]);
    disabledExtensions.set([]);
    debridProvider.set("realdebrid");
    debridKey.set("");
    preferredQuality.set("1080");
  });

  it("round-trips sources, extension configuration, secrets, and portable settings", () => {
    addonUrls.set(["https://addon.test/config/manifest"]);
    disabledSources.set(["https://addon.test/off"]);
    extensionUrls.set(["gh:owner/repo"]);
    disabledExtensions.set(["gh:owner/off"]);
    debridProvider.set("alldebrid");
    debridKey.set("secret");
    localStorage.setItem("preferred-quality", JSON.stringify("2160"));

    const parsed = parseManualSnapshot(
      JSON.stringify(createManualSnapshot("device-a", "Deck")),
    );
    expect(parsed?.deviceName).toBe("Deck");

    addonUrls.set([]);
    extensionUrls.set([]);
    debridKey.set("");
    applyManualSnapshot(parsed!);
    expect(get(addonUrls)).toEqual(["https://addon.test/config/manifest"]);
    expect(get(extensionUrls)).toEqual(["gh:owner/repo"]);
    expect(get(debridProvider)).toBe("alldebrid");
    expect(get(debridKey)).toBe("secret");
    expect(get(preferredQuality)).toBe("2160");
    expect(JSON.parse(localStorage.getItem("preferred-quality")!)).toBe("2160");
  });

  it("keeps UI scale local to each device", () => {
    localStorage.setItem("ui-scale", JSON.stringify(1.25));
    const snapshot = createManualSnapshot("device-a", "Desktop");

    expect(snapshot.settings).not.toHaveProperty("ui-scale");

    // Older peers may still send ui-scale. Applying their snapshot must not
    // overwrite the receiving device's locally chosen scale.
    snapshot.settings["ui-scale"] = 0.8;
    localStorage.setItem("ui-scale", JSON.stringify(1.5));
    applyManualSnapshot(snapshot);

    expect(JSON.parse(localStorage.getItem("ui-scale")!)).toBe(1.5);
  });

  it("rejects unrelated or malformed JSON", () => {
    expect(parseManualSnapshot("{")).toBeNull();
    expect(parseManualSnapshot(JSON.stringify({ app: "other" }))).toBeNull();
  });
});
