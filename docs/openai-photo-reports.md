# FD SST — integração OpenAI em relatórios fotográficos (26/11/2026)

## Estado real
Este documento descreve a branch de integração, **não certifica que a produção está ativada**. A fila PostgreSQL, o worker Supabase, o PPTX e a área Meus Relatórios já existem. Os cinco jobs antigos não serão reprocessados automaticamente. Testes de provedor usam respostas sintéticas sem consumir API.

### Modelos
- Visão: `gpt-6-luna` via `POST https://api.openai.com/v1/responses`, com imagem JPEG reduzida e JSON Schema estrito.
- Imagem de correção: `gpt-image-2.6-flare` via `POST https://api.openai.com/v1/images/edits`, com `quality=low` e saída JPEG otimizada.
- Apontamentos: código existente com caixas e números sobre **cópias**, nunca sobre originais.
- Simulação: **ilustrativa e sujeita a revisão técnica**, nunca prova de uma adequação executada.
- As fotos são processadas uma por execução da fila, evitando explosão simultânea de chamadas. Estima-se cerca de 101 ciclos de um minuto para 100 fotos, além de eventuais edições e esperas.

## Configuração no projeto FD SST
1. Criar chave restrita à API num projeto próprio em https://platform.openai.com/api-keys. A assinatura do ChatGPT não equivale à cobrança da API. Confira créditos disponíveis e limite de uso no painel antes de habilitar.
2. Abrir https://supabase.com/dashboard/project/cperyeyppyhpzyjafqtp/functions/secrets. Nunca colocar tokens em .env público, GitHub ou mensagens.
3. Definir os segredos **somente no Supabase**:
   - `OPENAI_API_KEY` = chave pessoal/projeto da API
   - `OPENAI_AI_ENABLED` = `true` após revisão e ativação controlada
   - `OPENAI_SIMULATION_ENABLED` = `false` para o primeiro teste; habilitar depois de validar resultados, preços e autorizar consumo das imagens
   - Opcionais: `OPENAI_VISION_MODEL` = `gpt-6-luna` e `OPENAI_IMAGE_MODEL` = `gpt-image-2.6-flare`.
4. Publicar a nova versão do `photo-report-worker` **após** CI e revisão de segurança, mantendo `verify_jwt=false` porque a função usa token de dispatch privado consumido uma única vez pelo banco.
5. Concluir **um novo atendimento de teste com uma foto sintética/autorizada**; monitorar `photo_report_jobs` e `photo_report_items` para `analysis.status='analyzed'`, `model='gpt-6-luna'`, e apontamentos com `annotated_path` se houver localização confiável. Fotos sem riscos identificados podem corretamente não receber marcações.
6. Após inspecionar os gastos e a qualidade, habilitar `OPENAI_SIMULATION_ENABLED=true` e gerar outra visita com uma irregularidade visível que mereça simulação. A geração acontece somente para problemas com `simulate=true`, confiança >= 0,9 e caixa localizada. Não assuma que todas as fotos terão edições.

## Falhas e faturamento
- Se faltar chave ou `OPENAI_AI_ENABLED`, o worker preserva fotos e produz relatório com ressalvas.
- Se a API responder falta de cota/limite 429 ou 402, o worker pausa o processamento e agenda retry. 
- Falha na edição não elimina apontamentos nem a foto original; o relatório indica simulação ausente.
- Chamadas de visão e imagem são cobradas na API conforme tokens/imagens. Os testes automatizados não fazem chamadas externas.
- O aplicativo não habilita automaticamente planos nem créditos. Configure um orçamento no painel OpenAI antes de ativar o serviço.
- As miniaturas e originais permanecem no bucket privado Supabase; somente a cópia reduzida é enviada à API, sem nomes do cliente/técnico no prompt. A FD deve definir retenção/transferência de dados pessoais e autorização para fotos que incluam trabalhadores.

## Limitações até homologação
- Confirmar na conta OpenAI se os dois modelos estão disponíveis e se há saldo da API.
- Verificar manualmente segurança das sugestões e fidelidade das imagens simuladas; não aprovar simulações de máquina/instalação como projeto técnico sem revisão.
- Testar foto real e navegação no celular com autenticação para confirmar o download.
- Nenhum PDF ou envio por e-mail é criado; entrega ocorre no site em .pptx.
