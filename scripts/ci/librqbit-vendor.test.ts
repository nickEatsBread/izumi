import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  BLOCK_BEGIN,
  BLOCK_END,
  code,
  compareVersions,
  crateFiles,
  dependencyClosure,
  differingFiles,
  indexPath,
  isNoticeOnlyDiff,
  lockedPackageCounts,
  parseLockedPackageNames,
  readPatchBlock,
  renderReport,
  replacePatchBlock,
  resolveLinkTarget,
  sourceFiles,
  untar,
} from './librqbit-vendor.mjs'

// scripts/ci/librqbit-vendor.mjs decides what src-tauri/vendor holds by packaging upstream crates and
// comparing them with crates.io. These cases cover the parts that decide without git or cargo.

function tarEntry(name: string, body: string | Buffer, type = '0') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const header = Buffer.alloc(512)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write(type, 156, 'ascii')
  header.write('ustar\0', 257, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)])
}

function paxRecord(key: string, value: string) {
  const payload = ` ${key}=${value}\n`
  let length = payload.length + 1
  while (`${length}${payload}`.length !== length) length += 1
  return `${length}${payload}`
}

const tar = (...entries: Buffer[]) => Buffer.concat([...entries, Buffer.alloc(1024)])

describe('untar', () => {
  it('reads regular files and skips directories', () => {
    const files = untar(tar(tarEntry('crate-1.0.0/', '', '5'), tarEntry('crate-1.0.0/src/lib.rs', 'pub fn a() {}\n')))
    expect([...files.keys()]).toEqual(['crate-1.0.0/src/lib.rs'])
    expect(files.get('crate-1.0.0/src/lib.rs')?.toString()).toBe('pub fn a() {}\n')
  })

  it('follows GNU long names and pax paths', () => {
    const long = `crate-1.0.0/${'a'.repeat(120)}.rs`
    const pax = `crate-1.0.0/${'b'.repeat(120)}.rs`
    const files = untar(
      tar(
        tarEntry('././@LongLink', `${long}\0`, 'L'),
        tarEntry(long.slice(0, 100), 'long'),
        tarEntry('PaxHeader', paxRecord('path', pax), 'x'),
        tarEntry(pax.slice(0, 100), 'pax'),
        tarEntry('crate-1.0.0/after.rs', 'after'),
      ),
    )
    expect(files.get(long)?.toString()).toBe('long')
    expect(files.get(pax)?.toString()).toBe('pax')
    expect(files.get('crate-1.0.0/after.rs')?.toString()).toBe('after')
  })

  it('strips the crate directory from a .crate archive', () => {
    const files = crateFiles(gzipSync(tar(tarEntry('librqbit-9.0.1/Cargo.toml', '[package]\n'))))
    expect([...files.keys()]).toEqual(['Cargo.toml'])
  })
})

describe('comparing a package with crates.io', () => {
  const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([k, v]) => [k, Buffer.from(v)]))

  it('ignores the commit record, the lockfile and omitted directories', () => {
    const ours = sourceFiles(
      files({ '.cargo_vcs_info.json': 'ours', 'Cargo.lock': 'ours', 'src/lib.rs': 'same', 'webui/index.html': 'x' }),
      ['webui/'],
    )
    const published = sourceFiles(files({ '.cargo_vcs_info.json': 'theirs', 'Cargo.lock': 'theirs', 'src/lib.rs': 'same' }), [
      'webui/',
    ])
    expect(differingFiles(ours, published)).toEqual([])
  })

  it('does not treat a file that merely starts with an omitted name as omitted', () => {
    expect([...sourceFiles(files({ webuix: 'kept', webui: 'dropped' }), ['webui']).keys()]).toEqual(['webuix'])
  })

  it('lists changed, added and removed files', () => {
    const ours = files({ 'src/a.rs': '1', 'src/b.rs': 'new', 'src/c.rs': 'same' })
    const published = files({ 'src/a.rs': '2', 'src/c.rs': 'same', 'src/d.rs': 'gone' })
    expect(differingFiles(ours, published)).toEqual(['src/a.rs', 'src/b.rs', 'src/d.rs'])
  })
})

describe('dependencyClosure', () => {
  const metadata = {
    packages: [
      { id: 'root', name: 'librqbit', source: null },
      { id: 'core', name: 'librqbit-core', source: null },
      { id: 'dev', name: 'test-helper', source: null },
      { id: 'serve', name: 'librqbit-upnp-serve', source: null },
      { id: 'reg', name: 'librqbit-utp', source: 'registry+https://github.com/rust-lang/crates.io-index' },
    ],
    resolve: {
      nodes: [
        {
          id: 'root',
          deps: [
            { pkg: 'core', dep_kinds: [{ kind: null }] },
            { pkg: 'dev', dep_kinds: [{ kind: 'dev' }] },
            { pkg: 'reg', dep_kinds: [{ kind: 'build' }] },
          ],
        },
        { id: 'core', deps: [] },
        { id: 'dev', deps: [{ pkg: 'serve', dep_kinds: [{ kind: null }] }] },
        { id: 'serve', deps: [] },
        { id: 'reg', deps: [] },
      ],
    },
  }

  it('follows normal and build dependencies, not dev-only ones', () => {
    expect([...dependencyClosure(metadata, 'librqbit')].sort()).toEqual(['librqbit', 'librqbit-core', 'librqbit-utp'])
  })

  it('refuses a root that is not a workspace member', () => {
    expect(() => dependencyClosure(metadata, 'librqbit-utp')).toThrow(/not a member/)
  })
})

