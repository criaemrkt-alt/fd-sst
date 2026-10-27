// Live integration check. Creates explicitly labelled disposable test accounts
// and records. Credentials are supplied via stdin/env, never stored or printed.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)
const { createClient } = require('@supabase/supabase-js')
const url = 'https://cperyeyppyhpzyjafqtp.supabase.co'
const key = 'sb_publishable_nbisAHKwrduF8RF3UjU06Q_FIblD_qg'
const base = process.env.FD_QA_BASE || 'http://127.0.0.1:5173/'
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = client()
const login = await admin.auth.signInWithPassword({ email: process.env.FD_QA_ADMIN_EMAIL, password: process.env.FD_QA_ADMIN_PASS })
if (login.error) throw new Error(`Login administrativo: ${login.error.message}`)
const { data: memberships, error: membershipError } = await admin.from('company_memberships').select('company_id').eq('user_id', login.data.user.id).eq('role','admin').eq('active',true)
if (membershipError) throw membershipError
assert.equal(memberships.length, 1, 'Informe uma única empresa de teste antes de executar a verificação.')
const companyId = memberships[0].company_id
const { data: clients } = await admin.from('clients').select('id').eq('company_id',companyId).limit(1)
assert.ok(clients?.length, 'A empresa precisa ter um cliente para os testes.')
const clientId = clients[0].id
const run = randomUUID().slice(0,8)
const fixture = { run, companyId, users: [], records: [] }
const created = []
for (let i=0; i<2; i++) {
  const email = `fd-sst-qa-${run}-${i}@example.com`, password = `Qa!${randomUUID()}9aA`
  const result = await admin.functions.invoke('manage-company-access', { body: { action:'create_technician', company_id:companyId, full_name:`TESTE AUTOMATIZADO ${run} ${i}`, email, password } })
  if (result.error || !result.data?.user_id) throw new Error('Não foi possível criar conta temporária: '+(result.error?.message || JSON.stringify(result.data)))
  fixture.users.push(result.data.user_id)
  created.push({ email,password,id:result.data.user_id })
  console.log('QA_FIXTURE',JSON.stringify(fixture))
}
const tech=client(),peer=client()
await tech.auth.signInWithPassword(created[0]); await peer.auth.signInWithPassword(created[1])
if (process.env.FD_QA_API_ONLY === '1') {
  const now = new Date().toISOString()
  const examples = {
    travel: { origin:'QA origem',destination:`QA destino ${run}`,departed_at:now,arrived_at:now,odometer_start:100,odometer_end:112.5 },
    heat: { measured_at:now,location_text:'QA setor',activity_description:'QA atividade',instrument:'QA equipamento',tbn:20,tg:30,tbs:25,solar_exposure:true,calculated_ibutg:999 },
    accident: { occurred_at:now,location_text:'QA setor',worker_name:'QA pessoa',occurrence_type:'Incidente / quase acidente',description:'TESTE AUTOMATIZADO, NÃO É ACIDENTE REAL',recommendations:'Ação de teste',action_owner:'QA responsável',investigation_status:'Aberta' },
    training: { name:`QA treinamento ${run}`,starts_at:'2026-10-27T08:00:00Z',ends_at:'2026-10-27T10:00:00Z',location_text:'QA sala',workload_minutes:120,instructor_name:'QA instrutor',syllabus:'QA conteúdo',participants:'QA participante',attendance:'QA participante — presente' },
  }
  for (const [kind,data] of Object.entries(examples)) {
    const id=randomUUID(),mutation=randomUUID()
    const insert=await tech.from('field_tool_records').insert({id,company_id:companyId,technician_id:created[0].id,client_id:clientId,kind,status:'draft',data,last_mutation:mutation}).select().single()
    assert.ifError(insert.error);fixture.records.push(id);console.log('QA_FIXTURE',JSON.stringify(fixture))
    assert.equal((await peer.from('field_tool_records').select('id').eq('id',id)).data.length,0)
    assert.equal((await admin.from('field_tool_records').select('id').eq('id',id)).data.length,0)
    const publish=await tech.from('field_tool_records').update({status:'submitted',last_mutation:randomUUID()}).eq('id',id).eq('version',1).select().single()
    assert.ifError(publish.error);assert.equal(publish.data.version,2)
    assert.equal((await admin.from('field_tool_records').select('id').eq('id',id)).data.length,1)
    const change=await tech.from('field_tool_records').update({data:{...data,notes:'QA edição'},last_mutation:randomUUID()}).eq('id',id).eq('version',2).select().single()
    assert.ifError(change.error);assert.equal(change.data.version,3)
    const stale=await tech.from('field_tool_records').update({data}).eq('id',id).eq('version',2).select();assert.equal(stale.data.length,0)
    const tamper=await peer.from('field_tool_records').update({data:{tampered:true}}).eq('id',id).select();assert.equal(tamper.data.length,0)
    const adminWrite=await admin.from('field_tool_records').update({data:{tampered:true}}).eq('id',id).select();assert.equal(adminWrite.data.length,0)
    if(kind==='heat')assert.equal(Number(change.data.data.calculated_ibutg),22.5)
    if(kind==='travel')assert.equal(Number(change.data.data.distance_km),12.5)
    const impersonate=await tech.from('field_tool_records').insert({id:randomUUID(),company_id:companyId,technician_id:created[1].id,kind,status:'draft',data:{}});assert.ok(impersonate.error)
    console.log('PASS API '+kind+': create, private draft, publish, ADM read-only, own edit, peer isolation, optimistic version')
  }
  const bad=await tech.from('field_tool_records').insert({id:randomUUID(),company_id:companyId,technician_id:created[0].id,kind:'heat',status:'submitted',client_id:clientId,data:{}});assert.ok(bad.error)
  const crossTenant=await tech.from('field_tool_records').insert({id:randomUUID(),company_id:randomUUID(),technician_id:created[0].id,kind:'travel',data:{}});assert.ok(crossTenant.error)
  console.log('PASS invalid submission / cross-tenant writes denied')
  const path=`${companyId}/${created[0].id}/${fixture.records[0]}/${randomUUID()}`
  const upload=await tech.storage.from('fd-sst-field-tools').upload(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64'),{contentType:'image/png'});assert.ifError(upload.error)
  const photo=await tech.from('field_tool_records').update({attachments:[{id:randomUUID(),name:'teste.png',path,caption:'Foto de teste'}]}).eq('id',fixture.records[0]).select().single();assert.ifError(photo.error)
  assert.ok((await admin.storage.from('fd-sst-field-tools').createSignedUrl(path,60)).data?.signedUrl)
  assert.ok((await peer.storage.from('fd-sst-field-tools').createSignedUrl(path,60)).error)
  console.log('PASS private photo upload and ADM/peer storage rules')
  console.log('QA_FIXTURE_FINAL',JSON.stringify({...fixture,photo:path}))
  process.exit(0)
}
const browser = await chromium.launch({ headless:true, executablePath:process.env.FD_QA_CHROME || chromium.executablePath(), args:['--no-sandbox'] })
const context = await browser.newContext({ viewport:{ width:390,height:844 }, timezoneId:'America/Sao_Paulo' })
const page = await context.newPage()
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message))
async function uiLogin(p,email,password,path='app/technician/tools') {
  await p.goto(`${base}#/${path}`)
  await p.locator('input[type=email]').fill(email);await p.locator('input[type=password]').fill(password)
  await p.getByRole('button',{name:'Entrar',exact:true}).click()
}
async function fill(label,value){await page.getByLabel(label,{exact:true}).fill(String(value))}
async function publish(){await page.getByRole('button',{name:'Finalizar e enviar ao ADM',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Sincronizar',exact:true}).waitFor()}
async function waitRow(text,state='Enviado ao ADM'){const row=page.locator('.tool-history-row').filter({hasText:text});await row.filter({hasText:state}).waitFor({timeout:30000});return row}
try {
  await uiLogin(page,created[0].email,created[0].password)
  await page.getByRole('heading',{name:'Ferramentas de campo',exact:true}).waitFor()
  await page.getByRole('button',{name:'Sincronizar',exact:true}).waitFor()
  await page.locator('.field-tool-card').filter({hasText:'Deslocamento e KM'}).click()
  await fill('Origem *',`QA origem ${run}`);await fill('Destino *',`QA destino ${run}`)
  await page.getByRole('button',{name:'Marcar saída agora'}).click();await page.getByRole('button',{name:'Marcar chegada agora'}).click()
  await fill('Hodômetro inicial (km)',100);await fill('Hodômetro final (km)',112.5)
  await page.locator('input[type=file]').setInputFiles({name:'teste.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')})
  await fill('Observação da foto','Foto de teste automatizado')
  await publish();await waitRow(`QA destino ${run}`)
  let rows=await tech.from('field_tool_records').select('*').eq('company_id',companyId).eq('technician_id',created[0].id)
  assert.ifError(rows.error);assert.equal(rows.data.length,1);const travel=rows.data[0];fixture.records.push(travel.id);console.log('QA_FIXTURE',JSON.stringify(fixture))
  assert.equal(Number(travel.data.distance_km),12.5);assert.equal(travel.attachments.length,1)
  console.log('PASS browser → API → DB: travel, odometer calculation, photo')
  assert.equal((await peer.from('field_tool_records').select('id').eq('id',travel.id)).data.length,0)
  assert.ok((await peer.storage.from('fd-sst-field-tools').createSignedUrl(travel.attachments[0].path,60)).error)
  assert.equal((await admin.from('field_tool_records').select('id').eq('id',travel.id)).data.length,1)
  assert.ok((await admin.storage.from('fd-sst-field-tools').createSignedUrl(travel.attachments[0].path,60)).data?.signedUrl)
  console.log('PASS RLS: peer cannot read record/photo; ADM can read submitted record/photo')
  await page.locator('.field-tool-card').filter({hasText:'Calor (IBUTG)'}).click()
  await page.getByLabel('Cliente *',{exact:true}).selectOption(clientId)
  await fill('Setor / local *','QA calor '+run);await fill('Atividade / posto *','QA operação');await fill('Equipamento / modelo / número de série *','QA equipamento')
  await fill('Bulbo úmido natural — tbn (°C) *',20);await fill('Temperatura de globo — tg (°C) *',30)
  await page.getByLabel('Com carga solar direta',{exact:true}).check();await fill('Bulbo seco — tbs (°C)',25)
  await publish();await waitRow('QA calor '+run)
  console.log('PASS calor: solar inputs, calculation and persistence')
  await page.locator('.field-tool-card').filter({hasText:'Investigação de acidente'}).click()
  await page.getByLabel('Cliente *',{exact:true}).selectOption(clientId)
  await fill('Local / setor *','QA acidente '+run);await fill('Colaborador *','QA colaborador '+run)
  await page.getByLabel('Tipo de ocorrência *',{exact:true}).selectOption('Incidente / quase acidente')
  await fill('Descrição da ocorrência *','Ocorrência de teste, sem acidente real.');await fill('Plano de ação / recomendações *','Ação de teste');await fill('Responsável pelo acompanhamento *','QA responsável')
  await publish();await waitRow('QA colaborador '+run)
  console.log('PASS acidente: investigação, plano de ação and persistence')
  await page.locator('.field-tool-card').filter({hasText:'Treinamentos'}).click()
  await page.getByLabel('Cliente *',{exact:true}).selectOption(clientId)
  await fill('Nome do treinamento *','QA treinamento '+run);await fill('Início *','2026-10-27T08:00');await fill('Fim *','2026-10-27T10:00')
  await fill('Local *','QA sala');await fill('Carga horária efetiva (min) *',120);await fill('Instrutor *','QA instrutor');await fill('Conteúdo programático *','Conteúdo de teste');await fill('Participantes (um nome por linha) *','QA participante')
  await publish();await waitRow('QA treinamento '+run)
  console.log('PASS treinamento: participants, attendance data and persistence')
  await context.setOffline(true)
  await page.locator('.field-tool-card').filter({hasText:'Deslocamento e KM'}).click()
  await fill('Destino *','QA offline '+run);await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'});await waitRow('QA offline '+run,'Pendente de sincronização')
  await page.reload();await page.getByRole('heading',{name:'Ferramentas de campo',exact:true}).waitFor({timeout:20000})
  await waitRow('QA offline '+run,'Pendente de sincronização')
  await context.setOffline(false);await waitRow('QA offline '+run,'Rascunho sincronizado')
  const drafts=await tech.from('field_tool_records').select('*').eq('technician_id',created[0].id).eq('status','draft')
  assert.equal(drafts.data.length,1);assert.equal((await admin.from('field_tool_records').select('id').eq('id',drafts.data[0].id)).data.length,0)
  await page.getByRole('button',{name:'Sincronizar',exact:true}).click();await page.getByRole('button',{name:'Sincronizar',exact:true}).waitFor()
  assert.equal((await tech.from('field_tool_records').select('id').eq('technician_id',created[0].id).eq('status','draft')).data.length,1)
  console.log('PASS offline: new record, reload, reconnect, draft privacy, no duplicates')
  await (await waitRow('QA destino '+run)).click();await fill('Destino *','QA editado '+run);await publish();await waitRow('QA editado '+run)
  const edited=await tech.from('field_tool_records').select('*').eq('id',travel.id).single();assert.equal(edited.data.data.destination,'QA editado '+run);assert.ok(edited.data.version>travel.version)
  console.log('PASS browser edit existing record')
  const bad=await tech.from('field_tool_records').insert({id:randomUUID(),company_id:companyId,technician_id:created[1].id,kind:'travel',data:{}})
  assert.ok(bad.error)
  const tamper=await peer.from('field_tool_records').update({data:{destination:'tampered'}}).eq('id',travel.id).select();assert.equal(tamper.data.length,0)
  console.log('PASS RLS: cannot impersonate owner or modify peer record')
  const adminContext=await browser.newContext({viewport:{width:390,height:844}}),adminPage=await adminContext.newPage()
  await uiLogin(adminPage,process.env.FD_QA_ADMIN_EMAIL,process.env.FD_QA_ADMIN_PASS,'app/admin/field-tools')
  await adminPage.getByRole('heading',{name:'Registros de campo',exact:true}).waitFor()
  await adminPage.locator('.tool-history-row').filter({hasText:'QA editado '+run}).click()
  await adminPage.getByRole('dialog').waitFor();assert.ok(await adminPage.getByRole('dialog').getByText('Foto de teste automatizado').count())
  console.log('PASS ADM UI receives submitted full details, photo, technician name')
  assert.deepEqual(pageErrors,[])
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)
  assert.equal(overflow,false,'Mobile page must not overflow horizontally')
  await page.screenshot({path:'/workspace/scratch/8e432881c39f/qa-field-tools-mobile.png',fullPage:true})
  console.log('PASS mobile layout and zero page errors')
} finally {
  const data=await tech.from('field_tool_records').select('id').eq('technician_id',created[0].id)
  fixture.records=(data.data||[]).map(r=>r.id)
  console.log('QA_FIXTURE_FINAL',JSON.stringify(fixture))
  await browser.close()
}
