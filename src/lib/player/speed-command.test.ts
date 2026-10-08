import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: vi.fn(async () => ({ unregister: vi.fn() })),
}))

// The first import of the player modules transforms a large graph; keep it out of every test's
// time budget.
beforeAll(async () => {
  await import('./android-mpv')
  await import('./native')
}, 60_000)

afterEach(() => {
  vi.resetAllMocks()
})

/** Both player wrappers share dolby.ts's module state (playback speed, push chain, backend), so
 * each test imports fresh copies. The persisted settings stores outlive the reset. */
async function fresh(mode: 'pcm' | 'hdmi') {
  vi.resetModules()
  const android = await import('./android-mpv')
  const native = await import('./native')
  const ui = await import('$lib/settings/ui')
  ui.audioOutputMode.set(mode)
  ui.audioProcessing.set('off')
  ui.videoQualityPreset.set('standard')
  ui.rawMpvOptions.set('')
  for (const codec of [
    ui.audioPassthroughAc3, ui.audioPassthroughEac3, ui.audioPassthroughTruehd,
    ui.audioPassthroughDts, ui.audioPassthroughDtsHd,
  ]) codec.set(true)
  return { android, native }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function commands() {
  return mocks.invoke.mock.calls.map(([command]) => command as string)
}

/** The speed values that reached mpv, in order. */
function speedsSent(command: 'plugin:mpv|mpv_command' | 'player_command') {
  return mocks.invoke.mock.calls.flatMap(([name, args]) => {
    if (name !== command) return []
    const list = command === 'player_command'
      ? (args as { name: string; args: string[] }).args
      : (args as { payload: { args: string[] } }).payload.args.slice(1)
    return list[0] === 'speed' ? [list[1]] : []
  })
}

/** audio-spdif of every Dolby push sent to `backend`, in order. */
function spdifPushed(backend: 'player_set_dolby_opts' | 'plugin:mpv|mpv_set_dolby_opts') {
  return mocks.invoke.mock.calls.flatMap(([name, args]) => {
    if (name !== backend) return []
    if (name === 'player_set_dolby_opts') {
      return [Object.fromEntries((args as { opts: [string, string][] }).opts)['audio-spdif']]
    }
    const opts = (args as { payload: { opts: { key: string; value: string }[] } }).payload.opts
    return [opts.find((opt) => opt.key === 'audio-spdif')?.value]
  })
}

/** A mock whose first call to `command` stays pending until the returned function runs. */
function holdFirst(command: string, failing: string[] = []) {
  let finish: (() => void) | undefined
  mocks.invoke.mockImplementation((name: string) => {
    if (failing.includes(name)) return Promise.reject(new Error(`command ${name} not found`))
    if (name === command && !finish) return new Promise((resolve) => { finish = () => resolve({ failed: [] }) })
    return Promise.resolve({ failed: [] })
  })
  return () => finish?.()
}

describe('Android hold-to-2x speed command', () => {
  it('sends the speed change straight to mpv on PCM output', async () => {
    const { android } = await fresh('pcm')
    mocks.invoke.mockResolvedValue(undefined)
    await android.mpvCommand(['set', 'speed', '2'])
    expect(mocks.invoke.mock.calls).toEqual([
      ['plugin:mpv|mpv_command', { payload: { args: ['set', 'speed', '2'] } }],
    ])
    await android.mpvCommand(['set', 'speed', '1'])
    expect(commands()).toEqual(['plugin:mpv|mpv_command', 'plugin:mpv|mpv_command'])
  })

  it('never lets a 2x still waiting on its passthrough push land after the release', async () => {
    const { android } = await fresh('hdmi')
    const finishHoldPush = holdFirst('plugin:mpv|mpv_set_dolby_opts', ['player_set_dolby_opts'])
    const press = android.mpvCommand(['set', 'speed', '2'])
    await settle()
    const release = android.mpvCommand(['set', 'speed', '1'])
    await settle()
    finishHoldPush()
    await Promise.all([press, release])
    expect(speedsSent('plugin:mpv|mpv_command')).toEqual(['1'])
    expect(spdifPushed('plugin:mpv|mpv_set_dolby_opts')).toEqual(['', 'ac3,eac3,truehd,dts-hd'])
  })

  it('turns the bitstream off before 2x and back on only after 1x', async () => {
    const { android } = await fresh('hdmi')
    mocks.invoke.mockImplementation(async (name: string) => {
      if (name === 'player_set_dolby_opts') throw new Error('command player_set_dolby_opts not found')
      return { failed: [] }
    })
    await android.mpvCommand(['set', 'speed', '2'])
    await android.mpvCommand(['set', 'speed', '1'])
    expect(commands()).toEqual([
      'player_set_dolby_opts',
      'plugin:mpv|mpv_set_dolby_opts',
      'plugin:mpv|mpv_command',
      'plugin:mpv|mpv_command',
      'plugin:mpv|mpv_set_dolby_opts',
    ])
  })
})

describe('desktop speed command', () => {
  it('sends the speed change straight to the player on PCM output', async () => {
    const { native } = await fresh('pcm')
    mocks.invoke.mockResolvedValue(undefined)
    await native.playerCommand('set', ['speed', '1.5'])
    await native.playerCommand('set', ['speed', '1'])
    expect(commands()).toEqual(['player_command', 'player_command'])
  })

  it('never lets a superseded speed land after a newer one', async () => {
    const { native } = await fresh('hdmi')
    const finishPush = holdFirst('player_set_dolby_opts')
    const faster = native.playerCommand('set', ['speed', '2'])
    await settle()
    const normal = native.playerCommand('set', ['speed', '1'])
    await settle()
    finishPush()
    await Promise.all([faster, normal])
    expect(speedsSent('player_command')).toEqual(['1'])
    expect(spdifPushed('player_set_dolby_opts')).toEqual(['', 'ac3,eac3,truehd,dts-hd'])
  })

  it('does not re-enable passthrough for a 1x that a newer speed overtook', async () => {
    const { native } = await fresh('hdmi')
    mocks.invoke.mockResolvedValue([])
    await native.playerCommand('set', ['speed', '2'])
    mocks.invoke.mockClear()
    const finishNormal = holdFirst('player_command')
    const normal = native.playerCommand('set', ['speed', '1'])
    await settle()
    const faster = native.playerCommand('set', ['speed', '1.5'])
    await settle()
    finishNormal()
    await Promise.all([normal, faster])
    expect(speedsSent('player_command')).toEqual(['1', '1.5'])
    // Still above 1x: the encoded output stays off.
    expect(spdifPushed('player_set_dolby_opts')).toEqual([])
  })
})
