#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { arch, platform } from 'node:os'
import { fileURLToPath } from 'node:url'

const TABLE_FLAG_PATTERN = /^\s*[A-Z.]{1,7}\s+(\S+)/

export function parseFlagTable(output) {
  const names = []
  for (const line of output.split(/\r?\n/)) {
    if (/^\s*-{3,}/.test(line)) continue
    const match = TABLE_FLAG_PATTERN.exec(line)
    if (!match || match[1].includes('=')) continue
    names.push(match[1])
  }
  return [...new Set(names)].sort()
}

export function parseHwaccels(output) {
  const marker = output.split(/\r?\n/).findIndex((line) => /Hardware acceleration methods/i.test(line))
  if (marker < 0) return []
  return output.split(/\r?\n/).slice(marker + 1)
    .map((line) => line.trim()).filter(Boolean).sort()
}

export function parseProtocols(output) {
  const result = { input: [], output: [] }
  let destination = null
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === 'Input:') { destination = result.input; continue }
    if (line === 'Output:') { destination = result.output; continue }
    if (destination && line && !line.endsWith(':')) destination.push(line)
  }
  result.input = [...new Set(result.input)].sort()
  result.output = [...new Set(result.output)].sort()
  return result
}

function shellValue(source, name) {
  const match = new RegExp(`^readonly\\s+${name}="([^"]+)"`, 'm').exec(source)
  return match?.[1] ?? ''
}

export function parseAndroidBuildProvenance(source) {
  return {
    repository: shellValue(source, 'REPO'),
    commit: shellValue(source, 'COMMIT'),
    mpv: shellValue(source, 'MPV_VERSION'),
    ffmpeg: shellValue(source, 'FFMPEG_VERSION'),
    libplacebo: shellValue(source, 'LIBPLACEBO_VERSION'),
    libass: shellValue(source, 'LIBASS_VERSION'),
  }
}

function powershellValue(source, name) {
  const match = new RegExp(`^\\$${name}\\s*=\\s*'([^']+)'`, 'm').exec(source)
  return match?.[1] ?? ''
}

export function parseWindowsBuildProvenance(source) {
  return {
    releaseTag: powershellValue(source, 'PinnedTag'),
    asset: powershellValue(source, 'PinnedAsset'),
    expectedSha256: powershellValue(source, 'PinnedSha256'),
  }
}

function parseArgs(argv) {
  const result = { artifacts: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`)
    index += 1
    if (key === '--artifact') result.artifacts.push(value)
    else result[key.slice(2)] = value
  }
  return result
}

function run(executable, args) {
  if (!executable) return { available: false, output: '', reason: 'not-requested' }
  const command = executable === 'auto' ? args.shift() : executable
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    return { available: false, output: '', reason: result.error?.code ?? `exit-${result.status}` }
  }
  return { available: true, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(), reason: '' }
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
}

function probeMpv(executable) {
  const result = run(executable, executable === 'auto' ? ['mpv', '--version'] : ['--version'])
  return {
    available: result.available,
    version: firstLine(result.output),
    reason: result.reason,
  }
}

function ffmpegRun(executable, args) {
  return run(executable, executable === 'auto' ? ['ffmpeg', ...args] : args)
}

function probeFfmpeg(executable) {
  const version = ffmpegRun(executable, ['-hide_banner', '-version'])
  if (!version.available) return { available: false, version: '', reason: version.reason }
  const decoders = ffmpegRun(executable, ['-hide_banner', '-decoders'])
  const demuxers = ffmpegRun(executable, ['-hide_banner', '-demuxers'])
  const filters = ffmpegRun(executable, ['-hide_banner', '-filters'])
  const hwaccels = ffmpegRun(executable, ['-hide_banner', '-hwaccels'])
  const protocols = ffmpegRun(executable, ['-hide_banner', '-protocols'])
  return {
    available: true,
    version: firstLine(version.output),
    configuration: version.output.split(/\r?\n/).find((line) => line.startsWith('configuration:')) ?? '',
    decoders: parseFlagTable(decoders.output),
    demuxers: parseFlagTable(demuxers.output),
    filters: parseFlagTable(filters.output),
    hwaccels: parseHwaccels(hwaccels.output),
    protocols: parseProtocols(protocols.output),
  }
}

function probePkgConfig(enabled) {
  if (!enabled) return { available: false, versions: {} }
  const versions = {}
  for (const name of ['mpv', 'libavcodec', 'libavformat', 'libplacebo', 'libass']) {
    const result = run('pkg-config', ['--modversion', name])
    if (result.available) versions[name] = firstLine(result.output)
  }
  return { available: Object.keys(versions).length > 0, versions }
}

function artifactRecord(path) {
  const bytes = readFileSync(path)
  return {
    name: basename(path),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function media3Version(path) {
  if (!path) return ''
  return /media3Version\s*=\s*"([^"]+)"/.exec(readFileSync(path, 'utf8'))?.[1] ?? ''
}

export function buildManifest(options) {
  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  const android = options['android-script']
    ? parseAndroidBuildProvenance(readFileSync(options['android-script'], 'utf8'))
    : undefined
  if (android && options['media3-gradle']) android.media3 = media3Version(options['media3-gradle'])
  const windows = options['windows-script']
    ? parseWindowsBuildProvenance(readFileSync(options['windows-script'], 'utf8'))
    : undefined
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { name: packageJson.name, version: packageJson.version },
    build: {
      platform: options.platform ?? `${platform()}-${arch()}`,
      revision: process.env.GITHUB_SHA ?? '',
      runId: process.env.GITHUB_RUN_ID ?? '',
    },
    nativeArtifacts: options.artifacts.map(artifactRecord),
    mpv: probeMpv(options.mpv),
    ffmpeg: probeFfmpeg(options.ffmpeg),
    pkgConfig: probePkgConfig(options['pkg-config'] === 'true'),
    ...(android ? { android } : {}),
    ...(windows ? { windows } : {}),
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.output) throw new Error('--output is required')
  const manifest = buildManifest(options)
  writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`wrote ${options.output}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
