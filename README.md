# FD SST

Aplicação SaaS multiempresa para a gestão de Segurança e Saúde no Trabalho da FD Saúde Ocupacional. O front-end é React, Vite e TypeScript; o backend é Supabase (PostgreSQL, Auth, Storage, RLS e Edge Functions). Não utiliza Next.js, Vercel, Firebase ou um backend separado.

## Estado desta entrega

Implementado neste primeiro incremento:

- Base React/Vite/PWA com identidade FD SST, login real por Supabase Auth e rotas para Master, ADM e Técnico.
- Migração SQL inicial com isolamento multiempresa, papéis, RLS, Storage privado, clientes, CNAE/NRs, agenda, técnicos, checklists, evidências, assinaturas, relatórios, notificações e estruturas das ferramentas técnicas.
- Interfaces conectadas ao Supabase para login, dashboard por indicadores reais, listagem/cadastro/edição de clientes, agenda e atribuição de técnicos, agenda técnica e início/finalização de atendimento.
- Edge Function de inicialização segura do primeiro Master e endpoint de confirmação pública por token opaco.
- Manifesto, service worker de shell e workflow de GitHub Pages preparado.

Ainda não implementado como funcional e, portanto, não é apresentado como pronto:

- Criação e edição visual de modelos/checklists e fluxo de respostas, evidências, assinatura e geração de PDF.
- Importação Excel e planilha modelo.
- Interface Master de cadastro de empresas/convites e os módulos técnicos de acidentes, treinamentos, IBUTG e deslocamentos.
- Fila real de e-mails: a tabela e os gatilhos de dados existem, mas o provedor corporativo de e-mail ainda precisa ser autorizado/configurado.
- Trabalho offline com fila de sincronização; o service worker atual só melhora a disponibilidade do shell e não anuncia sincronização de dados.

## Instalação local

1. Instale dependências:

   ```bash
   npm install
   ```

2. Crie um arquivo `.env` a partir de `.env.example` e informe somente a URL do projeto e a chave publicável do Supabase:

   ```bash
   cp .env.example .env
   ```

3. Inicialize um projeto Supabase exclusivo para FD SST e aplique a migração:

   ```bash
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```

4. Configure os segredos das Edge Functions no Supabase, sem colocá-los no front-end:

   ```bash
   npx supabase secrets set FD_SST_BOOTSTRAP_TOKEN=VALOR_ALEATORIO_FORTE
   npx supabase functions deploy bootstrap-master
   npx supabase functions deploy confirm-appointment
   ```

5. Crie o primeiro usuário via Supabase Auth. Em seguida, autenticado como esse usuário, execute `bootstrap-master` uma única vez com o token de inicialização. O token deve ser removido ou rotacionado logo após o uso.

6. Execute o front-end:

   ```bash
   npm run dev
   ```

## Segurança e multiempresa

Cada registro operacional possui `company_id`. As políticas RLS usam funções privadas para verificar a associação ativa ao tenant, o papel de ADM e o papel global Master. As chaves `service_role` aparecem somente no ambiente das Edge Functions e nunca em variáveis `VITE_*`.

Os buckets `fd-sst-evidence` e `fd-sst-reports` são privados. Os caminhos devem usar o formato `<company_id>/<appointment_id>/arquivo`, permitindo que as políticas validem o tenant antes de entregar ou aceitar arquivos.

O CNAE oferece uma sugestão inicial de grau de risco e NRs. A modelagem preserva fonte, justificativa e versão normativa; não deve receber tabelas ou conclusões técnicas sem referência validada.

## GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` publica apenas o front-end estático. Defina as variáveis de repositório `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` e habilite GitHub Pages via GitHub Actions. As rotas usam hash para evitar erro de atualização de página no Pages.

## Verificação realizada

Antes de conectar a um projeto Supabase, é possível validar o front-end com:

```bash
npm run build
```

Os testes contra banco, RLS, Storage e Edge Functions precisam ser executados após a criação autorizada do projeto Supabase exclusivo; não foram marcados como aprovados nesta fase.
