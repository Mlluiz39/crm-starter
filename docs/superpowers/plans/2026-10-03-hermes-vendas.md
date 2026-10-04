# Hermes vendedor sênior — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Atender leads prospectados com Hermes e Jev por WhatsApp wacli/e-mail, exigindo aprovação da proposta e do fechamento.

**Architecture:** O CRM mantém conversas, tarefas, reservas, outbox e aprovações no SQLite atual. Um worker de vendas separado consulta Jev e Hermes; o servidor revalida cada envio e usa adapters wacli/Resend. O módulo começa pausado e não matricula leads automaticamente.

**Tech Stack:** Node.js >=24, ES modules, node:sqlite, node:test, interface JavaScript existente; wacli CLI externo e APIs Hermes/Jev/Resend.

**Spec:** [Desenho aprovado](../specs/2026-10-03-hermes-vendas-design.md).

## Global Constraints

- Propostas e fechamento exigem aprovação humana da versão exata. Contato e acompanhamento podem ser automáticos dentro das regras configuradas.
- Não modificar aprovações de campanhas existentes nem o orçamento AISA/Apify.
- Nenhum envio real ou chamada paga durante os testes de implementação.
- Configurações e dados de outros projetos não serão reutilizados automaticamente.
- Não presumir que `sent: true` do wacli confirma entrega.
- Não ler `session.db`; recuperação SQLite, quando necessária, usa apenas `wacli.db` read-only com schema validado.
- Módulo inicialmente pausado; configuração de canais e orçamento obrigatória antes de iniciar.
- Não criar Git/worktree: este diretório não é um repositório Git. As etapas de commit são substituídas por registro de arquivos e verificações.

## Review Focus

1. Nova resposta enquanto o agente redige: a versão anterior não pode ser enviada (tarefa 2/5).
2. Dois workers e reinício durante envio: apenas um despacho; resultado incerto não pode ser repetido (tarefa 2/3).
3. Número pesquisado sem identidade WhatsApp validada: não iniciar conversa por inferência (tarefa 1/3).
4. Resposta de lead desconhecido ou múltiplas associações de e-mail: revisão manual, sem destinatário deduzido (tarefa 4).
5. Texto com preço/compromisso classificado como contato pelo modelo: servidor exige aprovação (tarefa 2/5).

## Arquivos e contratos

- `scripts/sales-policy.mjs`: validar configuração, elegibilidade e ações; não faz I/O.
- `scripts/sales-store.mjs`: operações transacionais usando o `DatabaseSync` recebido; configurações, conversas, mensagens, tarefas e aprovações.
- `scripts/sales-api.mjs`: `createSalesApi({db, getLead, putLead, audit, emailSettings, sendEmail, sendWhatsapp})`, retornando `{state, dispatch}`. `dispatch(method,p,b,role)` retorna `undefined` quando a rota não pertence ao módulo.
- `scripts/wacli-client.mjs`: execução CLI sem shell; `createWacliClient({binary,account,store,execFileImpl})` retorna `{health,send,listMessages}`.
- `scripts/sales-email.mjs`: `createSalesEmailClient({key,baseUrl,fetchImpl})` retorna `{send,listReceived,getReceived}`.
- `scripts/sales-decide.mjs`: `decideSale(context,{key,maxCostUsd})` retorna `{action,intent,objection,confidence,costUsd,providerId}`; contrato Jev verificado antes de codificar parser.
- `scripts/hermes-sales.mjs`: `draftSale(context,{url,key,fetchImpl})` retorna `{body,subject,terms,costUsd,providerId}` por API real Hermes.
- `scripts/sales-worker.mjs`: `runSalesCycle({api,decide,draft,readWhatsapp,readEmail})`; modo `--once` e contínuo serial.
- `run-sales.sh`: wrapper local de worker, token fora de logs.
- `server.mjs`: registrar módulo e adicionar `sales` ao `/api/state`; preservar rotas existentes.
- `public/app.js` e `public/style.css`: painel Vendas, conversas, configuração e aprovações.
- `tests/sales-*.test.mjs`, `tests/wacli-client.test.mjs`: testes isolados; `README.md`, `.env.example`, `docs/INTEGRACAO.md`, `docs/PROMPT_HERMES.md`: configuração/contratos.

## Task 1: Configuração e ingresso de leads

