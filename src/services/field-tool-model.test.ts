import { describe, expect, it } from 'vitest'
import { calculateHeat, numberValue, travelDistance, validateTool } from './field-tool-model'

describe('field tool calculations and submission validation', () => {
  it('never treats blank input as zero', () => {
    expect(numberValue('')).toBeNull(); expect(numberValue(' ')).toBeNull()
    expect(calculateHeat({ tbn: '', tg: '' })).toBeNull()
    expect(travelDistance({ distance_km: '' })).toBeNull()
  })
  it('supports zero and the two heat formulas', () => {
    expect(calculateHeat({ tbn: 20, tg: 30 })).toBe(23)
    expect(calculateHeat({ tbn: 20, tg: 30, tbs: 25, solar_exposure: true })).toBe(22.5)
    expect(calculateHeat({ tbn: 0, tg: 0 })).toBe(0)
    expect(calculateHeat({ tbn: 20, tg: 30, solar_exposure: true })).toBeNull()
  })
  it('prefers both odometers and rejects inverted / partial pairs', () => {
    expect(travelDistance({ odometer_start: 100, odometer_end: 112.5, distance_km: 99 })).toBe(12.5)
    expect(validateTool({ kind: 'travel', status: 'draft', client_id: null, data: { odometer_start: 100, odometer_end: 99 } })).not.toEqual([])
    expect(validateTool({ kind: 'travel', status: 'draft', client_id: null, data: { odometer_start: 0 } })).not.toEqual([])
  })
  it('permits incomplete drafts but not incomplete publication', () => {
    for (const kind of ['travel', 'heat', 'accident', 'training'] as const) {
      expect(validateTool({ kind, status: 'draft', client_id: null, data: {} })).toEqual([])
      expect(validateTool({ kind, status: 'submitted', client_id: null, data: {} }).length).toBeGreaterThan(0)
    }
  })
  it('rejects reversed times and excessive training workload', () => {
    expect(validateTool({ kind: 'travel', status: 'draft', client_id: null, data: { departed_at: '2026-10-27T12:00:00Z', arrived_at: '2026-10-27T11:00:00Z' } }).length).toBeGreaterThan(0)
    expect(validateTool({ kind: 'training', status: 'draft', client_id: null, data: { starts_at: '2026-10-27T12:00:00Z', ends_at: '2026-10-27T13:00:00Z', workload_minutes: 120 } }).length).toBeGreaterThan(0)
  })
})
