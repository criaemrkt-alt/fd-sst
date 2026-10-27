import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, CarFront, GraduationCap, RefreshCw, ThermometerSun } from 'lucide-react'
import { useAuth } from '../providers/auth-provider'
import { supabase } from '../lib/supabase'
import type { Appointment, Client, Membership } from '../types/domain'
import { listAppointments, listClients } from '../services/fd-sst'
import { calculateHeat, localDateTime, recordTitle, toolFields, toolLabels, travelDistance, validateTool, type FieldDefinition, type LocalTool, type ToolAttachment, type ToolData, type ToolKind } from '../services/field-tool-model'
import { localGet, localPut, localRecords, refreshTools, resolveToolConflict, saveLocalTool, scopeKey, syncTools, type ToolScope } from '../services/field-tool-store'
import { Button, EmptyState, Modal, Notice } from './ui'

const kinds: ToolKind[] = ['travel', 'heat', 'accident', 'training']
const icons = { travel: CarFront, heat: ThermometerSun, accident: AlertTriangle, training: GraduationCap }
const message = (error: unknown) => error instanceof Error ? error.message : String((error as { message?: string })?.message || 'Falha inesperada. Tente novamente.')
interface ReferenceData { clients: Client[]; appointments: Appointment[] }

export function TechnicianToolsPage({ membership }: { membership: Membership }) {
  const { user } = useAuth()
  const scope = useMemo(() => ({ companyId: membership.company_id, userId: user!.id }), [membership.company_id, user?.id])
  const [records, setRecords] = useState<LocalTool[]>([])
  const [references, setReferences] = useState<ReferenceData>({ clients: [], appointments: [] })
  const [editor, setEditor] = useState<LocalTool | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine)
  const loadLocal = useCallback(async () => setRecords(await localRecords(scope)), [scope])
  const synchronize = useCallback(async () => {
    setBusy(true); setError('')
    try {
      await loadLocal()
      if (navigator.onLine) {
        await syncTools(scope); await refreshTools(scope)
        const [clients, appointments] = await Promise.all([listClients(scope.companyId), listAppointments(scope.companyId, scope.userId)])
        const refs = { clients, appointments }
        await localPut(`refs:${scopeKey(scope)}`, refs); setReferences(refs)
      }
      await loadLocal()
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }, [scope, loadLocal])
  useEffect(() => {
    setRecords([]); setReferences({ clients: [], appointments: [] }); setEditor(null)
    void localGet<ReferenceData>(`refs:${scopeKey(scope)}`).then((data) => { if (data) setReferences(data) }).catch((err) => setError(message(err)))
    void synchronize()
    const changed = () => void loadLocal().catch((err) => setError(message(err)))
    const connectivity = () => { setOnline(navigator.onLine); if (navigator.onLine) void synchronize() }
    window.addEventListener('field-tools-changed', changed); window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity)
    return () => { window.removeEventListener('field-tools-changed', changed); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity) }
  }, [scope, loadLocal, synchronize])
  const create = (kind: ToolKind) => {
    const now = new Date().toISOString()
    setEditor({ id: crypto.randomUUID(), company_id: scope.companyId, technician_id: scope.userId, kind, status: 'draft', client_id: null, appointment_id: null, data: kind === 'heat' ? { measured_at: now, solar_exposure: false } : kind === 'accident' ? { occurred_at: now, investigation_status: 'Aberta' } : kind === 'training' ? { starts_at: now } : {}, attachments: [], version: 0, last_mutation: crypto.randomUUID(), created_at: now, updated_at: now })
  }
  return <section className="tech-page field-workspace">
    <header className="tech-title-row"><div><h1>Ferramentas de campo</h1><p>Registre, acompanhe e envie os dados ao ADM.</p></div></header>
    <div className="field-sync-strip"><span>{online ? 'Conectado' : 'Sem internet — modo local'} · {records.filter((r) => r.pending).length} pendente(s)</span><Button className="button-secondary" disabled={busy || !online} onClick={() => void synchronize()}><RefreshCw size={16} />{busy ? 'Sincronizando…' : 'Sincronizar'}</Button></div>
    {!online && <Notice kind="info">Você pode criar e editar os registros. Eles ficam neste aparelho e serão sincronizados ao reconectar com a mesma conta. Não limpe os dados do navegador antes da sincronização.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <div className="field-tool-grid">{kinds.map((kind) => { const Icon = icons[kind]; return <button key={kind} className="field-tool-card" onClick={() => create(kind)}><Icon /><strong>{toolLabels[kind]}</strong><small>Novo registro</small></button> })}</div>
    <ToolHistory records={records} clients={references.clients} onOpen={setEditor} />
    {editor && <ToolEditor key={editor.id} scope={scope} initial={editor} references={references} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); setNotice(navigator.onLine ? 'Registro salvo no aparelho. Conferindo sincronização com o servidor.' : 'Registro salvo no aparelho e aguardando conexão.'); await synchronize() }} />}
  </section>
}

