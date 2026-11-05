# Relatórios fotográficos automáticos — entrega de 05/11/2026

## O que funciona

O trigger de finalização cria um job único por atendimento concluído e captura a ordem, observações e metadados das fotografias. A transação da visita não depende de uma chamada de IA. O ADM continua lendo os registros digitais assim que a visita é finalizada, independentemente da fila.

O cron executa a cada minuto e despacha até três jobs, com uma fotografia por execução, autenticação por token privado de uso único e lease de três minutos. A fila fica no PostgreSQL; nenhum navegador precisa permanecer aberto. Há retomada de leases expirados, recuperação de finalizações sem job desde a instalação, três tentativas por foto, pausa de cota e limite global de tentativas. Um relatório com 100 fotos normalmente demanda aproximadamente 101 ciclos de um minuto; relatórios concorrentes aguardam capacidade. Não é uma promessa de processamento instantâneo.

O worker mantém originais intactos, produz cópias JPEG de até 140 KB e miniaturas, valida apontamentos estruturados e só desenha caixas/números em regiões normalizadas com confiança mínima de 0,8. Coordenadas incertas ficam em texto. Toda recomendação permanece uma sugestão de IA para validação presencial. Não há catálogo oficial de NRs verificado: nenhum número de NR é atribuído automaticamente.

O PPTX inclui capa, técnico em primeiro lugar na segunda página, resumo, serviços, funções, observações, assinatura e um slide com foto/observação por evidência, mais slides para análises e ressalvas. Checklist continua opcional no exportador administrativo já existente e não entra por padrão no automático. Não há PDF ou envio por e-mail.

“Meus Relatórios” consulta os estados reais. O download exige arquivo presente, tamanho correspondente e URL assinada válida por 120 segundos. Os arquivos ficam no bucket privado `fd-sst-ai-reports`, separados por empresa/atendimento/job; as permissões usam a designação do técnico e as regras existentes de acesso após finalização do ADM. Usuários comuns não podem escrever jobs, análises ou artefatos.

## Bloqueios e limites explícitos

- **Nenhuma inferência real de IA foi executada.** Não há credenciais de um provedor autorizado. O adaptador de visão Cloudflare está implementado, mas desativado. Os relatórios saem com ressalvas e preservam as fotografias/observações.
- **Simulações não estão operacionais.** Existe a interface substituível `SimulationProvider`, uma implementação desativada e suporte a slides claramente rotulados. Falta integrar e homologar um serviço de edição que preserve o cenário e a região desejada. FLUX Schnell não edita fotos; a documentação atual de FLUX.2 Klein descreve edição, mas essa integração e sua fidelidade não foram testadas. Não ativar apenas com uma chave sem essa homologação.
- O logo oficial não foi encontrado nos ativos do projeto. Foi mantida a identificação textual FD SST e a paleta existente, sem redesenhar um logo.
- A captura offline de fotografias foi acrescentada em 05/11: imagem e observação ficam em IndexedDB, a retomada ocorre com o app aberto e a finalização espera o envio confirmado. A agenda e a visita precisam ter sido abertas e iniciadas com conexão. Os demais formulários da visita ainda dependem de internet. Veja `activation-checklist.md` para o roteiro de uso e homologação no celular.
- Não foi feita uma sessão de homologação visual do aplicativo em um celular físico nem um download autenticado pelo navegador. A tela e os bloqueios de download têm testes de componente; as regras reais do banco foram verificadas.
- A preparação de fotos limita arquivos recebidos a 12 MB; imagens inválidas/incompatíveis ficam como falha por item. A plataforma limita memória/CPU, e imagens maiores exigem processamento externo. O PPTX tem teto de 48 MB; exceder esse teto gera retry e, após o limite, falha explícita, sem anunciar arquivo pronto.

## Configuração do provedor de visão

Somente no servidor, pelo painel de secrets do Supabase, após verificar o plano gratuito, licença, política de dados e autorização de envio das fotografias:

```
CF_ACCOUNT_ID=<identificador da conta>
CF_AI_TOKEN=<token restrito ao Workers AI>
CF_AI_ENABLED=true
CF_AI_FREE_PLAN_CONFIRMED=true
CF_AI_DAILY_CALL_LIMIT=<limite inicial pequeno, entre 1 e 200>
```

Sem todos os gates, não há requisição externa. Sem limite positivo, a reserva de cota recusa chamadas. A reserva é atômica e diária em UTC; HTTP 429 pausa uma hora e permite retomada. A Cloudflare exige aceite inicial da licença Meta para esse modelo; esse aceite não foi enviado em nome da FD. Os limites de chamadas não equivalem a neurons: homologar o consumo real em poucas fotografias antes de aumentar. **Não ativar plano pago, créditos ou cobrança automática.**

O modelo configurado é `@cf/meta/llama-3.2-11b-vision-instruct`; as fotos enviadas são cópias reduzidas, sem nome do cliente, técnico ou observações anexadas ao prompt. Trabalhadores podem aparecer nas fotos; a FD ainda precisa definir a base legal, acesso interno, prazo de retenção e eventuais exigências de localização dos dados. A documentação do modelo declara zero data retention. Isso não substitui a avaliação da FD sobre o tratamento das imagens.

## Custos e capacidade

Gasto realizado com provedores de IA: **zero**; nenhum plano ou crédito foi ativado. Foram usados os recursos existentes do Supabase para testes limitados; não foi auditada a fatura da organização.