describe('resolveLinkTarget', () => {
  it('resolves a crate README symlink inside the repository', () => {
    expect(resolveLinkTarget('crates/dht/README.md', '../README.md\n')).toBe('crates/README.md')
  })

  it('refuses a target outside the repository', () => {
    expect(resolveLinkTarget('README.md', '../outside.md')).toBeNull()
  })
})

describe('the [patch.crates-io] block', () => {
  const head = '[package]\nname = "izumi"\n\n[dependencies]\nlibrqbit = "9"\n'

  it('appends a block and reads it back', () => {
    const text = replacePatchBlock(head, ['librqbit', 'librqbit-dht'])
    expect(text).toContain(`${BLOCK_BEGIN}:`)
    expect(text.trimEnd().endsWith(BLOCK_END)).toBe(true)
    expect(readPatchBlock(text)).toEqual(['librqbit', 'librqbit-dht'])
  })

  it('replaces only the block, keeping what follows it', () => {
    const text = `${replacePatchBlock(head, ['librqbit'])}\n[profile.release]\nlto = true\n`
    const next = replacePatchBlock(text, ['librqbit', 'librqbit-utp'])
    expect(readPatchBlock(next)).toEqual(['librqbit', 'librqbit-utp'])
    expect(next.startsWith(head)).toBe(true)
    expect(next.endsWith('[profile.release]\nlto = true\n')).toBe(true)
  })

  it('removes the block when nothing is vendored', () => {
    const text = `${replacePatchBlock(head, ['librqbit'])}\n[profile.release]\nlto = true\n`
    const next = replacePatchBlock(text, [])
    expect(next).not.toContain(BLOCK_BEGIN)
    expect(next).not.toContain('[patch.crates-io]')
    expect(next).toContain('[profile.release]')
  })

  it('refuses to add a second [patch.crates-io] table', () => {
    expect(() => replacePatchBlock(`${head}\n[patch.crates-io]\nfoo = { path = "x" }\n`, ['librqbit'])).toThrow(
      /outside the librqbit-vendor block/,
    )
  })

  it('refuses a block with only one marker', () => {
    expect(() => replacePatchBlock(`${head}${BLOCK_BEGIN}\n`, ['librqbit'])).toThrow(/broken/)
  })
})

describe('parseLockedPackageNames', () => {
  it('reads every package name, with either line ending', () => {
    const lock = 'version = 4\n\n[[package]]\nname = "librqbit"\nversion = "9.0.1"\n\n[[package]]\r\nname = "ringbuf"\r\n'
    expect([...parseLockedPackageNames(lock)]).toEqual(['librqbit', 'ringbuf'])
  })
})


describe('lockedPackageCounts', () => {
  it('counts a name locked at two versions twice', () => {
    const lock = '[[package]]\nname = "windows-sys"\nversion = "0.59.0"\n\n[[package]]\nname = "windows-sys"\nversion = "0.61.2"\n\n[[package]]\nname = "librqbit"\n'
    const counts = lockedPackageCounts(lock)
    expect(counts.get('windows-sys')).toBe(2)
    expect(counts.get('librqbit')).toBe(1)
  })
})

describe('untar header formats', () => {
  it('ignores the ustar prefix field in a GNU header, where it holds timestamps', () => {
    const entry = tarEntry('crate-1.0.0/src/lib.rs', 'x')
    entry.write('ustar  \0', 257, 'latin1')
    entry.write('13057126712', 345, 'ascii')
    expect([...untar(tar(entry)).keys()]).toEqual(['crate-1.0.0/src/lib.rs'])
  })

  it('applies the prefix in a POSIX ustar header', () => {
    const entry = tarEntry('lib.rs', 'x')
    entry.write('crate-1.0.0/src', 345, 'utf8')
    expect([...untar(tar(entry)).keys()]).toEqual(['crate-1.0.0/src/lib.rs'])
  })

  it('refuses a crate entry that climbs out of its directory', () => {
    expect(() => crateFiles(gzipSync(tar(tarEntry('crate-1.0.0/../escape.rs', 'x'))))).toThrow(/escapes/)
  })
})

describe('the generated Cargo.toml', () => {
  const files = (toml: string) => new Map([['Cargo.toml', Buffer.from(toml)]])

  it('matches when only Cargo’s comments differ', () => {
    const a = '# THIS FILE IS AUTOMATICALLY GENERATED BY CARGO\n# older wording\n\n[package]\nname = "x"\n'
    const b = '# THIS FILE IS AUTOMATICALLY GENERATED BY CARGO\n#\n# newer wording, more lines\n[package]\nname = "x"\n'
    expect(differingFiles(files(a), files(b))).toEqual([])
  })

  it('differs when a declared value differs', () => {
    expect(differingFiles(files('[package]\nversion = "9.0.1"\n'), files('[package]\nversion = "9.0.2"\n'))).toEqual(['Cargo.toml'])
  })
})

