import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'

// Read line endings out of the picture. A Windows checkout hands these back as CRLF, which silently
// skipped the shortcut-writer suite here while CI ran it — the worst possible split.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const installer = read('scripts/deck/install.sh')
const launcher = read('scripts/deck/izumi-installer.desktop')
const workflow = read('.github/workflows/release.yml')

// The Steam half of the installer is a python heredoc. Extracting it is what lets the binary VDF
// writing — the one part that can silently destroy a user's non-Steam library — be tested for real
// instead of eyeballed.
const shortcutScript = installer.split("python3 - <<'PYTHON'\n")[1]?.split('\nPYTHON\n')[0]

/** Absolute path to a Python 3, so a stub named `python3` can never resolve back to itself. */
const python = ['python3', 'python', 'py'].reduce<string | undefined>((found, candidate) => {
  if (found) return found
  const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' })
  const path = probe.stdout?.trim()
  return probe.status === 0 && path ? path : undefined
}, undefined)

/** Steam's own id for a non-Steam shortcut, recomputed independently of the installer. */
const expectedAppId = crc32(Buffer.from('"/usr/bin/flatpak"izumi', 'utf8')) | 0x80000000

/** Minimal binary-VDF reader: 0x00 map, 0x01 string, 0x02 int32, 0x08 end of map. */
function readVdf(buffer: Buffer, start = 0): [Record<string, unknown>, number] {
  const out: Record<string, unknown> = {}
  let index = start
  while (index < buffer.length) {
    const marker = buffer[index++]
    if (marker === 0x08) return [out, index]
    const keyEnd = buffer.indexOf(0, index)
    const key = buffer.toString('utf8', index, keyEnd)
    index = keyEnd + 1
    if (marker === 0x00) {
      const [value, next] = readVdf(buffer, index)
      out[key] = value
      index = next
    } else if (marker === 0x01) {
      const end = buffer.indexOf(0, index)
      out[key] = buffer.toString('utf8', index, end)
      index = end + 1
    } else if (marker === 0x02) {
      out[key] = buffer.readUInt32LE(index)
      index += 4
    } else {
      throw new Error(`unsupported VDF marker 0x${marker.toString(16)}`)
    }
  }
  return [out, index]
}

function writeVdf(entries: Record<string, Record<string, string | number>>): Buffer {
  const chunks: Buffer[] = [Buffer.from('\x00shortcuts\x00', 'binary')]
  for (const [index, entry] of Object.entries(entries)) {
    chunks.push(Buffer.from(`\x00${index}\x00`, 'binary'))
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === 'number') {
        const int = Buffer.alloc(4)
        int.writeUInt32LE(value >>> 0)
        chunks.push(Buffer.from(`\x02${key}\x00`, 'binary'), int)
      } else {
        chunks.push(Buffer.from(`\x01${key}\x00${value}\x00`, 'binary'))
      }
    }
    chunks.push(Buffer.from('\x08', 'binary'))
  }
  chunks.push(Buffer.from('\x08\x08', 'binary'))
  return Buffer.concat(chunks)
}

function runShortcutScript(userDirs: string[], artDir: string, icon = '/icons/izumi.png') {
  return spawnSync(python!, ['-c', shortcutScript!], {
    encoding: 'utf8',

    timeout: RUN_TIMEOUT_MS,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      IZUMI_ART_DIR: artDir,
      IZUMI_ICON: icon,
      IZUMI_USER_DIRS: userDirs.join('\n'),
    },
  })
}

function steamAccount(root: string, id: string) {
  const config = join(root, 'userdata', id, 'config')
  mkdirSync(config, { recursive: true })
  return config
}

function artwork(): string {
  const dir = mkdtempSync(join(tmpdir(), 'izumi-art-'))
  for (const name of ['portrait.png', 'landscape.png', 'hero.png', 'logo.png']) {
    writeFileSync(join(dir, name), Buffer.from(`fake ${name}`))
  }
  return dir
}

const shortcutsOf = (config: string) =>
  readVdf(readFileSync(join(config, 'shortcuts.vdf')))[0].shortcuts as Record<string, Record<string, unknown>>

