import PptxGenJS from 'pptxgenjs'
import type { Appointment } from '../types/domain'
import { getPrivateObjectUrl, listAttendanceContent } from './fd-sst'

type AttendanceContent = Awaited<ReturnType<typeof listAttendanceContent>>

const COLORS = { ink: '141719', yellow: 'FFC514', muted: '66717A', line: 'DCE1E5', pale: 'F5F7F8', white: 'FFFFFF', green: '197A4D', red: 'B23A3A' }
const SLIDE_W = 13.333
const SLIDE_H = 7.5

function text(value: unknown, fallback = 'Não informado') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function date(value?: string | null, withTime = true) {
  if (!value) return 'Não informado'
  return new Intl.DateTimeFormat('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(new Date(value))
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))
}

function cleanFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || 'atendimento'
}

async function dataUriFromUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Não foi possível preparar a imagem do relatório.')
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem do relatório.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

function addHeader(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.addShape(PptxGenJS.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.68, fill: { color: COLORS.ink }, line: { color: COLORS.ink } })
  slide.addShape(PptxGenJS.ShapeType.rect, { x: 0, y: 0.68, w: SLIDE_W, h: 0.08, fill: { color: COLORS.yellow }, line: { color: COLORS.yellow } })
  slide.addText(title, { x: 0.55, y: 0.18, w: 8.8, h: 0.28, fontFace: 'Aptos Display', fontSize: 23, bold: true, color: COLORS.white, margin: 0 })
  if (subtitle) slide.addText(subtitle, { x: 9.15, y: 0.22, w: 3.55, h: 0.2, fontFace: 'Aptos', fontSize: 9, color: 'D8DDE0', align: 'right', margin: 0 })
  slide.addText('FD SST · relatório digital', { x: 0.55, y: 7.14, w: 4.2, h: 0.14, fontFace: 'Aptos', fontSize: 7.5, color: COLORS.muted, margin: 0 })
}

function addSectionTitle(slide: PptxGenJS.Slide, title: string, description?: string) {
  slide.addText(title, { x: 0.62, y: 1.05, w: 11.9, h: 0.34, fontFace: 'Aptos Display', fontSize: 22, bold: true, color: COLORS.ink, margin: 0 })
  if (description) slide.addText(description, { x: 0.62, y: 1.46, w: 11.9, h: 0.24, fontFace: 'Aptos', fontSize: 10.5, color: COLORS.muted, margin: 0 })
}

function addCard(slide: PptxGenJS.Slide, label: string, value: string, x: number, y: number, w: number, h: number) {
  slide.addShape(PptxGenJS.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: COLORS.pale }, line: { color: COLORS.line, width: 0.8 } })
  slide.addText(label.toUpperCase(), { x: x + 0.18, y: y + 0.14, w: w - 0.36, h: 0.16, fontFace: 'Aptos', fontSize: 7.6, bold: true, color: COLORS.muted, charSpacing: 0.4, margin: 0 })
  slide.addText(value, { x: x + 0.18, y: y + 0.4, w: w - 0.36, h: h - 0.54, fontFace: 'Aptos', fontSize: 12, bold: true, color: COLORS.ink, breakLine: false, fit: 'shrink', margin: 0.02, valign: 'middle' })
}

function addLines(slide: PptxGenJS.Slide, lines: string[], y = 1.86) {
  const visible = lines.length ? lines : ['Nenhum registro informado.']
  const rowHeight = Math.min(0.72, 4.9 / visible.length)
  visible.forEach((line, index) => {
    const top = y + index * rowHeight
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.66, y: top, w: 12, h: Math.max(0.45, rowHeight - 0.11), rectRadius: 0.05, fill: { color: index % 2 ? COLORS.white : COLORS.pale }, line: { color: COLORS.line, transparency: 70, width: 0.5 } })
    slide.addText(line, { x: 0.88, y: top + 0.1, w: 11.55, h: Math.max(0.25, rowHeight - 0.2), fontFace: 'Aptos', fontSize: visible.length > 7 ? 9.2 : 10.5, color: COLORS.ink, breakLine: false, fit: 'shrink', margin: 0 })
  })
}