**Files:** criar policy/store/API e `tests/sales-api.test.mjs`; modificar `server.mjs`.

**Interfaces:** configurações em `settings/sales`; conversas `salesConversations` com `{id,leadId,channel,recipient,status,version,createdAt,nextActionAt}`. `/api/sales/settings` GET/PATCH admin; `/api/sales/conversations` POST admin com `{leadIds,channel}`; `/api/sales/conversations/:id/pause` POST admin. Estado `{settings,conversations,messages,decisions,approvals,costs,connection}`.

- [x] Escrever fixture de servidor temporário conforme `tests/prospecting.test.mjs`, com `CRM_DATA_DIR` e `HERMES_ENV_FILE` temporários. Criar lead pelo endpoint atual e importado via claim/complete para testar a origem Hermes.
- [x] Escrever e executar testes vermelhos para configuração pausada, admin-only, origem importada, bloqueio, endereço ausente e ingresso idempotente. Exemplo no fixture:

```js
test('vendas começa pausado e configuração é admin-only', async()=>{
 const s=await req('/state');
 assert.equal(s.data.sales.settings.enabled,false);
 const r=await req('/sales/settings','PATCH',{enabled:true},agent);
 assert.equal(r.status,403);
});
```

- [x] Implementar configurações validadas: `enabled=false`, empresa/ofertas/portfólio, horário/fuso, limites por canal, intervalo e máximo de follow-ups, orçamento diário e tetos por chamada. Zero orçamento não permite AI paga; nenhum valor comercial presumido. URLs externas apenas HTTP(S); conta/path/binário wacli são configuração admin, sem shell.
- [x] Implementar ingresso explícito. E-mail usa endereço válido do lead; WhatsApp exige destinatário normalizado e confirmação admin de canal verificado. Repetição não cria conversa/tarefa duplicada. Criação de pesquisa não ingressa leads.
- [x] Executar `node --test tests/sales-api.test.mjs`; registrar arquivos e verificações nesta tarefa.

## Task 2: Aprovação versionada e outbox

**Files:** policy/store/API; `tests/sales-policy.test.mjs`, ampliar `tests/sales-api.test.mjs`.

**Interfaces:** ações `qualificar`, `responder`, `acompanhar`, `propor`, `fechar`, `pausar`, `humano`. Mensagens `{id,conversationId,channel,direction,body,subject,kind,terms,conversationVersion,status,providerId,createdAt}`; termos `{service,price,currency,deadline,conditions}`. Aprovação `{id,messageId,version,status,approvedBy,approvedAt}`. Agente: `/api/agent/sales/tasks/claim`, `/api/agent/sales/tasks/:id/progress|draft|fail`, `/api/agent/sales/messages/:id/send`. Admin: `/api/sales/messages/:id/approve|reject`. Lease obrigatório nos endpoints de tarefas; envio revalida conversa/versão.

- [x] Testar política antes da implementação:

```js
test('termos comerciais sempre exigem aprovação',()=>{
 assert.equal(requiresApproval({kind:'responder',body:'Valor: R$ 900',terms:{}}),true);
 assert.equal(requiresApproval({kind:'propor',body:'Proposta',terms:{}}),true);
 assert.equal(requiresApproval({kind:'fechar',body:'Confirmar contratação',terms:{}}),true);
});
```

- [x] Implementar `requiresApproval(message)` na policy. `propor/fechar`, termos preenchidos, valores, descontos, prazos e compromissos comerciais conservadoramente detectados exigem revisão. Para contato automático, restringir a geração às perguntas de qualificação e respostas informativas sem termos; texto livre com ambiguidade segue para revisão. Não confiar na categoria atribuída pelo modelo.
- [x] Testar agente tentando aprovar, aprovação antiga, edição, resposta nova, pausa e bloqueio antes do despacho. Nenhum adapter deve receber chamadas nesses casos.
- [x] Reservar mensagem antes do `await` em transação. Status `pendente`, `aguardando_aprovacao`, `aprovada`, `processando`, `aceita`, `entregue`, `falhou`, `incerto`, `cancelada`. Resultado incerto não é retryable; aceite não equivale a negócio ganho.
- [x] Testar dois envios simultâneos e reinício forçado durante stub de envio. Reutilizar cotas/contagem de reservas Resend para impedir que vendas e campanhas ultrapassem juntas a cota global.
- [x] Executar testes de policy/API e `tests/email.test.mjs`; registrar verificações.