describe('Deck installer script', () => {
  it('is valid bash', () => {
    // A syntax error only surfaces when a user runs it, and by then the Deck download is broken.
    expect(() => execFileSync('bash', ['-n', 'scripts/deck/install.sh'])).not.toThrow()
  })

  it('installs at user scope, which is what survives a SteamOS update', () => {
    expect(installer).toContain('flatpak install --user --assumeyes --from')
    expect(installer).not.toMatch(/flatpak install(?!.*--user)/)
    // Never elevates: the Deck may have no sudo password set at all, and a prompt inside Konsole
    // is where a first-time install stalls forever. (Prose about sudo in the comments is fine.)
    expect(installer).not.toMatch(/^\s*sudo\s/m)
  })

  it('offers add / add-and-choose / skip, and treats a dismissed dialog as skip', () => {
    expect(installer).toContain('--yesnocancel')
    expect(installer).toMatch(/0\) printf 'default.*1\) printf 'choose.*\*\) printf 'no/s)
  })

  it('can be pointed at a staging copy, so a change can be tried on a Deck before it ships', () => {
    expect(installer).toContain('SITE="${IZUMI_SITE:-https://flatpak.izumi.watch}"')
  })

  it('never writes the library entry underneath a running Steam', () => {
    // Steam rewrites shortcuts.vdf from memory when it exits, so a write now is lost later.
    expect(installer).toContain('pgrep -x steam')
    expect(installer).toContain('steam -shutdown')
  })
})

describe('installer launcher', () => {
  it('runs the published installer in a terminal', () => {
    expect(launcher).toContain('Exec=sh -c "curl -fsSL https://flatpak.izumi.watch/install.sh | bash"')
    expect(launcher).toContain('Terminal=true')
    // Every key the Desktop Entry spec requires of a launcher, so KDE offers "Execute" rather than
    // opening it in a text editor.
    for (const key of ['[Desktop Entry]', 'Type=Application', 'Name=']) expect(launcher).toContain(key)
  })

  it('is published at exactly the URL it fetches', () => {
    expect(workflow).toContain('install -Dm755 scripts/deck/install.sh flatpak/_legacy_repo/install.sh')
    // _legacy_repo is the publish_dir for the site root, which is what makes that path resolve.
    const publish = workflow.split('- name: Redirect legacy Flatpak installs to the channel repo')[1]
    expect(publish).toContain('publish_dir: ./flatpak/_legacy_repo')
    expect(publish).toContain('cname: flatpak.izumi.watch')
  })

  it('ships as a release asset the Deck download can point at', () => {
    expect(workflow).toContain('izumi-${{ steps.meta.outputs.tag }}-steamdeck-installer.desktop')
    const attach = workflow.split('- name: Attach the Flatpak to the release')[1]
    expect(attach).toContain('(flatpak|flatpakref|desktop)')
  })
})

describe('artwork the installer downloads', () => {
  const staged = workflow.split('- name: Stage the Deck installer and Steam artwork')[1].split('\n      - name:')[0]
  const variants = installer.match(/^VARIANTS='([^']+)'/m)![1].split(' ')

  it('publishes every variant the picker offers', () => {
    const listed = staged.match(/for variant in ([^;]+);/)![1].trim().split(/\s+/)
    expect(listed).toEqual(variants)
  })

  it.each([
    'izumi-capsule-600x900.png',
    'izumi-capsule-920x430.png',
  ])('publishes %s for every variant, and it exists in the brand set', (art) => {
    expect(staged).toContain(art)
    expect(installer).toContain(art)
    for (const variant of variants) {
      expect(existsSync(join('brand/steamgriddb', variant, art))).toBe(true)
    }
  })

  it('uses a hero with no wordmark in it, because Steam draws the logo on top', () => {
    // A per-variant SteamGridDB hero is a finished composition: cover art, mark AND wordmark. Steam
    // then paints <appid>_logo.png over it, so the Deck library page showed the wordmark twice.
    expect(installer).toContain('izumi-hero-anime-1920x620.png')
    expect(installer).not.toContain('izumi-hero-1920x620.png')
    expect(staged).toContain('izumi-hero-anime-1920x620.png')
    expect(existsSync(join('brand/steamgriddb/hero', 'izumi-hero-anime-1920x620.png'))).toBe(true)
    // The one hero serves every cover variant, so no variant may reintroduce a wordmarked one.
    const heroLine = installer.split('\n').find((line) => line.includes('hero.png'))!
    expect(heroLine).not.toContain('$VARIANT')
  })

  it('pins the logo where the hero was built for it', () => {
    // Steam defaults a shortcut's logo to the bottom left. This hero's shade pool — the only part
    // of it a white wordmark reliably reads against — is in the middle of the frame.
    expect(installer).toContain('"pinnedPosition": "CenterCenter"')
    // Never rewritten: moving the logo is a thing people do, and a re-run must not undo it.
    expect(installer).toContain('if not os.path.exists(position):')
  })

  it('publishes the white wordmark the plain hero is designed around', () => {
    expect(installer).toContain('izumi-logo-horizontal-white@2x.png')
    expect(staged).toContain('izumi-logo-horizontal-white@2x.png')
    expect(existsSync(join('brand/steamgriddb/logo', 'izumi-logo-horizontal-white@2x.png'))).toBe(true)
  })
})