describe('isNoticeOnlyDiff', () => {
  const diff = (body: string) => `diff --git a/x.rs b/x.rs\n--- a/x.rs\n+++ b/x.rs\n@@ -1,0 +1,3 @@\n${body}`

  it('recognizes a commit that only adds izumi notices', () => {
    expect(isNoticeOnlyDiff(diff('+// Modified for izumi: faster pieces. See\n+// src-tauri/vendor/README.md.\n+\n'))).toBe(true)
  })

  it('treats any code change as more than notices', () => {
    expect(isNoticeOnlyDiff(diff('+// Modified for izumi: see below.\n+const CRITICAL: usize = 8;\n'))).toBe(false)
  })

  it('does not call an empty diff notice-only', () => {
    expect(isNoticeOnlyDiff('')).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders by semver precedence, pre-releases before their release', () => {
    const sorted = ['9.0.1', '9.0.0', '9.1.0-rc.2', '9.1.0', '9.1.0-rc.10', '9.1.0-beta', '10.0.0'].sort(compareVersions)
    expect(sorted).toEqual(['9.0.0', '9.0.1', '9.1.0-beta', '9.1.0-rc.2', '9.1.0-rc.10', '9.1.0', '10.0.0'])
  })

  it('reports a stable release as newer than a pinned pre-release of it', () => {
    expect(compareVersions('9.1.0', '9.1.0-rc.0')).toBeGreaterThan(0)
  })
})

describe('indexPath', () => {
  it('follows the crates.io index layout', () => {
    expect(indexPath('a')).toBe('1/a')
    expect(indexPath('ab')).toBe('2/ab')
    expect(indexPath('abc')).toBe('3/a/abc')
    expect(indexPath('librqbit-DHT')).toBe('li/br/librqbit-dht')
  })
})

describe('code', () => {
  it('wraps text so GitHub neither links #123 nor notifies @names', () => {
    expect(code('Merge pull request #3 from @someone')).toBe('`Merge pull request #3 from @someone`')
  })

  it('uses a double fence when the text has a backtick', () => {
    expect(code('fix `stream()`')).toBe('`` fix `stream()` ``')
  })
})

describe('renderReport', () => {
  const repo = {
    key: 'rqbit',
    url: 'https://github.com/ikatson/rqbit.git',
    branch: 'main',
    pinned: 'a'.repeat(40),
    head: 'a'.repeat(40),
    commits: [] as { sha: string; subject: string }[],
    patches: ['p'],
  }

  it('says so when nothing needs doing', () => {
    const text = renderReport({ needsAttention: false, drift: [], releases: [], repos: [repo] })
    expect(text).toContain('matches its pins')
    expect(text).not.toContain('To update')
  })

  it('lists new commits safely, dropped and notice-only patches, conflicts, releases and drift', () => {
    const text = renderReport({
      needsAttention: true,
      drift: [
        { text: 'src-tauri/vendor/librqbit differs in `src/lib.rs`' },
        { text: 'Cargo.toml is not what this Cargo generates', minor: true },
      ],
      releases: [{ name: 'librqbit', pinned: '9.0.1', latest: '9.0.2' }],
      repos: [
        {
          ...repo,
          head: 'b'.repeat(40),
          commits: [{ sha: 'b'.repeat(40), subject: 'fix: something (#625) thanks @someone' }],
          patches: ['one', 'two', 'three'],
          rebase: { clean: true, dropped: ['two'], noticeOnly: ['three'] },
        },
        {
          ...repo,
          key: 'librqbit-utp',
          url: 'https://github.com/ikatson/librqbit-utp.git',
          head: 'd'.repeat(40),
          commits: [{ sha: 'd'.repeat(40), subject: 'feat: other' }],
          rebase: { clean: false, conflicts: ['src/socket.rs'] },
        },
      ],
    })
    expect(text).toContain('1 commit(s) after the pin')
    expect(text).toContain(`[\`bbbbbbb\`](https://github.com/ikatson/rqbit/commit/${'b'.repeat(40)}) \`fix: something (#625) thanks @someone\``)
    expect(text).toContain('Upstream now has `two`')
    expect(text).toContain('`three` only adds izumi')
    expect(text).toContain('conflict in `src/socket.rs`')
    expect(text).toContain('`librqbit 9.0.2` is out')
    expect(text).toContain('src-tauri/vendor/librqbit differs in `src/lib.rs`')
    expect(text).toMatch(/Notes:\n- Cargo\.toml is not what this Cargo generates/)
    // No bare #N or @name outside code spans.
    expect(text.replace(/``[^`]*``|`[^`]*`/g, '')).not.toMatch(/#\d|@\w/)
  })
})
