// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { TechnicianToolsPage } from './field-tools'
import { localPut, localRecords } from '../services/field-tool-store'
import { toolFields, type ToolKind } from '../services/field-tool-model'
vi.mock('../providers/auth-provider', () => ({ useAuth: () => ({ user: { id: 'tech-ui' } }) }))
vi.mock('../lib/supabase', () => ({ supabase: null }))
vi.mock('../services/fd-sst', () => ({ listClients: async () => [], listAppointments: async () => [] }))
const membership = { id:'m-ui',company_id:'company-ui',user_id:'tech-ui',role:'technician' as const,active:true,job_title:null }
const scope = { companyId:'company-ui',userId:'tech-ui' }
beforeEach(async () => {
  vi.stubGlobal('indexedDB',new IDBFactory())
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
  await localPut('refs:company-ui:tech-ui',{clients:[{id:'client-ui',name:'Cliente de teste'}],appointments:[]})
})
afterEach(() => { cleanup();vi.unstubAllGlobals() })
function input(label:string,value:string){fireEvent.change(screen.getByLabelText(label),{target:{value}})}
describe('technician tools UI and IndexedDB integration', () => {
  it('creates an offline trip, reopens it and restores the editable data', async () => {
    const app=render(<TechnicianToolsPage membership={membership} />)
    fireEvent.click(screen.getByRole('button',{name:/Deslocamento e KM Novo registro/}))
    input('Origem *','Origem UI');input('Destino *','Destino UI')
    fireEvent.click(screen.getByRole('button',{name:'Marcar saída agora'}));fireEvent.click(screen.getByRole('button',{name:'Marcar chegada agora'}))
    input('Hodômetro inicial (km)','100');input('Hodômetro final (km)','115')
    expect(screen.getByText('Distância: 15 km')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Finalizar e enviar ao ADM'}))
    await screen.findByText('Pendente de sincronização')
    expect((await localRecords(scope))[0].data.destination).toBe('Destino UI')
    app.unmount();render(<TechnicianToolsPage membership={membership} />)
    const row=await screen.findByRole('button',{name:/15 km · Destino UI/});fireEvent.click(row)
    expect((screen.getByLabelText('Destino *') as HTMLInputElement).value).toBe('Destino UI')
    input('Destino *','Destino editado');fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}))
    await waitFor(async()=>expect((await localRecords(scope))[0].data.destination).toBe('Destino editado'))
  })
  it('blocks an incomplete heat submission and calculates only when inputs exist', async () => {
    render(<TechnicianToolsPage membership={membership} />)
    fireEvent.click(screen.getByRole('button',{name:/Calor \(IBUTG\) Novo registro/}))
    expect(screen.getByText('IBUTG: — °C')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Finalizar e enviar ao ADM'}))
    expect(await screen.findByText(/Selecione o cliente\./)).toBeTruthy()
    input('Bulbo úmido natural — tbn (°C) *','20');input('Temperatura de globo — tg (°C) *','30')
    expect(screen.getByText('IBUTG: 23 °C')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Com carga solar direta'))
    expect(screen.getByText('IBUTG: — °C')).toBeTruthy()
    input('Bulbo seco — tbs (°C)','25');expect(screen.getByText('IBUTG: 22.5 °C')).toBeTruthy()
  })
  for (const kind of ['accident','training'] as ToolKind[]) it(`saves a complete ${kind} offline`,async()=>{
    render(<TechnicianToolsPage membership={membership} />)
    fireEvent.click(screen.getByRole('button',{name:kind==='accident'?/Investigação de acidente Novo registro/:/Treinamentos Novo registro/}))
    await waitFor(()=>expect(screen.getByRole('option',{name:'Cliente de teste'})).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Cliente *'),{target:{value:'client-ui'}})
    for(const field of toolFields[kind].filter(f=>f.required)){
      const value=field.type==='select'?field.options![0]:field.type==='number'?'60':field.type==='datetime-local'?(field.key==='ends_at'?'2026-10-27T10:00':'2026-10-27T08:00'):'Teste '+field.key
      input(field.label+' *',value)
    }
    fireEvent.click(screen.getByRole('button',{name:'Finalizar e enviar ao ADM'}))
    await screen.findByText('Pendente de sincronização')
    const rows=await localRecords(scope);expect(rows).toHaveLength(1);expect(rows[0].kind).toBe(kind);expect(rows[0].status).toBe('submitted')
  })
})
