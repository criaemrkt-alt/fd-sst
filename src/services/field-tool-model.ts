export type ToolKind = 'travel' | 'heat' | 'accident' | 'training'
export type ToolData = Record<string, string | number | boolean | null>
export interface ToolAttachment { id: string; name: string; path: string; caption: string; blob?: Blob }
export interface ToolRecord {
  id: string; company_id: string; technician_id: string; kind: ToolKind
  status: 'draft' | 'submitted'; client_id: string | null; appointment_id: string | null
  data: ToolData; attachments: ToolAttachment[]; version: number; last_mutation: string
  created_at: string; updated_at: string
}
export interface LocalTool extends ToolRecord { pending?: boolean; sync_error?: string; local_revision?: string }
export interface FieldDefinition {
  key: string; label: string; type?: 'textarea' | 'number' | 'datetime-local' | 'date' | 'checkbox' | 'select'
  options?: string[]; required?: boolean; min?: number; max?: number; help?: string
}
export const toolLabels: Record<ToolKind, string> = { travel: 'Deslocamento e KM', heat: 'Calor (IBUTG)', accident: 'Investigação de acidente', training: 'Treinamentos' }
export const toolFields: Record<ToolKind, FieldDefinition[]> = {
  travel: [
    { key: 'origin', label: 'Origem', required: true }, { key: 'destination', label: 'Destino', required: true },
    { key: 'vehicle', label: 'Veículo / identificação' },
    { key: 'departed_at', label: 'Saída', type: 'datetime-local', required: true },
    { key: 'arrived_at', label: 'Chegada', type: 'datetime-local', required: true },
    { key: 'odometer_start', label: 'Hodômetro inicial (km)', type: 'number', min: 0 },
    { key: 'odometer_end', label: 'Hodômetro final (km)', type: 'number', min: 0 },
    { key: 'distance_km', label: 'Distância manual (km)', type: 'number', min: 0, help: 'Use a distância manual ou preencha os dois hodômetros. Não há rastreamento GPS.' },
    { key: 'toll', label: 'Pedágio (R$)', type: 'number', min: 0 }, { key: 'parking', label: 'Estacionamento (R$)', type: 'number', min: 0 },
    { key: 'notes', label: 'Observações', type: 'textarea' },
  ],
  heat: [
    { key: 'measured_at', label: 'Data e hora da medição', type: 'datetime-local', required: true },
    { key: 'location_text', label: 'Setor / local', required: true }, { key: 'activity_description', label: 'Atividade / posto', type: 'textarea', required: true },
    { key: 'instrument', label: 'Equipamento / modelo / número de série', required: true },
    { key: 'calibration_date', label: 'Data da calibração', type: 'date' }, { key: 'calibration_reference', label: 'Certificado de calibração' },
    { key: 'tbn', label: 'Bulbo úmido natural — tbn (°C)', type: 'number', min: -50, max: 150, required: true },
    { key: 'tg', label: 'Temperatura de globo — tg (°C)', type: 'number', min: -50, max: 150, required: true },
    { key: 'solar_exposure', label: 'Com carga solar direta', type: 'checkbox' },
    { key: 'tbs', label: 'Bulbo seco — tbs (°C)', type: 'number', min: -50, max: 150 },
    { key: 'duration_minutes', label: 'Duração da amostragem (min)', type: 'number', min: 1 },
    { key: 'metabolic_rate', label: 'Taxa metabólica informada (W)', type: 'number', min: 1 },
    { key: 'metabolic_reference', label: 'Referência da taxa metabólica' },
    { key: 'acclimatization', label: 'Aclimatização', type: 'select', options: ['Não avaliada', 'Aclimatizado', 'Não aclimatizado'] },
    { key: 'clothing', label: 'Vestimenta / EPI e condições observadas', type: 'textarea' },
    { key: 'notes', label: 'Observações e limitações da medição', type: 'textarea' },
  ],
  accident: [
    { key: 'occurred_at', label: 'Data e hora da ocorrência', type: 'datetime-local', required: true },
    { key: 'location_text', label: 'Local / setor', required: true }, { key: 'worker_name', label: 'Colaborador', required: true },
    { key: 'worker_role', label: 'Função' },
    { key: 'occurrence_type', label: 'Tipo de ocorrência', type: 'select', options: ['Acidente', 'Incidente / quase acidente', 'Outro'], required: true },
    { key: 'description', label: 'Descrição da ocorrência', type: 'textarea', required: true },
    { key: 'injuries', label: 'Lesões / partes do corpo atingidas', type: 'textarea' },
    { key: 'medical_care', label: 'Socorro e atendimento recebido', type: 'textarea' },
    { key: 'witnesses', label: 'Testemunhas (uma por linha)', type: 'textarea' },
    { key: 'circumstances', label: 'Circunstâncias / atividade executada', type: 'textarea' },
    { key: 'possible_causes', label: 'Possíveis causas a investigar', type: 'textarea' },
    { key: 'immediate_measures', label: 'Medidas imediatas', type: 'textarea' },
    { key: 'recommendations', label: 'Plano de ação / recomendações', type: 'textarea', required: true },
    { key: 'action_owner', label: 'Responsável pelo acompanhamento', required: true },
    { key: 'action_deadline', label: 'Prazo de acompanhamento', type: 'date' },
    { key: 'investigation_status', label: 'Situação da investigação', type: 'select', options: ['Aberta', 'Em investigação', 'Ações em execução', 'Encerrada'] },
    { key: 'action_evidence', label: 'Acompanhamento e evidências das ações', type: 'textarea' },
  ],
  training: [
    { key: 'name', label: 'Nome do treinamento', required: true }, { key: 'standard', label: 'NR / referência aplicável' },
    { key: 'starts_at', label: 'Início', type: 'datetime-local', required: true }, { key: 'ends_at', label: 'Fim', type: 'datetime-local', required: true },
    { key: 'location_text', label: 'Local', required: true },
    { key: 'workload_minutes', label: 'Carga horária efetiva (min)', type: 'number', min: 1, required: true },
    { key: 'instructor_name', label: 'Instrutor', required: true }, { key: 'instructor_qualification', label: 'Qualificação / registro do instrutor' },
    { key: 'syllabus', label: 'Conteúdo programático', type: 'textarea', required: true },
    { key: 'participants', label: 'Participantes (um nome por linha)', type: 'textarea', required: true },
    { key: 'attendance', label: 'Presença e avaliação (nome e resultado por linha)', type: 'textarea' },
    { key: 'notes', label: 'Observações', type: 'textarea' },
  ],
}
export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
export function calculateHeat(data: ToolData): number | null {
  const tbn = numberValue(data.tbn), tg = numberValue(data.tg), tbs = numberValue(data.tbs)
  if (tbn === null || tg === null || (data.solar_exposure && tbs === null)) return null
  return Math.round((data.solar_exposure ? .7 * tbn + .2 * tg + .1 * tbs! : .7 * tbn + .3 * tg) * 100) / 100
}
export function travelDistance(data: ToolData): number | null {
  const start = numberValue(data.odometer_start), end = numberValue(data.odometer_end)
  return start !== null && end !== null ? Math.round((end - start) * 100) / 100 : numberValue(data.distance_km)
}
export function validateTool(record: Pick<ToolRecord, 'kind' | 'data' | 'client_id' | 'status'>): string[] {
  const { kind, data, status } = record
  const errors: string[] = []
  if (status === 'submitted' && kind !== 'travel' && !record.client_id) errors.push('Selecione o cliente.')
  for (const field of toolFields[kind]) {
    const value = data[field.key]
    const empty = value === null || value === undefined || String(value).trim() === ''
    if (status === 'submitted' && field.required && empty) errors.push(`Preencha: ${field.label}.`)
    if (empty) continue
    if (String(value).length > 15000) errors.push(`${field.label}: máximo de 15.000 caracteres.`)
    if (field.type === 'number') {
      const number = numberValue(value)
      if (number === null || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) errors.push(`Valor inválido: ${field.label}.`)
    }
    if ((field.type === 'datetime-local' || field.type === 'date') && !Number.isFinite(new Date(String(value)).getTime())) errors.push(`Data inválida: ${field.label}.`)
  }
  if (kind === 'travel') {
    const distance = travelDistance(data)
    if ((distance !== null && distance < 0) || (status === 'submitted' && distance === null)) errors.push('Informe uma distância válida ou os dois hodômetros.')
    if (!!String(data.odometer_start ?? '').trim() !== !!String(data.odometer_end ?? '').trim()) errors.push('Preencha os dois hodômetros ou deixe ambos vazios.')
  }
  if (kind === 'heat' && status === 'submitted' && calculateHeat(data) === null) errors.push('Preencha as temperaturas necessárias, incluindo bulbo seco com carga solar.')
  const [start, end] = kind === 'travel' ? [data.departed_at, data.arrived_at] : kind === 'training' ? [data.starts_at, data.ends_at] : []
  if (start && end && new Date(String(end)).getTime() < new Date(String(start)).getTime()) errors.push('O fim não pode ser anterior ao início.')
  if (kind === 'training' && start && end && numberValue(data.workload_minutes)! > (new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 60000) errors.push('A carga horária não pode ultrapassar o intervalo de início e fim.')
  return errors
}
export function localDateTime(value = new Date().toISOString()) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export function recordTitle(record: ToolRecord) {
  if (record.kind === 'travel') return `${travelDistance(record.data) ?? '—'} km · ${record.data.destination || 'Deslocamento'}`
  if (record.kind === 'heat') return `IBUTG ${calculateHeat(record.data) ?? '—'} °C · ${record.data.location_text || 'Medição'}`
  return String(record.data.name || record.data.worker_name || toolLabels[record.kind])
}
