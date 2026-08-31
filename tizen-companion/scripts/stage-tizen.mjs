import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = resolve(project, '..')
const output = resolve(project, 'dist')

await mkdir(output, { recursive: true })
await Promise.all([
  copyFile(resolve(project, 'config.xml'), resolve(output, 'config.xml')),
  copyFile(resolve(repository, 'brand/png/izumi-app-icon-512.png'), resolve(output, 'icon.png')),
])