## Task 3: Transporte WhatsApp wacli

**Files:** `scripts/wacli-client.mjs`, `tests/wacli-client.test.mjs`; conexão do adapter à API.

**Interfaces:** `send({recipient,body}) -> {providerId,status:'aceita'}`; `listMessages({chat,after,limit}) -> mensagens normalizadas`; `health() -> {installed,authenticated,connected,version}` sem dados pessoais/segredos.

- [x] Consultar fonte upstream da versão fixada para JSON de send/list/doctor, flags de conta/store e paginação; guardar fixtures do contrato sanitizadas nos testes. Não copiar sessão de outro projeto.
- [x] Criar executável fake temporário que registra número de invocações e retorna envelope, em vez de tocar WhatsApp real. Testar saída inválida, timeout, autenticação ausente e sucesso:

```js
assert.deepEqual(parseSendResult({success:true,data:{sent:true,id:'msg-1'}}),
 {providerId:'msg-1',status:'aceita'});
assert.throws(()=>parseSendResult({success:true,data:{sent:true}}));
```

- [x] Implementar execução com `execFile`, `shell:false`, `timeout`, `maxBuffer`, argumentos separados `--json send text --to recipient --message body --no-preview`, conta/store configurados e nenhum argv/conteúdo em logs. `parseSendResult` só aceita confirmação com ID; retorno ambíguo mantém outbox incerta. Falhas comprovadamente anteriores ao despacho podem ser retryable.
- [x] Implementar leitura só de chats privados matriculados, ignorando FromMe/grupos/canais/status. Validar versão antes de ligar transporte; API reporta instalação/pareamento pendentes.
- [x] Executar `node --test tests/wacli-client.test.mjs`; registrar verificações.

## Task 4: Recebimento e recuperação de respostas

**Files:** `scripts/sales-email.mjs`, store/API; `tests/sales-inbound.test.mjs`, `tests/sales-email.test.mjs`.

**Interfaces:** `/api/agent/sales/inbound` POST agente com `{channel,account,providerId,recipient,sender,body,receivedAt,threadId,fromMe}`; normalizar antes de persistir. Cursor persistente por canal/conta; identidade única por canal/conta/providerId. E-mail usa conta/endereço de Reply-To configurado, associação por thread e destinatário correspondente.

- [x] Testar replay e resposta desconhecida antes de implementar:

```js
const first=await req('/agent/sales/inbound','POST',event,agent);
const replay=await req('/agent/sales/inbound','POST',event,agent);
assert.equal(first.data.imported,true);
assert.equal(replay.data.imported,false);
```

- [x] Implementar deduplicação transacional; resposta incrementa versão da conversa, cancela follow-up e invalida rascunho/aprovação obsoletos. Eventos anteriores ao ingresso não geram resposta. Remetente desconhecido/associação ambígua vai para revisão e não cria tarefa de envio.
- [x] Implementar Resend send/list/get com fetch fakeável, Reply-To e cabeçalhos de thread documentados, limites e cursores. Modo de teste não muda a conversa para contatada em produção. Polling não exige expor o servidor local à internet.
- [x] Validar recuperação WhatsApp após reinício, lote maior que limite e timestamps iguais. Se CLI não oferece cursor sem perdas, adicionar `scripts/wacli-reader.mjs` read-only com schema verificado de `wacli.db` e cursor durável; nunca usar `session.db`. Ausência/incompatibilidade pausa leitura com motivo visível.
- [x] Testar pedidos de não contato e falha permanente cancelando sequências. Executar inbound/email tests; registrar verificações.

## Task 5: Jev, Hermes e ciclo de vendas

**Files:** `scripts/sales-decide.mjs`, `scripts/hermes-sales.mjs`, `scripts/sales-worker.mjs`, `run-sales.sh`; `tests/sales-worker.test.mjs`.

**Interfaces:** contexto `{lead,conversation,history,settings,task}`. Jev produz escolha de ação/intenção/objeção e confiança documentada; Hermes produz texto/assunto/termos. Worker lê estado privado por endpoint agente específico, sem receber tokens de admin ou poderes para aprovar.

- [x] Testar ciclo com stubs HTTP reais locais; fixture não carrega ambiente/contas reais. Cenário de proposta:

