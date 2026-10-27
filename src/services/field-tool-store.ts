import { supabase } from '../lib/supabase'
import type { LocalTool, ToolRecord } from './field-tool-model'

export interface ToolScope { companyId: string; userId: string }
const databaseName = 'fd-sst-field-tools-v1'
export function scopeKey(scope: ToolScope) { return `${scope.companyId}:${scope.userId}` }
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('kv')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento do aparelho. Libere espaço ou permita o armazenamento neste navegador.'))
  })
}
export async function localGet<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly'), request = tx.objectStore('kv').get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}
export async function localPut(key: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => { db.close(); window.dispatchEvent(new Event('field-tools-changed')); resolve() }
    tx.onerror = () => { db.close(); reject(new Error('Não foi possível salvar no aparelho. Verifique o espaço disponível.')) }
  })
}
const recordKey = (scope: ToolScope, id: string) => `record:${scopeKey(scope)}:${id}`
function retainLocalPhotos(server: ToolRecord, local?: LocalTool): ToolRecord {
  return { ...server, attachments: server.attachments.map((attachment) => {
    const cached = local?.attachments.find((photo) => photo.path === attachment.path)
    return cached?.blob ? { ...attachment, blob: cached.blob } : attachment
  }) }
}
export async function localRecords(scope: ToolScope): Promise<LocalTool[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly'), request = tx.objectStore('kv').openCursor()
    const rows: LocalTool[] = [], prefix = `record:${scopeKey(scope)}:`
    request.onsuccess = () => { const cursor = request.result; if (cursor) { if (String(cursor.key).startsWith(prefix)) rows.push(cursor.value); cursor.continue() } }
    tx.oncomplete = () => { db.close(); resolve(rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
export async function saveLocalTool(scope: ToolScope, record: LocalTool, queue: boolean) {
  if (record.technician_id !== scope.userId || record.company_id !== scope.companyId) throw new Error('Registro de outra conta.')
  const current = await localGet<LocalTool>(recordKey(scope, record.id))
  // Editing a queued record pauses its upload until the user explicitly saves.
  // local_revision distinguishes an unsent local draft from a synced server row.
  const next = { ...record, version: current?.version ?? record.version, pending: queue, local_revision: crypto.randomUUID(), last_mutation: crypto.randomUUID(), sync_error: undefined, updated_at: new Date().toISOString() }
  await localPut(recordKey(scope, record.id), next)
  return next
}
export async function refreshTools(scope: ToolScope) {
  if (!supabase) throw new Error('Conexão indisponível.')
  const { data, error } = await supabase.from('field_tool_records').select('*').eq('company_id', scope.companyId).eq('technician_id', scope.userId).order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  for (const record of (data ?? []) as ToolRecord[]) {
    const local = await localGet<LocalTool>(recordKey(scope, record.id))
    if (!local?.pending && !local?.local_revision) await localPut(recordKey(scope, record.id), retainLocalPhotos(record, local))
  }
  return localRecords(scope)
}
const running = new Map<string, Promise<void>>()
export function syncTools(scope: ToolScope): Promise<void> {
  const key = scopeKey(scope)
  if (running.has(key)) return running.get(key)!
  const run = async () => {
    if (!navigator.onLine || !supabase) return
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.id !== scope.userId) throw new Error('Entre novamente na mesma conta para sincronizar os registros pendentes.')
    for (const record of await localRecords(scope)) {
      if (!record.pending || record.sync_error?.startsWith('Conflito:')) continue
      try {
        const attachments = []
        for (const attachment of record.attachments) {
          if (attachment.blob) {
            const { error } = await supabase.storage.from('fd-sst-field-tools').upload(attachment.path, attachment.blob, { upsert: false, contentType: attachment.blob.type })
            if (error && error.message !== 'The resource already exists' && !error.message.includes('Duplicate')) throw error
          }
          const { blob: _blob, ...remote } = attachment
          attachments.push(remote)
        }
        const { data: existing, error: readError } = await supabase.from('field_tool_records').select('*').eq('id', record.id).maybeSingle()
        if (readError) throw readError
        let saved: ToolRecord
        if (existing?.last_mutation === record.last_mutation) saved = existing as ToolRecord
        else {
          if (existing && existing.version !== record.version) throw new Error('Conflito: este registro foi alterado em outro aparelho. Abra-o e escolha qual versão manter.')
          const payload = { id: record.id, company_id: scope.companyId, technician_id: scope.userId, kind: record.kind, status: record.status, client_id: record.client_id, appointment_id: record.appointment_id, data: record.data, attachments, last_mutation: record.last_mutation }
          const result = existing
            ? await supabase.from('field_tool_records').update(payload).eq('id', record.id).eq('version', record.version).select().maybeSingle()
            : await supabase.from('field_tool_records').insert(payload).select().single()
          if (result.error) throw result.error
          if (!result.data) throw new Error('Conflito: registro atualizado em outro aparelho. Abra-o para revisar.')
          saved = result.data as ToolRecord
        }
        const current = await localGet<LocalTool>(recordKey(scope, record.id))
        if (current?.local_revision === record.local_revision) await localPut(recordKey(scope, record.id), retainLocalPhotos(saved, current))
        else if (current) await localPut(recordKey(scope, record.id), { ...current, version: saved.version })
      } catch (error) {
        const current = await localGet<LocalTool>(recordKey(scope, record.id))
        if (current?.local_revision === record.local_revision) await localPut(recordKey(scope, record.id), { ...current, sync_error: error instanceof Error ? error.message : String((error as { message?: string }).message || 'Não foi possível sincronizar.') })
      }
    }
  }
  const promise: Promise<void> = (async () => { if (navigator.locks) await navigator.locks.request(`field-sync:${key}`, async () => { await run() }); else await run() })().finally(() => running.delete(key))
  running.set(key, promise)
  return promise
}
export async function resolveToolConflict(scope: ToolScope, record: LocalTool, keepLocal: boolean) {
  if (!supabase) throw new Error('Conexão indisponível.')
  const { data, error } = await supabase.from('field_tool_records').select('*').eq('id', record.id).single()
  if (error) throw error
  await localPut(recordKey(scope, record.id), keepLocal ? { ...record, version: data.version, last_mutation: crypto.randomUUID(), local_revision: crypto.randomUUID(), pending: true, sync_error: undefined } : data)
}