A documentação consultada em 05/11/2026 informa 10.000 neurons/dia sem cobrança no Workers Free; acima disso, chamadas falham. No plano pago, uso excedente é cobrado. Não se promete gratuidade para 200 fotos/dia ou simulações. Sem inferências autorizadas, não existe medição real de tokens/neurons deste aplicativo.

Hipótese para planejamento: original médio de 2 MB, cópia de trabalho e anotação de até 140 KB cada, miniatura estimada em 10 KB e PPTX estimado em 0,31 MB/foto. Simulações estão excluídas; texto, volume de apontamentos e imagens originais podem alterar o resultado.

| Fotos por relatório | Originais | Derivadas estimadas | PPTX estimado | Total estimado |
| --- | ---: | ---: | ---: | ---: |
| 20 | 40 MB | 5,8 MB | 6,2 MB | 52 MB |
| 50 | 100 MB | 14,5 MB | 15,5 MB | 130 MB |
| 100 | 200 MB | 29 MB | 31 MB | 260 MB |

Dois relatórios de 100 fotos por técnico/dia representam aproximadamente 520 MB/dia nessa hipótese; dez técnicos, 5,2 GB/dia. Os originais dominam o crescimento. O Free da Supabase informa 1 GB de Storage, 5 GB de egress e 500 mil invocações/mês, compartilhados com o aplicativo existente. Esses volumes ultrapassam rapidamente o armazenamento gratuito. Cada download transfere o tamanho do PPTX, além do tráfego de processamento e visualização.

Ponto para reavaliar capacidade: antes de o armazenamento/tráfego atingir os limites da organização ou a fila deixar de atender o prazo operacional. Medir uso e obter autorização antes de migrar plano ou contratar worker maior; nada disso foi ativado automaticamente.

## Retenção e operação

Originais, relatórios e cópias são conservados. Não foi instalado um expurgo automático porque a FD não definiu retenção. Futuramente, miniaturas e cópias temporárias podem ser removidas por uma rotina no Storage API depois de verificar que não são necessárias para retomadas; não apagar originais ou linhas de `storage.objects` diretamente para economizar espaço.

Para pausar apenas o processamento, mantendo finalização e enfileiramento:

```sql
update private.photo_report_configuration set enabled=false;
```

A reativação usa `enabled=true`. Monitorar `photo_report_jobs`, `photo_report_items`, execuções do cron e respostas do `pg_net`. Não registrar imagens, tokens ou dados pessoais nos logs. O advisor informa RLS sem policies nas três tabelas privadas: é intencional (negação aos usuários comuns, funções controladas). Também informa `pg_net` instalado em `public`, padrão não relocável da extensão, e proteção de senhas vazadas desabilitada já existente; nenhum plano pago foi habilitado para alterar isso.

## Verificação executada

- Build TypeScript/Vite aprovado; permanece aviso de bundle acima de 500 KB.
- 18 testes do aplicativo aprovados, incluindo arquivo ausente/truncado, estado parcial e download habilitado somente após verificar metadados.
- 7 testes do worker: regiões incertas sem marcação, preservação da imagem fonte, referências não verificadas descartadas, bloqueio sem credencial, cota esgotada sem chamada, falha parcial, rotulagem de simulação sintética e PPTX com 3/20/100 fotos.
- Carga local de 100 imagens de alta entropia: JPEG de 106.572 bytes; PPTX de 12.396.998 bytes, montagem aproximadamente 0,7 s nesta máquina. Esses tempos não são garantia do servidor. O teste local usa ImageScript npm 1.3; a Edge usa a versão Deno 1.2.15, testada separadamente em uma fotografia real autorizada.
- ZIP/Open XML, número de imagens e observações validados. LibreOffice abriu um PPTX real e exportou capa e segunda página como PNG; técnico primeiro foi conferido visualmente. Nenhum PDF foi produzido.
- Supabase real: finalização criou um único job mesmo após nova tentativa de enqueue; cron/worker completaram sem navegador. Um atendimento de teste sem fotos gerou 85.421 bytes; uma fotografia autorizada gerou arquivo parcial de 148.983 bytes com a compressão atual.
- Cota no PostgreSQL: limites nulo, zero e acima de 200 recusados; segunda reserva com limite 1 bloqueada. Testes em transação revertida, sem consumir cota real. Token de dispatch já consumido não pôde ser reutilizado; usuários comuns não têm permissão de reserva.
- Montagem no Supabase com 100 cópias derivadas preparadas: 6.789.859 bytes, status parcial, sem chamada externa. Essa prova de montagem **não equivale** a analisar 100 fotos por IA ou testar 100 uploads de originais.
- RLS real: técnico designado leu o job; outro técnico da mesma empresa não; administrador de outra empresa não leu job nem artefato; ADM da empresa leu os originais mesmo com job recolocado temporariamente em fila, dentro de transação revertida.
- A execução de visão real, qualidade das marcações sobre saída real de modelo, edição fotográfica, cota real do provedor e homologação de mobile continuam pendentes.

Os registros de aceitação identificados como TESTE/VALIDAÇÃO pertencem à empresa de teste existente. Os registros técnicos originais não foram reescritos.

## Fontes oficiais consultadas

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://developers.cloudflare.com/workers-ai/platform/data-usage/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/platform/billing-on-supabase
