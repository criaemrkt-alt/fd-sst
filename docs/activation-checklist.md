# FD SST — sequência de conclusão

Atualizado em 05/11/2026. O trabalho deve avançar em partes verificáveis. Não ativar plano pago, créditos ou inferências antes da configuração e do teste limitado.

| Etapa | Quem faz | Resultado esperado |
| --- | --- | --- |
| 1. Conta gratuita Cloudflare | Responsável pela FD | Acesso a Workers AI → Use REST API |
| 2. Credenciais e licença | Responsável, orientado pelo assistente | Token restrito e Account ID salvos somente no servidor; licença do modelo verificada e aceita pelo responsável |
| 3. Teste de visão | Assistente e responsável | Uma fotografia sintética/autorizada analisada; apontamentos revisados; limite diário pequeno |
| 4. Logo oficial | Responsável fornece o arquivo original; assistente aplica | Logo fiel no PPTX, conferido antes de publicar |
| 5. Fotos sem conexão | Assistente implementa; responsável homologa no celular | Captura persistida, retomada e finalização após envio confirmado |
| 6. Simulação ilustrativa | Assistente integra e valida; responsável autoriza o serviço | Edição restrita a situação apropriada, claramente rotulada e sem comprometer originais |
| 7. Homologação final | Ambos | Teste completo no celular, download do PPTX e acesso digital do ADM |

## Primeiro passo do responsável

Abrir https://dash.cloudflare.com/ e entrar ou criar conta gratuita. No painel, abrir **Workers AI → Use REST API**. Aguardar a próxima orientação nessa tela. Não é necessário enviar chave ou senha pelo chat.

## Configuração seguinte — depois de verificar conta e licença

A documentação oficial orienta criar um Workers AI API Token com permissões específicas do Workers AI e copiar o Account ID. Guardar ambos em **Supabase → projeto FD SST → Edge Functions → Secrets**:

https://supabase.com/dashboard/project/cperyeyppyhpzyjafqtp/functions/secrets

Começar com:

```
CF_ACCOUNT_ID=<Account ID da Cloudflare>
CF_AI_TOKEN=<token restrito criado pelo responsável>
CF_AI_ENABLED=false
CF_AI_FREE_PLAN_CONFIRMED=true
CF_AI_DAILY_CALL_LIMIT=3
```

`CF_AI_FREE_PLAN_CONFIRMED=true` só deve ser definido depois de conferir que a conta continua no plano gratuito, sem cobrança excedente/créditos habilitados. Manter `CF_AI_ENABLED=false` até verificar a licença Meta e escolher a primeira evidência de teste. A licença não é aceita automaticamente pelo código. Somente depois, habilitar o teste com `CF_AI_ENABLED=true`.

Usar um novo atendimento de teste com uma fotografia. Relatórios antigos já concluídos com ressalvas não são reanalisados apenas porque uma chave foi cadastrada. O assistente deve conferir a configuração, o job, a cota e o resultado antes de ampliar o uso. Não enviar imagens de trabalhadores como teste inicial quando uma evidência sintética puder validar a integração.

## Captura offline — comportamento implementado nesta etapa

O técnico deve abrir a agenda e iniciar a visita com conexão. As visitas e o conteúdo já consultados ficam em cache para reabertura. Ao salvar uma inspeção, a imagem e sua observação são primeiro gravadas no IndexedDB, separadas por empresa/usuário/atendimento. Só depois começa o envio.

Ao voltar a conexão, a sincronização ocorre com o aplicativo aberto, sem um novo botão obrigatório. Fechar o navegador preserva a fila local; a retomada acontece ao reabrir e entrar na mesma conta. Ela não funciona como upload em segundo plano com o navegador fechado. A finalização continua exigindo conexão e espera a confirmação de envio de todas as fotografias pendentes desse usuário/aparelho.

Uma falha de rede mantém o original local. A chave do arquivo é estável em retries; duplicidade de Storage e de cadastro é tratada. Uma resposta perdida não deve apagar o arquivo que já foi recebido pelo servidor. Se outro técnico/aparelho finalizar enquanto há fotos offline em um dispositivo desconectado, essas fotos ficam preservadas e exigem revisão do atendimento — não são acrescentadas silenciosamente a um relatório concluído.

Serviços, funções, conferência e assinatura ainda requerem internet para salvar alterações; esse incremento não torna todos os formulários offline. As ferramentas independentes conservam o offline existente. Não limpar dados do navegador enquanto houver fotos pendentes, pois elas ainda não estão no servidor.

## Homologação no celular do responsável

1. Com internet, entrar como técnico, abrir a agenda e iniciar uma visita de teste.
2. Desligar a conexão e salvar duas fotos com observações diferentes.
3. Fechar e reabrir o aplicativo, ainda sem conexão; confirmar que as duas fotos e observações continuam visíveis.
4. Ligar a conexão com o aplicativo aberto; confirmar que a fila é enviada automaticamente e que cada foto aparece uma única vez na inspeção.
5. Finalizar a visita; confirmar o acesso digital imediato do ADM e acompanhar o relatório até o download.
6. Depois que a visão estiver configurada, repetir com uma fotografia de teste e revisar se os apontamentos correspondem ao que é visível.

Não marcar essa homologação física como concluída antes de executá-la. Os testes automatizados usam IndexedDB simulado, componentes React e APIs simuladas; eles não substituem o aparelho real.

## Verificação automatizada do incremento offline

Os 33 testes do aplicativo passaram, incluindo oito casos de persistência/sincronização da fila, quatro de upload idempotente e três de componentes da captura offline. O teste da inspeção força o estado offline do React Query, salva pelo formulário, recria a tela e confere a observação recuperada do IndexedDB. Também foi validado que uma captura nova pode ser gravada durante um upload lento, que falhas preservam o original e que outro login não envia a fila. Os sete testes do gerador de PPTX permanecem aprovados. Build TypeScript/Vite aprovado.

A confirmação do envio real no celular e o teste autenticado do fluxo completo continuam pendentes. O servidor trata colisão de cadastro por empresa/atendimento/caminho/autor e mantém as permissões existentes; a lógica de retry no cliente foi testada com APIs simuladas.

## Fontes oficiais

- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://supabase.com/docs/guides/functions/secrets
