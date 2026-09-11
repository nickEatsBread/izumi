import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { addonUrls, disabledSources } from "$lib/stremio/sources";
import {
  debridKey,
  debridProvider,
  disabledExtensions,
  extensionUrls,
  adaptiveSourceMode,
  preferredQuality,
} from "$lib/settings/ui";
import {
  applyAccountTokens,
  applyManualSnapshot,
  createManualSnapshot,
  parseManualSnapshot,
} from "./manual";
import { anilistToken } from "$lib/anilist/auth";
import { kitsuToken, malToken, simklToken } from "$lib/trackers/config";

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
    adaptiveSourceMode.set("shadow");
  });

  it("round-trips sources, extension configuration, secrets, and portable settings", () => {
    addonUrls.set(["https://addon.test/config/manifest"]);
    disabledSources.set(["https://addon.test/off"]);
    extensionUrls.set(["gh:owner/repo"]);
    disabledExtensions.set(["gh:owner/off"]);
    debridProvider.set("alldebrid");
    debridKey.set("secret");
    localStorage.setItem("preferred-quality", JSON.stringify("2160"));
    localStorage.setItem("adaptive-source-mode", JSON.stringify("off"));

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
    expect(get(adaptiveSourceMode)).toBe("off");
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

  describe("signed-in accounts", () => {
    beforeEach(() => {
      anilistToken.set("anilist-secret");
      malToken.set("mal-secret");
      kitsuToken.set("");
      simklToken.set("");
    });

    it("leaves credentials out of the snapshot every device publishes", () => {
      // This is the invariant the whole feature hangs off: routine device sync runs constantly
      // and must never put a live token on the wire. Opting in is a separate, explicit argument.
      const snapshot = createManualSnapshot("device-a", "Desktop");
      expect(snapshot).not.toHaveProperty("accounts");
      expect(JSON.stringify(snapshot)).not.toContain("anilist-secret");
    });

    it("includes them only when the sender explicitly opted in", () => {
      const snapshot = createManualSnapshot("device-a", "Desktop", true);
      expect(snapshot.accounts).toEqual({ anilist: "anilist-secret", mal: "mal-secret" });
    });

    it("omits the block entirely when opted in but signed in nowhere", () => {
      anilistToken.set("");
      malToken.set("");
      expect(createManualSnapshot("device-a", "Desktop", true)).not.toHaveProperty("accounts");
    });

    it("holds accounts back when the receiver asks for setup only", () => {
      const snapshot = createManualSnapshot("device-a", "Desktop", true);
      anilistToken.set("");
      malToken.set("");
      applyManualSnapshot(snapshot, false);
      expect(get(anilistToken)).toBe("");

      // ...and applies them under their own step, which is what the first-run screen labels.
      expect(applyAccountTokens(snapshot.accounts)).toBe(true);
      expect(get(anilistToken)).toBe("anilist-secret");
    });

    it("never signs a device out just because a snapshot carried no token", () => {
      const snapshot = createManualSnapshot("device-a", "Desktop");
      anilistToken.set("mine");
      applyManualSnapshot(snapshot);
      expect(get(anilistToken)).toBe("mine");
    });

    it("drops junk in the accounts block without losing the rest of the snapshot", () => {
      const snapshot = createManualSnapshot("device-a", "Desktop");
      const payload = JSON.stringify({
        ...snapshot,
        sources: { addonUrls: ["https://example.invalid/manifest.json"], disabledSources: [] },
        accounts: { anilist: 42, mal: "", kitsu: { nested: true }, simkl: "simkl-secret" },
      });
      const parsed = parseManualSnapshot(payload);
      expect(parsed?.accounts).toEqual({ simkl: "simkl-secret" });
      expect(parsed?.sources.addonUrls).toEqual(["https://example.invalid/manifest.json"]);
    });
  });
});
