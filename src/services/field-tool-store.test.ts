import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalTool } from './field-tool-model'
const dbMock = vi.hoisted(() => ({ user: 'tech-a', row: null as any, writes: 0, uploads: 0 }))
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: dbMock.user } } }) },
  storage: { from: () => ({ upload: async () => { dbMock.uploads++; return { error: null } } }) },
  from: () => {
    let payload: any
    const chain: any = {
      select: () => chain, eq: () => chain,
      update: (value: any) => { payload = value; return chain }, insert: (value: any) => { payload = value; return chain },
      maybeSingle: async () => {
        if (!payload) return { data: dbMock.row, error: null }
        dbMock.writes++; dbMock.row = { ...payload, version: (dbMock.row?.version || 0) + 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        return { data: dbMock.row, error: null }
      },
      single: async () => chain.maybeSingle(),
    }; return chain
  },
} }))
import { localGet, localRecords, saveLocalTool, syncTools } from './field-tool-store'
const scope = { companyId: 'company-a', userId: 'tech-a' }
function record(): LocalTool {
  return { id: crypto.randomUUID(), company_id: scope.companyId, technician_id: scope.userId, kind: 'travel', status: 'draft', client_id: null, appointment_id: null, data: {}, attachments: [], version: 0, last_mutation: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('navigator', { onLine: true })
  dbMock.user = 'tech-a'; dbMock.row = null; dbMock.writes = 0; dbMock.uploads = 0
})
describe('offline queue', () => {
  it('retains blobs and scopes local storage to company AND account', async () => {
    const item = record(); item.attachments = [{ id: 'photo', path: 'path', name: 'photo.jpg', caption: 'test', blob: new Blob(['hello'], { type: 'image/jpeg' }) }]
    await saveLocalTool(scope, item, false)
    expect((await localRecords(scope)).find((r) => r.id === item.id)?.attachments[0].blob?.size).toBe(5)
    expect(await localRecords({ ...scope, userId: 'tech-b' })).toEqual([])
    expect(await localGet('missing')).toBeUndefined()
  })
  it('persists offline and syncs once without duplicate rows', async () => {
    const item = record(); await saveLocalTool(scope, item, true)
    vi.stubGlobal('navigator', { onLine: false }); await syncTools(scope); expect(dbMock.writes).toBe(0)
    vi.stubGlobal('navigator', { onLine: true }); await syncTools(scope)
    expect((await localRecords(scope)).find((r) => r.id === item.id)?.pending).toBeUndefined()
    const count = dbMock.writes; await syncTools(scope); expect(dbMock.writes).toBe(count)
  })
  it('does not sync under a different login', async () => {
    await saveLocalTool(scope, record(), true); dbMock.user = 'tech-b'
    await expect(syncTools(scope)).rejects.toThrow('mesma conta')
    expect(dbMock.writes).toBe(0)
  })
  it('preserves a pending local edit when server version conflicts', async () => {
    const item = record(); item.version = 1
    await saveLocalTool(scope, item, true); dbMock.row = { ...item, version: 3 }
    await syncTools(scope)
    const local = (await localRecords(scope)).find((r) => r.id === item.id)
    expect(local?.pending).toBe(true); expect(local?.sync_error).toContain('Conflito:')
  })
})
