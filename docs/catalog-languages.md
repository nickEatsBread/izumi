# Audio and subtitle languages per catalog

Each catalog plays in its own audio and subtitle language order. The catalogs are:

- the anime catalog (AniList, Kitsu and Aniyomi titles)
- TMDB
- Stremio add-ons
- every source catalog (`source:<package>`)

Code: `src/lib/settings/catalog-languages.ts`. Settings: Settings › Languages, under *Audio and
subtitles* (the global order) and *Per catalog*.

## Which order a title plays in

For audio and subtitles separately, the first entry in this list that has a value wins:

1. **The source account.** This applies only to a source catalog whose source reports its account
   languages (see below).
2. **The catalog's own order**, set under Settings › Languages › Per catalog (`catalog-languages-v1`,
   per household profile).
3. **The global order**, set under Settings › Languages › Audio and subtitles (`preferred-audio-lang`,
   `preferred-sub-lang`). It is skipped while set to *Automatic*.
4. **The catalog default:**
   - Anime: Japanese audio. Subtitles in English, then the system language.
   - Every other catalog: the system language for both. If the system language can't be read,
     English.

An order lists language tags, most wanted first. A tag is either ISO 639-2 (`jpn`) or BCP-47 as a
source reports it (`es-419`). A subtitle order of `none` turns subtitles off.

### Things to know

- Stremio has no account-level language setting to read. Stremio keeps audio and subtitle languages
  in each app's local settings, and its API returns no settings for a user. TMDB in izumi has no
  language setting of its own. So both use the system language.
- Upgrading moves the old built-in pair to *Automatic*. Setup used to store Japanese audio and English
  subtitles as an explicit choice, so it changes once: Japanese audio becomes Automatic, and English
  subtitles become Automatic. Any other stored choice is kept.
- A remembered pick for a series comes first. If the viewer chose a track in that series before
  (`track-preferences.ts`), that pick still wins over the catalog's order.

## Remembering what the viewer picks

Changing the audio or subtitles in the player is remembered for that show only, for the active
profile (`track-preferences.ts`, `series-track-preferences-v1`). The show's next episodes start in
the exact track picked (same title and language, then codec, then language). Other shows from the
same catalog keep starting in the catalog's languages, and a source account's languages are never
changed by a pick in the player: change those in Settings › Languages.

- Subtitles in the audio's own language (an English dub with English subtitles) pick Signs/Forced, or
  turn subtitles off. This now holds for every language, not only English.

## Where the order applies

- **mpv** (desktop and Android): `alang` and `slang`. Each tag is sent together with its ISO 639-2
  form (`mpvLanguageList`).
- **The subtitle choice after load:** `PlayerOverlay`, `AndroidPlayer` and the protected players
  `DrmSurface` (webview) and `NativeDrmSurface` (Linux). They use `pickSubtitleTrackId`, which walks
  the order and compares against the audio that is actually playing.
- **Protected presentations** (`preferredDrmPresentation`): burned-in and sidecar subtitles.
  Downloads also switch to the first wanted audio that has its own manifest. Playback keeps the
  source's audio on the first load, as before.
- **Downloads:** the Shaka offline track choice, and the decrypting downloader's plan.
- **Source ranking, provider ordering and subtitle searches:** the first language of the order.

## Source account languages (service settings protocol)

A local-service source can make its account's languages izumi's languages for its catalog. It uses
the existing service settings document (`GET/POST /__izumi/settings`), with two optional additions:

```jsonc
{
  "version": 1,
  "fields": [
    { "key": "audioLanguage", "label": "Audio language", "type": "select", "section": "languages", "options": [ … ] },
    { "key": "subtitleLanguage", "label": "Subtitle language", "type": "select", "section": "languages", "options": [ { "value": "none", "label": "Off" }, … ] }
  ],
  "values": { "audioLanguage": "ja-JP", "subtitleLanguage": "en-US" },
  "languages": { "audio": "audioLanguage", "subtitle": "subtitleLanguage" }
}
```

- **`languages`** names the fields that hold the account's audio and subtitle language. Each field
  holds one tag. The subtitle value `none` means off. An empty value means "not set": the catalog then
  falls back to its other orders. (A source account may have no language stored at all, and a
  service such as the one this was built against cannot store "off", so `''` must not be read as off.)
  Rules:
  - Leave `languages` out while signed out. izumi then drops what it kept.
  - A document that names the fields but has no values yet (details still loading) leaves izumi's copy
    alone.
- **`section: "languages"`** on a field makes it part of the source's Language section. izumi shows
  that section in three places:
  - at the top of the source's settings sheet, as rows that save each change on their own (the sheet
    leaves these fields out of its form, whatever their `visibleWhen`);
  - in Settings › Languages › Per catalog, under the source's catalog;
  - the sheet itself is listed in Settings › Sources and store › My sources as *<Source> settings*,
    next to Manage sources, so the account and its languages are one step from Settings.

  Rules:
  - A `visibleWhen` there counts only when it names another field of the same section.
  - izumi saves a change by posting just the changed field, with no action field. The source must
    accept such a save and change only the fields it is given. Re-sending the section's other values
    could put back an older one when the last reply was read before the account caught up.

### Sync

- **The source's own settings → izumi.** Every document izumi reads or gets back from a save updates
  its copy (`extensionServiceSettings` / `saveExtensionServiceSettings` in
  `src/lib/extensions/manager.ts`). That includes saves from the source's own sheet.
- **izumi's menu → the source.** In Settings › Languages, a change in the source's section saves that
  one field to the account (`saveSourceLanguageSection`). izumi's copy follows the document the source returns.
- **Before playback.** Playing a source title refreshes the copy if it is more than ten minutes old.
  The refresh runs in the background. Only the very first play from that source waits for it, and for
  at most 1.5 s (`refreshSourceLanguages`).

No new route, Rust command or package field: a source that ignores these keys behaves exactly as
before.