const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0

/** A PATH of fakes, so the whole installer can run end to end without touching flatpak or network. */
function stubEnvironment(home: string) {
  const bin = mkdtempSync(join(tmpdir(), 'izumi-bin-'))
  const log = join(bin, 'calls.log')
  const marker = join(bin, 'installed')
  const write = (name: string, body: string) => {
    const path = join(bin, name)
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
  }
  write('flatpak', `
echo "flatpak $*" >> "${log}"
case "$1" in
  info) [ -f "${marker}" ] ;;
  install) touch "${marker}" ;;
  *) exit 0 ;;
esac`)
  write('curl', `
echo "curl $*" >> "${log}"
target=""
while [ $# -gt 0 ]; do case "$1" in -o) target="$2"; shift ;; esac; shift; done
[ -n "$target" ] && printf 'png' > "$target"
exit 0`)
  // No Steam process: the installer must not try to shut one down.
  write('pgrep', 'exit 1')
  // Absolute interpreter path only. `exec python3 "$@"` would re-enter this very stub — the stub
  // directory leads PATH — and fork until the machine gives up, which is exactly how this hung a
  // CI runner for half an hour before the path was resolved.
  write('python3', `exec "${python}" "$@"`)
  return { bin, log, marker, home }
}

/** Every installer run is bounded: a hang must fail this test, not stall the whole job. */
const RUN_TIMEOUT_MS = 60_000

