import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateHomeTheatreReport } from './home-theatre-report.mjs'

const template = JSON.parse(readFileSync('scripts/ci/home-theatre-report.template.json', 'utf8'))

describe('physical home-theatre report', () => {
  it('keeps every required topology and regression case in the template', () => {
    expect(validateHomeTheatreReport(template, { allowNotRun: true })).toEqual([])
  })

  it('cannot turn a physical result green without observable evidence', () => {
    const report = structuredClone(template)
    report.topologies[0].results[0] = { caseId: 'ac3-5.1', status: 'pass', evidence: {} }
    expect(validateHomeTheatreReport(report, { allowNotRun: true }).join('\n'))
      .toContain('sinkObservation evidence is required')
  })
})