export function AdminFieldToolsPage({ companyId }: { companyId: string }) {
  const [records, setRecords] = useState<LocalTool[]>([]), [clients, setClients] = useState<Client[]>([])
  const [selected, setSelected] = useState<LocalTool | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const result = await supabase!.from('field_tool_records').select('*').eq('company_id', companyId).eq('status', 'submitted').order('updated_at', { ascending: false })
      if (result.error) throw result.error
      const ids = [...new Set((result.data ?? []).map((r) => r.technician_id))]
      const [clientData, profiles] = await Promise.all([listClients(companyId), ids.length ? supabase!.from('profiles').select('id,full_name').in('id', ids) : Promise.resolve({ data: [], error: null })])
      if (profiles.error) throw profiles.error
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]))
      setRecords((result.data ?? []).map((r) => ({ ...r, data: { ...r.data, technician_name: names.get(r.technician_id) || 'Técnico' } })) as LocalTool[]); setClients(clientData)
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }, [companyId])
  useEffect(() => { setRecords([]); setClients([]); setSelected(null); void load() }, [load])
  return <section className="page field-workspace"><header className="page-heading"><div><h1>Registros de campo</h1><p>Ferramentas finalizadas e enviadas pelos técnicos. Rascunhos não aparecem aqui.</p></div><Button className="button-secondary" disabled={busy} onClick={() => void load()}>Atualizar</Button></header>{error && <Notice kind="error">{error}</Notice>}{busy && <p>Carregando registros…</p>}<ToolHistory records={records} clients={clients} onOpen={setSelected} />{selected && <Modal title={toolLabels[selected.kind]} onClose={() => setSelected(null)}><RecordDetails record={selected} clients={clients} /></Modal>}</section>
}