function runInstaller(args: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'izumi-home-'))
  const stubs = stubEnvironment(home)
  const result = spawnSync('bash', ['scripts/deck/install.sh', ...args], {
    encoding: 'utf8',

    timeout: RUN_TIMEOUT_MS,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${stubs.bin}:${process.env.PATH}`,
      // No display: the installer falls back to terminal prompts, and with no readable /dev/tty
      // those take their defaults — which is the unattended path this exercises.
      DISPLAY: '',
      WAYLAND_DISPLAY: '',
      PYTHONUTF8: '1',
    },
  })
  return { ...stubs, result, calls: existsSync(stubs.log) ? readFileSync(stubs.log, 'utf8') : '' }
}

describe.runIf(bash && python)('installer end to end, against stubbed flatpak and network', () => {
  it('installs the stable channel at user scope and adds the Steam entry', () => {
    const home = mkdtempSync(join(tmpdir(), 'izumi-home-'))
    const config = steamAccount(join(home, '.local/share/Steam'), '76561190000000000')
    const stubs = stubEnvironment(home)
    const result = spawnSync('bash', ['scripts/deck/install.sh'], {
      encoding: 'utf8',

      timeout: RUN_TIMEOUT_MS,
      env: {
        ...process.env, HOME: home, PATH: `${stubs.bin}:${process.env.PATH}`,
        DISPLAY: '', WAYLAND_DISPLAY: '', PYTHONUTF8: '1',
      },
    })
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)

    const calls = readFileSync(stubs.log, 'utf8')
    expect(calls).toContain('flatpak install --user --assumeyes --from https://flatpak.izumi.watch/stable/com.nicho.izumi.flatpakref')
    expect(calls).toContain('https://flatpak.izumi.watch/steamgrid/flat/izumi-capsule-600x900.png')

    const entries = shortcutsOf(config)
    expect(entries['0'].AppName).toBe('izumi')
    expect(existsSync(join(config, 'grid', `${expectedAppId >>> 0}p.png`))).toBe(true)
  })

  it('takes the beta channel when asked', () => {
    const run = runInstaller(['--beta'])
    expect(run.result.status, `${run.result.stdout}${run.result.stderr}`).toBe(0)
    expect(run.calls).toContain('https://flatpak.izumi.watch/beta/com.nicho.izumi.flatpakref')
  })

  it('updates instead of reinstalling when izumi is already present', () => {
    const home = mkdtempSync(join(tmpdir(), 'izumi-home-'))
    const stubs = stubEnvironment(home)
    writeFileSync(stubs.marker, '')
    const result = spawnSync('bash', ['scripts/deck/install.sh', '--no-steam'], {
      encoding: 'utf8',

      timeout: RUN_TIMEOUT_MS,
      env: { ...process.env, HOME: home, PATH: `${stubs.bin}:${process.env.PATH}`, DISPLAY: '', WAYLAND_DISPLAY: '' },
    })
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
    const calls = readFileSync(stubs.log, 'utf8')
    expect(calls).toContain('flatpak update --user --assumeyes com.nicho.izumi')
    expect(calls).not.toContain('flatpak install')
  })

  it('leaves a working install behind when the user dismisses the Steam dialog', () => {
    // Exercises the graphical branch — tool detection included — with a dialog the user cancels.
    // A dismissed dialog exiting non-zero must not take the installer down with it.
    const home = mkdtempSync(join(tmpdir(), 'izumi-home-'))
    steamAccount(join(home, '.local/share/Steam'), '76561190000000000')
    const stubs = stubEnvironment(home)
    writeFileSync(join(stubs.bin, 'zenity'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 })
    const result = spawnSync('bash', ['scripts/deck/install.sh'], {
      encoding: 'utf8',

      timeout: RUN_TIMEOUT_MS,
      env: {
        // The stub directory leads, so this zenity is found before any the host may have.
        ...process.env, HOME: home, PATH: `${stubs.bin}:${process.env.PATH}`,
        DISPLAY: ':0', WAYLAND_DISPLAY: '', PYTHONUTF8: '1',
      },
    })
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('Skipping the Steam library entry')
    expect(existsSync(join(home, '.local/share/Steam/userdata/76561190000000000/config/shortcuts.vdf'))).toBe(false)
  })

  it('survives being piped into bash while flatpak reads stdin', () => {
    // The launcher runs `curl … | bash`, so the script IS bash's stdin. A child that reads stdin
    // consumes the text bash has not parsed yet and bash stops there without an error — which is
    // how the Steam question vanished on a first install and came back on the next run, where the
    // shorter update path happens not to read anything.
    const home = mkdtempSync(join(tmpdir(), 'izumi-home-'))
    const config = steamAccount(join(home, '.local/share/Steam'), '76561190000000000')
    const stubs = stubEnvironment(home)
    // A flatpak that drains stdin, which is exactly what the real one does on a fresh install.
    writeFileSync(join(stubs.bin, 'flatpak'), `#!/usr/bin/env bash
echo "flatpak $*" >> "${stubs.log}"
cat >/dev/null 2>&1 || true
case "$1" in
  info) [ -f "${stubs.marker}" ] ;;
  install) touch "${stubs.marker}" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 })

    const result = spawnSync('bash', [], {
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
      input: readFileSync('scripts/deck/install.sh'),
      env: {
        ...process.env, HOME: home, PATH: `${stubs.bin}:${process.env.PATH}`,
        DISPLAY: '', WAYLAND_DISPLAY: '', PYTHONUTF8: '1',
      },
    })

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
    expect(shortcutsOf(config)['0'].AppName).toBe('izumi')
  })

  it('succeeds on a machine with no Steam at all', () => {
    // The Steam step is a bonus; a desktop Linux user without Steam must still end up installed.
    const run = runInstaller()
    expect(run.result.status, `${run.result.stdout}${run.result.stderr}`).toBe(0)
    expect(run.result.stdout).toContain('No Steam installation found')
  })
})