function answerLabel(status?: string) {
  return ({ conforming: 'Conforme', non_conforming: 'Não conforme', not_applicable: 'N/A' } as Record<string, string>)[status || ''] || 'Não respondido'
}

function noteLabel(kind?: string) {
  return ({ general: 'Informação geral', issue: 'Problema identificado', guidance: 'Orientação fornecida', recommendation: 'Recomendação geral', pending: 'Pendência' } as Record<string, string>)[kind || ''] || 'Observação'
}

export async function generateAttendancePowerPoint({ appointment, content }: { appointment: Appointment; content: AttendanceContent }) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'FD SST'
  pptx.company = 'FD SST'
  pptx.subject = 'Relatório completo de atendimento técnico'
  pptx.title = `Relatório de atendimento - ${text(appointment.clients?.name, 'cliente')}`
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' }

  const client = appointment.clients
  const technicians = appointment.appointment_technicians?.map((item) => item.profiles?.full_name).filter(Boolean).join(', ') || 'Não informado'
  const clientName = text(client?.name, 'Cliente')
  const location = text(appointment.location_text || client?.address_line)
  const cnae = client?.cnae_code || client?.cnae_input || 'Não informado'
  const finalizationNote = (appointment as Appointment & { finalization_note?: string | null }).finalization_note

  const cover = pptx.addSlide()
  cover.background = { color: COLORS.ink }
  cover.addShape(PptxGenJS.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.16, fill: { color: COLORS.yellow }, line: { color: COLORS.yellow } })
  cover.addText('RELATÓRIO COMPLETO', { x: 0.76, y: 1.05, w: 4.5, h: 0.22, fontFace: 'Aptos', fontSize: 11, bold: true, color: COLORS.yellow, charSpacing: 1.2, margin: 0 })
  cover.addText('Atendimento\ntécnico', { x: 0.72, y: 1.48, w: 7.3, h: 1.38, fontFace: 'Aptos Display', fontSize: 39, bold: true, color: COLORS.white, breakLine: false, margin: 0 })
  cover.addText(clientName, { x: 0.76, y: 3.25, w: 8.6, h: 0.38, fontFace: 'Aptos', fontSize: 18, color: 'DDE1E4', margin: 0 })
  cover.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.76, y: 4.2, w: 5.1, h: 1.15, rectRadius: 0.08, fill: { color: '252A2E' }, line: { color: '394147', width: 0.7 } })
  cover.addText(`${text(appointment.service_type)}\n${date(appointment.completed_at || appointment.starts_at)}`, { x: 1.02, y: 4.48, w: 4.58, h: 0.52, fontFace: 'Aptos', fontSize: 12.5, bold: true, color: COLORS.white, breakLine: false, margin: 0 })
  cover.addText('Gerado a partir do atendimento concluído no sistema', { x: 0.76, y: 6.72, w: 7.1, h: 0.18, fontFace: 'Aptos', fontSize: 9, color: 'AEB7BD', margin: 0 })

  const summary = pptx.addSlide()
  addHeader(summary, 'Resumo da visita', clientName)
  addSectionTitle(summary, 'Dados consolidados do atendimento')
  addCard(summary, 'Cliente', clientName, 0.66, 1.88, 3.85, 1.12)
  addCard(summary, 'Tipo de atendimento', text(appointment.service_type), 4.75, 1.88, 3.85, 1.12)
  addCard(summary, 'Status', 'Finalizado', 8.84, 1.88, 3.85, 1.12)
  addCard(summary, 'Data e horário', date(appointment.starts_at), 0.66, 3.25, 3.85, 1.12)
  addCard(summary, 'Local', location, 4.75, 3.25, 3.85, 1.12)
  addCard(summary, 'Técnico(s)', technicians, 8.84, 3.25, 3.85, 1.12)
  addCard(summary, 'CNAE', `${cnae}${client?.cnae_description_snapshot ? ` · ${client.cnae_description_snapshot}` : client?.business_activity ? ` · ${client.business_activity}` : ''}`, 0.66, 4.62, 5.9, 1.12)
  addCard(summary, 'Descrição inicial', text(appointment.description, 'Sem observações iniciais'), 6.79, 4.62, 5.9, 1.12)

  if (finalizationNote) {
    const slide = pptx.addSlide()
    addHeader(slide, 'Finalização', clientName)
    addSectionTitle(slide, 'Observação registrada ao finalizar')
    addLines(slide, [finalizationNote])
  }

  if (content.services.length) {
    for (const [index, page] of chunks(content.services as any[], 7).entries()) {
      const slide = pptx.addSlide()
      addHeader(slide, 'Serviços registrados', clientName)
      addSectionTitle(slide, index ? `Serviços registrados · continuação ${index + 1}` : 'Serviços realizados')
      addLines(slide, page.map((record) => `${date(record.performed_at)} · ${text(record.service_name)}${record.notes ? ` — ${record.notes}` : ''}`))
    }
  }

  if (content.activities.length) {
    for (const [index, page] of chunks(content.activities as any[], 6).entries()) {
      const slide = pptx.addSlide()
      addHeader(slide, 'Funções observadas', clientName)
      addSectionTitle(slide, index ? `Funções observadas · continuação ${index + 1}` : 'Atividades por função')
      addLines(slide, page.map((record) => `${text(record.role_name, 'Função não informada')}${record.sector ? ` · ${record.sector}` : ''}${record.worker_name ? ` · Trabalhador: ${record.worker_name}` : ''}\n${text(record.description, '')}${record.notes ? ` · Observação: ${record.notes}` : ''}`))
    }
  }

  const checklistLines = (content.checklists as any[]).flatMap((checklist) => {
    const title = checklist.checklist_template_versions?.checklist_templates?.name || 'Checklist'
    const answerMap = new Map((content.answers as any[]).filter((answer) => answer.appointment_checklist_id === checklist.id).map((answer) => [answer.checklist_item_id, answer]))
    return (checklist.checklist_template_versions?.checklist_items || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((item: any) => {
      const answer = answerMap.get(item.id) as any
      return `${title} · ${item.prompt}\n${answerLabel(answer?.answer?.status)}${answer?.note ? ` — ${answer.note}` : ''}`
    })
  })
  if (checklistLines.length) {
    for (const [index, page] of chunks(checklistLines, 6).entries()) {
      const slide = pptx.addSlide()
      addHeader(slide, 'Conferência técnica', clientName)
      addSectionTitle(slide, index ? `Itens conferidos · continuação ${index + 1}` : 'Itens de conferência registrados')
      addLines(slide, page)
    }
  }

  if (content.notes.length) {
    for (const [index, page] of chunks(content.notes as any[], 7).entries()) {
      const slide = pptx.addSlide()
      addHeader(slide, 'Observações gerais', clientName)
      addSectionTitle(slide, index ? `Observações gerais · continuação ${index + 1}` : 'Registros da visita')
      addLines(slide, page.map((record) => `${noteLabel(record.note_kind)} · ${text(record.body)}`))
    }
  }

  for (const [index, record] of (content.evidence as any[]).entries()) {
    const slide = pptx.addSlide()
    addHeader(slide, `Inspeção ${String(index + 1).padStart(2, '0')}`, clientName)
    addSectionTitle(slide, 'Foto e observação da inspeção', `Registro ${index + 1} de ${content.evidence.length}`)
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 0.66, y: 1.86, w: 7.2, h: 4.82, rectRadius: 0.08, fill: { color: COLORS.pale }, line: { color: COLORS.line, width: 0.8 } })
    let imageData: string | null = null
    if (record.media_kind === 'image' && record.storage_path) {
      try {
        const url = await getPrivateObjectUrl(record.storage_path)
        if (url) imageData = await dataUriFromUrl(url)
      } catch {
        imageData = null
      }
    }
    if (imageData) {
      slide.addImage({ data: imageData, x: 0.82, y: 2.02, w: 6.88, h: 4.5, sizing: { type: 'contain', x: 0.82, y: 2.02, w: 6.88, h: 4.5 }, altText: `Foto da inspeção ${index + 1}` })
    } else {
      slide.addText(record.media_kind === 'image' ? 'Foto não disponível para exportação' : `Arquivo registrado: ${text(record.file_name)}`, { x: 1.05, y: 3.95, w: 6.4, h: 0.3, fontFace: 'Aptos', fontSize: 13, italic: true, color: COLORS.muted, align: 'center', margin: 0 })
    }
    slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 8.18, y: 1.86, w: 4.5, h: 4.82, rectRadius: 0.08, fill: { color: COLORS.white }, line: { color: COLORS.line, width: 0.8 } })
    slide.addText('OBSERVAÇÃO', { x: 8.5, y: 2.16, w: 3.84, h: 0.16, fontFace: 'Aptos', fontSize: 8, bold: true, color: COLORS.muted, charSpacing: 0.6, margin: 0 })
    slide.addText(text(record.observation, 'Sem observação registrada.'), { x: 8.5, y: 2.5, w: 3.84, h: 1.95, fontFace: 'Aptos', fontSize: 16, bold: true, color: COLORS.ink, fit: 'shrink', breakLine: false, margin: 0 })
    let detailY = 4.75
    const details = [['Local', record.location_text], ['Classificação de risco', record.risk_level], ['Recomendação', record.recommendation], ['Notas adicionais', record.additional_notes]].filter(([, value]) => Boolean(value))
    details.forEach(([label, value]) => {
      slide.addText(String(label).toUpperCase(), { x: 8.5, y: detailY, w: 3.84, h: 0.14, fontFace: 'Aptos', fontSize: 7.5, bold: true, color: COLORS.muted, charSpacing: 0.4, margin: 0 })
      slide.addText(String(value), { x: 8.5, y: detailY + 0.2, w: 3.84, h: 0.34, fontFace: 'Aptos', fontSize: 9.5, color: COLORS.ink, fit: 'shrink', margin: 0 })
      detailY += 0.65
    })
  }

  if (content.signature) {
    const slide = pptx.addSlide()
    addHeader(slide, 'Ciência e assinatura', clientName)
    addSectionTitle(slide, 'Assinatura registrada no atendimento')
    addCard(slide, 'Responsável', text((content.signature as any).signer_name), 0.66, 1.86, 3.85, 1.1)
    addCard(slide, 'Cargo', text((content.signature as any).signer_job_title), 4.75, 1.86, 3.85, 1.1)
    addCard(slide, 'Data da assinatura', date((content.signature as any).signed_at), 8.84, 1.86, 3.85, 1.1)
    try {
      const url = await getPrivateObjectUrl((content.signature as any).storage_path)
      if (url) {
        const signatureData = await dataUriFromUrl(url)
        slide.addShape(PptxGenJS.ShapeType.roundRect, { x: 2.2, y: 3.55, w: 8.9, h: 2.15, rectRadius: 0.08, fill: { color: COLORS.white }, line: { color: COLORS.line, width: 0.8 } })
        slide.addImage({ data: signatureData, x: 2.55, y: 3.8, w: 8.2, h: 1.65, sizing: { type: 'contain', x: 2.55, y: 3.8, w: 8.2, h: 1.65 }, altText: 'Assinatura do responsável' })
      }
    } catch {
      slide.addText('Assinatura registrada, mas indisponível para incluir neste arquivo.', { x: 1.6, y: 4.28, w: 10.1, h: 0.22, fontFace: 'Aptos', fontSize: 11, italic: true, color: COLORS.muted, align: 'center', margin: 0 })
    }
  }

  if (!content.evidence.length && !content.activities.length && !content.checklists.length && !content.notes.length && !content.services.length) {
    const slide = pptx.addSlide()
    addHeader(slide, 'Registros técnicos', clientName)
    addSectionTitle(slide, 'Atendimento finalizado sem registros adicionais')
    addLines(slide, ['Este atendimento foi finalizado sem inspeções, funções, conferências, serviços ou observações gerais cadastrados.'])
  }

  await pptx.writeFile({ fileName: `Relatorio_${cleanFileName(clientName)}_${new Date(appointment.completed_at || appointment.starts_at).toISOString().slice(0, 10)}.pptx`, compression: true })
}