function ToolHistory({ records, clients, onOpen }: { records: LocalTool[]; clients: Client[]; onOpen: (record: LocalTool) => void }) {
  const [filter, setFilter] = useState(''), [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const filtered = records.filter((r) => {
    const date = localDateTime(r.data.measured_at as string || r.data.occurred_at as string || r.data.starts_at as string || r.data.departed_at as string || r.created_at).slice(0, 10)
    return (!filter || r.kind === filter) && (!from || date >= from) && (!to || date <= to) && `${recordTitle(r)} ${clients.find((c) => c.id === r.client_id)?.name || ''} ${r.data.technician_name || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))
  })
  return <section className="card"><div className="section-title"><h2>Histórico de registros</h2><span>{filtered.length}</span></div><div className="tool-filters"><label>Tipo<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Todos</option>{kinds.map((kind) => <option value={kind} key={kind}>{toolLabels[kind]}</option>)}</select></label><label>Pesquisar<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, registro ou técnico" /></label><label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>{!filtered.length ? <EmptyState title="Nenhum registro">Crie um registro ou ajuste os filtros.</EmptyState> : <div className="field-history">{filtered.map((record) => <button key={record.id} className="tool-history-row" onClick={() => onOpen(record)}><span><small>{toolLabels[record.kind]}</small><strong>{recordTitle(record)}</strong><small>{clients.find((c) => c.id === record.client_id)?.name || 'Sem cliente vinculado'}{record.data.technician_name ? ` · ${record.data.technician_name}` : ''}</small><small>{new Date(record.updated_at).toLocaleString('pt-BR')}</small></span><span className={`tool-state ${record.sync_error ? 'failed' : record.pending ? 'pending' : ''}`}>{record.sync_error ? 'Requer atenção' : record.pending ? 'Pendente de sincronização' : record.local_revision ? 'Rascunho no aparelho' : record.status === 'draft' ? 'Rascunho sincronizado' : 'Enviado ao ADM'}</span></button>)}</div>}</section>
}

function ToolEditor({ initial, scope, references, onClose, onSaved }: { initial: LocalTool; scope: ToolScope; references: ReferenceData; onClose: () => void; onSaved: () => Promise<void> }) {
  const [record, setRecord] = useState<LocalTool>(() => ({ ...initial, data: { ...initial.data }, attachments: [...initial.attachments] }))
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [autoSaved, setAutoSaved] = useState(false)
  const writeChain = useRef<Promise<unknown>>(Promise.resolve())
  const write = (next: LocalTool, queue: boolean) => { const promise = writeChain.current.catch(() => undefined).then(() => saveLocalTool(scope, next, queue)); writeChain.current = promise; return promise }
  useEffect(() => {
    if (!dirty || busy) return
    const timer = window.setTimeout(() => { void write({ ...record, status: 'draft' }, false).then(() => setAutoSaved(true)).catch((err) => setError(message(err))) }, 650)
    return () => clearTimeout(timer)
  }, [record, dirty, busy])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const change = (key: string, value: ToolData[string]) => { setRecord((current) => ({ ...current, data: { ...current.data, [key]: value } })); setDirty(true); setAutoSaved(false) }
  const close = async () => { if (busy) return; try { if (dirty) await write({ ...record, status: 'draft' }, false); onClose() } catch (err) { setError(message(err)) } }
  const save = async (status: LocalTool['status']) => {
    setError(''); const next = { ...record, status }; const errors = validateTool(next)
    if (errors.length) { setError(errors.join('\n')); return }
    setBusy(true)
    try { await write(next, true); setDirty(false); await onSaved() } catch (err) { setError(message(err)); setBusy(false) }
  }
  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const attachments = [...record.attachments]
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Use JPG, PNG ou WebP com até 10 MB por foto.'); return }
      if (attachments.length >= 20) { setError('Máximo de 20 fotos por registro.'); return }
      const id = crypto.randomUUID(); attachments.push({ id, name: file.name, caption: '', path: `${scope.companyId}/${scope.userId}/${record.id}/${id}`, blob: file })
    }
    setRecord({ ...record, attachments }); setDirty(true); setAutoSaved(false)
  }
  const conflict = initial.sync_error?.startsWith('Conflito:')
  return <Modal title={toolLabels[record.kind]} onClose={() => void close()}><div className="tool-editor">
    <Notice kind="info">Salvar rascunho mantém o registro privado. “Finalizar e enviar ao ADM” disponibiliza o registro após a sincronização.</Notice>
    {initial.status === 'submitted' && <Notice kind="info">O ADM mantém acesso à última versão enviada até você salvar uma nova versão.</Notice>}
    {initial.sync_error && <Notice kind="error">{initial.sync_error}</Notice>}
    {conflict && <div className="record-actions"><Button disabled={!navigator.onLine} onClick={async () => { try { await resolveToolConflict(scope, initial, false); onClose() } catch (err) { setError(message(err)) } }}>Usar versão do servidor</Button><Button disabled={!navigator.onLine} className="button-secondary" onClick={async () => { try { await resolveToolConflict(scope, record, true); await onSaved() } catch (err) { setError(message(err)) } }}>Confirmar e manter minha versão</Button></div>}
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save('submitted') }} noValidate>
      <label>Cliente{record.kind !== 'travel' && ' *'}<select value={record.client_id || ''} onChange={(e) => { setRecord({ ...record, client_id: e.target.value || null, appointment_id: null }); setDirty(true) }}><option value="">Selecione</option>{references.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label>Atendimento vinculado (opcional)<select value={record.appointment_id || ''} onChange={(e) => { const appointment = references.appointments.find((a) => a.id === e.target.value); setRecord({ ...record, appointment_id: appointment?.id || null, client_id: appointment?.client_id || record.client_id }); setDirty(true) }}><option value="">Sem vínculo</option>{references.appointments.filter((a) => !record.client_id || a.client_id === record.client_id).map((a) => <option key={a.id} value={a.id}>{a.clients?.name} · {new Date(a.starts_at).toLocaleDateString('pt-BR')}</option>)}</select></label>
      {!references.clients.length && <Notice kind="info">Abra esta tela conectado ao menos uma vez para carregar os clientes e atendimentos no aparelho.</Notice>}
      {record.kind === 'travel' && <div className="record-actions full"><Button type="button" onClick={() => change('departed_at', new Date().toISOString())}>Marcar saída agora</Button><Button type="button" className="button-secondary" onClick={() => change('arrived_at', new Date().toISOString())}>Marcar chegada agora</Button></div>}
      {toolFields[record.kind].filter((field) => field.key !== 'tbs' || record.data.solar_exposure).map((field) => <ToolField key={field.key} field={field} value={record.data[field.key]} onChange={(value) => change(field.key, value)} />)}
      {record.kind === 'travel' && <div className="calculation-result full"><strong>Distância: {travelDistance(record.data) ?? '—'} km</strong><small>Calculada pelos hodômetros, quando ambos estão preenchidos. Caso contrário, usa a distância manual.</small></div>}
      {record.kind === 'heat' && <><div className="calculation-result full"><strong>IBUTG: {calculateHeat(record.data) ?? '—'} °C</strong><small>{record.data.solar_exposure ? '0,7 tbn + 0,2 tg + 0,1 tbs' : '0,7 tbn + 0,3 tg'}</small></div><div className="full"><Notice kind="info">Registro preliminar de medição, não um laudo ou conclusão de exposição. A análise requer avaliação técnica das condições, da amostragem e das referências aplicáveis. O celular não mede a temperatura.</Notice></div></>}
      {record.kind === 'accident' && <div className="full"><Notice kind="info">Este registro organiza a investigação. Não transmite CAT ou comunicações oficiais.</Notice></div>}
      {record.kind === 'training' && <div className="full"><Notice kind="info">Registro de treinamento e presença informada. Não emite certificado nem valida automaticamente requisitos legais.</Notice></div>}
      <section className="full tool-photos"><h3>Fotos e evidências (opcional)</h3><label className="button button-secondary"><Camera size={17} /> Adicionar fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void addPhotos(e.target.files)} /></label>{record.attachments.map((photo) => <div key={photo.id} className="tool-photo"><AttachmentPreview attachment={photo} /><label>Observação da foto<input value={photo.caption} onChange={(e) => { setRecord({ ...record, attachments: record.attachments.map((a) => a.id === photo.id ? { ...a, caption: e.target.value } : a) }); setDirty(true) }} /></label><Button type="button" className="button-secondary" onClick={() => { setRecord({ ...record, attachments: record.attachments.filter((a) => a.id !== photo.id) }); setDirty(true) }}>Remover desta versão</Button></div>)}</section>
      {error && <div className="full tool-error"><Notice kind="error">{error}</Notice></div>}
      <small className="full" role="status">{autoSaved ? 'Rascunho atualizado no aparelho.' : dirty ? 'Alterações em edição…' : 'Preencha o registro. Campos com * são necessários para enviar.'}</small>
      <footer className="form-actions"><Button type="button" className="button-secondary" disabled={busy || !!conflict} onClick={() => void save('draft')}>Salvar rascunho</Button><Button disabled={busy || !!conflict}>{busy ? 'Salvando…' : 'Finalizar e enviar ao ADM'}</Button></footer>
    </form></div></Modal>
}

function ToolField({ field, value, onChange }: { field: FieldDefinition; value: ToolData[string] | undefined; onChange: (value: ToolData[string]) => void }) {
  const label = `${field.label}${field.required ? ' *' : ''}`
  const dateValue = value && field.type === 'datetime-local' ? localDateTime(String(value)) : String(value ?? '')
  return <label className={field.type === 'textarea' || field.type === 'checkbox' ? 'full' : ''}>{field.type === 'checkbox' ? <span className="check-line"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{label}</span> : <>{label}{field.type === 'textarea' ? <textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /> : field.type === 'select' ? <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="">Selecione</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type || 'text'} min={field.min} max={field.max} step={field.type === 'number' ? 'any' : undefined} value={dateValue} onChange={(e) => onChange(field.type === 'datetime-local' ? e.target.value ? new Date(e.target.value).toISOString() : '' : e.target.value)} />}{field.help && <small>{field.help}</small>}</>}</label>
}

function AttachmentPreview({ attachment }: { attachment: ToolAttachment }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true; const local = attachment.blob ? URL.createObjectURL(attachment.blob) : ''
    setUrl(local)
    if (!local && navigator.onLine) void supabase!.storage.from('fd-sst-field-tools').createSignedUrl(attachment.path, 300).then(({ data }) => { if (active && data) setUrl(data.signedUrl) })
    return () => { active = false; if (local) URL.revokeObjectURL(local) }
  }, [attachment.path, attachment.blob])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.caption || attachment.name} /></a> : <small>Foto: {attachment.name}. Conecte-se para visualizar a foto sincronizada.</small>
}

function RecordDetails({ record, clients }: { record: LocalTool; clients: Client[] }) {
  return <div className="tool-details"><h3>{recordTitle(record)}</h3><p><b>Técnico:</b> {record.data.technician_name || 'Não informado'}</p><p><b>Cliente:</b> {clients.find((c) => c.id === record.client_id)?.name || 'Sem vínculo'}</p><p>Atualizado em {new Date(record.updated_at).toLocaleString('pt-BR')}</p>{toolFields[record.kind].map((field) => { const value = record.data[field.key]; if (value === null || value === undefined || value === '') return null; return <p key={field.key}><b>{field.label}:</b> {field.type === 'checkbox' ? value ? 'Sim' : 'Não' : field.type === 'datetime-local' ? new Date(String(value)).toLocaleString('pt-BR') : String(value)}</p> })}{record.attachments.map((photo) => <figure key={photo.id}><AttachmentPreview attachment={photo} /><figcaption>{photo.caption}</figcaption></figure>)}</div>
}