describe.runIf(python && shortcutScript)('Steam shortcut writer', () => {
  it('writes an entry Steam can launch, and names the artwork for its app id', () => {
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const config = steamAccount(root, '123456')

    const result = runShortcutScript([join(root, 'userdata', '123456')], artwork())
    expect(result.status, result.stderr).toBe(0)

    const entries = shortcutsOf(config)
    expect(Object.keys(entries)).toEqual(['0'])
    expect(entries['0']).toMatchObject({
      appid: expectedAppId >>> 0,
      AppName: 'izumi',
      Exe: '"/usr/bin/flatpak"',
      LaunchOptions: 'run com.nicho.izumi',
      FlatpakAppID: 'com.nicho.izumi',
      AllowOverlay: 1,
      IsHidden: 0,
    })

    const grid = readdirSync(join(config, 'grid')).sort()
    const id = expectedAppId >>> 0
    // Four art slots plus the logo-position file, all keyed on the id written into the shortcut.
    expect(grid).toEqual([`${id}.json`, `${id}.png`, `${id}_hero.png`, `${id}_logo.png`, `${id}p.png`].sort())
  })

  it('writes the logo position once, and never over one the user has moved', () => {
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const config = steamAccount(root, '123456')
    const userDir = join(root, 'userdata', '123456')

    expect(runShortcutScript([userDir], artwork()).status).toBe(0)
    const position = join(config, 'grid', `${expectedAppId >>> 0}.json`)
    expect(JSON.parse(readFileSync(position, 'utf8')).logoPosition.pinnedPosition).toBe('CenterCenter')

    writeFileSync(position, JSON.stringify({ nVersion: 1, logoPosition: { pinnedPosition: 'BottomLeft' } }))
    expect(runShortcutScript([userDir], artwork()).status).toBe(0)
    // Someone who dragged their logo somewhere else keeps it through a reinstall.
    expect(JSON.parse(readFileSync(position, 'utf8')).logoPosition.pinnedPosition).toBe('BottomLeft')
  })

  it('keeps the shortcuts the user already had, and backs the file up first', () => {
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const config = steamAccount(root, '123456')
    writeFileSync(join(config, 'shortcuts.vdf'), writeVdf({
      0: { appid: 0x9000_0001, AppName: 'Firefox', Exe: '"/usr/bin/firefox"', LaunchOptions: '' },
    }))

    const result = runShortcutScript([join(root, 'userdata', '123456')], artwork())
    expect(result.status, result.stderr).toBe(0)

    const entries = shortcutsOf(config)
    expect(Object.keys(entries)).toEqual(['0', '1'])
    expect(entries['0'].AppName).toBe('Firefox')
    expect(entries['1'].AppName).toBe('izumi')
    expect(readdirSync(config).some((name) => name.startsWith('shortcuts.vdf.izumi-backup-'))).toBe(true)
  })

  it('updates its own entry in place on a re-run, keeping the id and playtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const config = steamAccount(root, '123456')
    const userDir = join(root, 'userdata', '123456')
    writeFileSync(join(config, 'shortcuts.vdf'), writeVdf({
      0: {
        appid: 0x8abc_def0, AppName: 'izumi', Exe: '"/old/path"',
        LaunchOptions: 'run com.nicho.izumi', LastPlayTime: 1_700_000_000,
      },
    }))

    expect(runShortcutScript([userDir], artwork()).status).toBe(0)
    const entries = shortcutsOf(config)
    expect(Object.keys(entries)).toEqual(['0'])
    // The id is what the artwork and the controller layout are keyed on; a re-run must not move it.
    expect(entries['0'].appid).toBe(0x8abc_def0)
    expect(entries['0'].LastPlayTime).toBe(1_700_000_000)
    expect(entries['0'].Exe).toBe('"/usr/bin/flatpak"')
    expect(existsSync(join(config, 'grid', `${0x8abc_def0}p.png`))).toBe(true)
  })

  it('refuses to rewrite a shortcuts.vdf it cannot parse', () => {
    // Steam deletes a malformed shortcuts.vdf outright. Overwriting one we misread would take the
    // user's whole non-Steam library with it, so the file is left exactly as found.
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const config = steamAccount(root, '123456')
    const corrupt = Buffer.from('\x07not a vdf at all\x00')
    writeFileSync(join(config, 'shortcuts.vdf'), corrupt)

    const result = runShortcutScript([join(root, 'userdata', '123456')], artwork())
    expect(result.status).not.toBe(0)
    expect(readFileSync(join(config, 'shortcuts.vdf')).equals(corrupt)).toBe(true)
    expect(existsSync(join(config, 'grid'))).toBe(false)
  })

  it('adds the entry for every Steam account on the machine', () => {
    const root = mkdtempSync(join(tmpdir(), 'izumi-steam-'))
    const first = steamAccount(root, '111')
    const second = steamAccount(root, '222')

    const result = runShortcutScript(
      [join(root, 'userdata', '111'), join(root, 'userdata', '222')],
      artwork(),
    )
    expect(result.status, result.stderr).toBe(0)
    expect(shortcutsOf(first)['0'].AppName).toBe('izumi')
    expect(shortcutsOf(second)['0'].AppName).toBe('izumi')
  })
})
