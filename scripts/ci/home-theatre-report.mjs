#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_TOPOLOGIES = [
  'desktop-avr-tv',
  'desktop-tv-earc-avr',
  'android-tv-earc-avr',
]

export const REQUIRED_CASES = [
  'ac3-5.1', 'eac3-joc-atmos', 'truehd-atmos',
  'dts-core', 'dts-hd-ma', 'dts-x-hd-ma', 'dts-uhd',
  'hdr10', 'hdr10-plus', 'hlg',
  'dv-profile-5', 'dv-profile-7-mel', 'dv-profile-7-fel', 'dv-profile-8.1', 'dv-profile-8.4',
  'hevc-main10-level-5.1', 'av1-main10', 'vp9-profile-2',
  'audio-filter-pcm-fallback', 'speed-pcm-fallback', 'route-change-refresh',
]

const STATUSES = new Set(['pass', 'fail', 'blocked', 'not-run'])

export function validateHomeTheatreReport(report, { allowNotRun = false } = {}) {
  const errors = []
  if (report?.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  for (const field of ['appCommit', 'tester', 'fixtures']) {
    if (!report?.[field] || typeof report[field] !== (field === 'fixtures' ? 'object' : 'string')) {
      errors.push(`${field} is required`)
    }
  }
  const topologies = Array.isArray(report?.topologies) ? report.topologies : []
  for (const id of REQUIRED_TOPOLOGIES) {
    const topology = topologies.find((entry) => entry?.id === id)
    if (!topology) {
      errors.push(`missing topology ${id}`)
      continue
    }
    for (const field of ['source', 'display', 'audioSink', 'connection']) {
      if (typeof topology[field] !== 'string' || !topology[field].trim()) {
        errors.push(`${id}.${field} is required`)
      }
    }
    const results = Array.isArray(topology.results) ? topology.results : []
    for (const caseId of REQUIRED_CASES) {
      const matches = results.filter((entry) => entry?.caseId === caseId)
      if (matches.length !== 1) {
        errors.push(`${id} must contain exactly one ${caseId} result`)
        continue
      }
      const result = matches[0]
      if (!STATUSES.has(result.status)) errors.push(`${id}/${caseId} has invalid status`)
      if (!allowNotRun && result.status === 'not-run') errors.push(`${id}/${caseId} was not run`)
      if (result.status === 'pass' || result.status === 'fail') {
        for (const field of ['clientDiagnostics', 'sinkObservation', 'notes']) {
          if (typeof result.evidence?.[field] !== 'string' || !result.evidence[field].trim()) {
            errors.push(`${id}/${caseId} ${field} evidence is required for ${result.status}`)
          }
        }
      }
      if (result.status === 'blocked' && !String(result.reason ?? '').trim()) {
        errors.push(`${id}/${caseId} needs a blocked reason`)
      }
    }
  }
  return errors
}

function main() {
  const args = process.argv.slice(2)
  const path = args.find((arg) => !arg.startsWith('--'))
  if (!path) {
    console.error('usage: node home-theatre-report.mjs <report.json> [--allow-not-run]')
    process.exitCode = 2
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`cannot read report: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 2
    return
  }
  const errors = validateHomeTheatreReport(report, { allowNotRun: args.includes('--allow-not-run') })
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  const counts = { pass: 0, fail: 0, blocked: 0, 'not-run': 0 }
  for (const topology of report.topologies) {
    for (const result of topology.results) counts[result.status]++
  }
  console.log(`home-theatre report valid: ${JSON.stringify(counts)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
