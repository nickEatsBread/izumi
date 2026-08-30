import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const load = async (name) => JSON.parse(await readFile(new URL(`../messages/${name}.json`, import.meta.url), 'utf8'))
const [english, japanese] = await Promise.all([load('en'), load('ja')])
const messageKeys = (value) => Object.keys(value).filter((key) => key !== '$schema').sort()
const enKeys = messageKeys(english)
const jaKeys = messageKeys(japanese)
const missingJa = enKeys.filter((key) => !jaKeys.includes(key))
const missingEn = jaKeys.filter((key) => !enKeys.includes(key))

async function sourceFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'paraglide') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await sourceFiles(path))
    else if (['.ts', '.svelte'].includes(extname(entry.name))) output.push(path)
  }
  return output
}

const unknown = new Map()
for (const file of await sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
  const source = await readFile(file, 'utf8')
  if (!source.includes("$lib/paraglide/messages")) continue
  for (const match of source.matchAll(/\bm\.([a-zA-Z0-9_]+)\s*\(/g)) {
    if (!enKeys.includes(match[1])) unknown.set(match[1], file)
  }
}

if (missingJa.length || missingEn.length || unknown.size) {
  if (missingJa.length) console.error(`Missing Japanese messages: ${missingJa.join(', ')}`)
  if (missingEn.length) console.error(`Missing English messages: ${missingEn.join(', ')}`)
  for (const [key, file] of unknown) console.error(`Unknown message ${key} referenced by ${file}`)
  process.exitCode = 1
} else {
  console.log(`i18n OK: ${enKeys.length} English/Japanese messages with valid call sites`)
}