```js
await runSalesCycle({api,decide:async()=>decisionProposal,draft:async()=>proposal,
 readWhatsapp:async()=>[],readEmail:async()=>[]});
assert.equal((await api('GET','/api/agent/sales/state')).messages[0].status,
 'aguardando_aprovacao');
assert.equal(providerCalls.length,0);
```

- [x] Verificar contrato Jev via fontes oficiais/OpenRouter antes de implementar parser, incluindo campos `noul`, choice, confidence e custo. Não aceitar valores fora das opções/ranges nem fabricar decisão. Perguntas independentes: intenção, objeção e próxima ação; o servidor aplica permissões.
- [x] Conectar API autenticada Hermes por URL local configurada e key fora do navegador. Confinar ferramentas: geração não pode usar send_message/terminal ou caminhos alternativos para enviar. Se API instalada não permite restringir ferramentas por solicitação, usar perfil Hermes comercial dedicado com toolset restrito e validar antes de habilitar.
- [x] Reservar orçamento persistente separado por tarefa antes de Jev/Hermes. Custo ausente permanece incerto; falha não libera reserva sem confirmação. Nenhuma chamada paga sem teto/orçamento. API mantém cálculo financeiro e permissões.
- [x] Implementar loop serial: recuperar inbound, claim elegível, progress/reserve, decide, draft, submit/send elegível, persistir custo/resultado. Revalidar versão no draft e no send. Erro de integração pausa conversa com motivo, sem chamar outro modelo silenciosamente.
- [x] Testar orçamento insuficiente, resultado Jev inválido, Hermes indisponível, resposta concorrente, lease expirado, intervalo/limite de follow-up, horário America/Sao_Paulo e follow-up interrompido por resposta. `run-sales.sh` resolve token sem imprimir segredo e suporta `--once`.
- [x] Executar `node --test tests/sales-worker.test.mjs`; registrar verificações.

## Task 6: Painel e entrega operacional

**Files:** `public/app.js`, `public/style.css`, `tests/ui-state.test.mjs`; README, INTEGRACAO, VALIDACAO, PROMPT_HERMES e `.env.example`.

**Interfaces:** navegação Vendas; configuração/iniciar/pausar; seleção explícita de leads; conversa detalhada e resposta manual; revisar/editar/aprovar/rejeitar proposta/fechamento; conexão/custos/erros; atualização preservando formulário em edição.

- [x] Adicionar testes HTML para aprovação e indisponibilidade:

```js
const html=render('sales',fixture);
assert.match(html,/Propostas e fechamento/);
assert.match(html,/Aguardando aprovação/);
assert.match(html,/wacli não instalado/);
```

- [x] Implementar controles usando componentes e estilos atuais. Escapar texto de leads/modelos/mensagens; apresentar status aceito e entregue separadamente. Não mostrar detalhes internos ao cliente destinatário.
- [x] Documentar variáveis e comando de worker; instalação wacli fixada, conta própria e autenticação por QR pelo usuário; configurar Jev, API Hermes e recebimento Resend; campos comerciais preenchidos no painel. Remover do prompt a regra antiga de aprovação de todo contato somente no escopo comercial autorizado, mantendo propostas/fechamento.
- [x] Executar `npm test`, syntax checks dos arquivos modificados e `zsh -n run-sales.sh`. Inspecionar painel no navegador quando disponível; declarar limite se a inspeção visual não puder ser executada.
- [x] Antes de reload local, verificar ausência de envios/jobs em execução. Preservar env/cmd do servidor; não ligar módulo comercial nem enviar mensagem de teste real automaticamente. Pareamento depende do telefone do usuário, e teste de entrega depende de destinatário controlado informado por ele.
- [x] Registrar resultado, canais realmente conectados, pendências de configuração e verificações. Nenhuma afirmação de fechamento/entrega real baseada só em testes simulados.

## Revisão do plano

O plano cobre configuração comercial, matrícula de leads, conversa, regras de aprovação, Jev/Hermes, wacli, Resend, custos, concorrência, interrupções, painel e verificação do desenho aprovado. Os cinco riscos de Review Focus têm testes atribuídos. APIs e funções compartilham os nomes definidos na seção de contratos. O método recomendado é execução nativa neste chat, pois store, políticas e worker dependem dos mesmos contratos; revisão final independente quando disponível.

Status: implementação e testes concluídos; revisão final e validação operacional em andamento.
