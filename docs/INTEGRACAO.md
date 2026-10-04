# Integração Hermes / Jev / AISA

## Vendas comerciais

Guia completo: [Vendas com Hermes](VENDAS-HERMES.md). Propostas/fechamento e texto livre exigem aprovação admin; templates controlados podem enviar automaticamente quando operação/canal estiverem habilitados. O módulo começa pausado.

| Método | Rota | Papel / finalidade |
|---|---|---|
| GET/PATCH | `/api/sales/settings` | Admin: configuração comercial |
| POST | `/api/sales/health` | Admin: diagnóstico sem geração paga |
| POST | `/api/sales/conversations` | Admin: ingresso explícito `{leadIds,channel,whatsappVerified}` |
| POST | `/api/sales/conversations/:id/pause`, `/resume` | Admin: assumir/retomar |
| POST | `/api/sales/conversations/:id/message`, `/inbound` | Admin: texto para revisão / resposta manual |
| POST | `/api/sales/conversations/:id/close` | Admin: `{outcome,evidence}` |
| POST | `/api/sales/messages/:id/approve`, `/reject`, `/edit` | Admin: versão obrigatória |
| POST | `/api/sales/messages/:id/send` | Admin: envio elegível, mesmas regras do agente |
| POST | `/api/sales/messages/:id/reconcile` | Admin: resultado de envio com evidência |
| POST | `/api/sales/costs/:id/reconcile` | Admin: custo confirmado com evidência |
| GET | `/api/agent/sales/state` | Agente: contexto comercial, sem chaves |
| POST | `/api/agent/sales/tasks/claim` | Agente: tarefa/contexto e lease |
| POST | `/api/agent/sales/tasks/:id/progress`, `/draft`, `/fail` | Agente: lease obrigatório |
| POST | `/api/agent/sales/messages/:id/send` | Agente: envio elegível, aprovação validada pelo servidor |
| POST | `/api/agent/sales/inbound` | Agente: resposta privada, deduplicada por canal/conta/ID |
| GET/POST | `/api/agent/sales/cursors/:id` | Agente: recuperação persistente |
| POST | `/api/agent/sales/heartbeat` | Agente: estado de execução |

As reservas comerciais são persistidas antes das chamadas Jev/Hermes. Custo ausente fica incerto. Nova resposta invalida rascunhos/aprovações antigos e interrompe follow-up. wacli retorna aceite com ID; entrega exige conferência adicional.

## Arquitetura proposta

O navegador acessa a API do CRM. O Hermes, executado em um worker separado, consome a fila e pesquisa pela AISA (Google Maps via DataForSEO). Se a busca falhar ou não retornar leads com fontes, aguarda a ativação da Apify pelo administrador. Consulta Jev para decisões delimitadas quando configurado. O worker retorna fontes e resultados ao CRM. O administrador revisa as campanhas.

O worker inclui adaptadores HTTP para Apify, AISA e Jev. A suíte verifica os contratos com rede simulada; isso não equivale a validação ao vivo das contas ou dos provedores.

## Autenticação

Todas as rotas `/api/` exigem `Authorization: Bearer TOKEN`.

- **admin**: painel, cadastros, pesquisas, edição e aprovação.
- **agent**: ler/cadastrar leads, atualizar contexto e etapas novo/qualificado, consumir pesquisas, relatar decisões e preparar/submeter campanhas.
- Agente não pode aprovar mensagens, acessar `/api/state`, alterar bloqueios, criar pesquisas com orçamento ou modificar tipos de lead.

Nunca forneça o token admin ao Hermes. Guarde o token agent e as chaves AISA/Jev em segredos do worker.

## Rotas implementadas

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/session` | Identifica o papel do token |
| GET | `/api/state` | Estado agregado do painel (admin) |
| GET | `/api/leads` | Lista de leads |
| POST | `/api/leads` | Cadastro manual ou pelo agente |
| PATCH | `/api/leads/:id` | Atualização parcial validada |
| POST | `/api/types` | Criação de tipo (admin) |
| PATCH | `/api/types/:id` | Edição/ativação (admin) |
| POST | `/api/campaigns` | Rascunho com destinatários existentes |
| PATCH | `/api/campaigns/:id` | Edita texto, exigindo versão atual; invalida aprovação |
| POST | `/api/campaigns/:id/submit` | Submete rascunho |
| POST | `/api/campaigns/:id/approve` | Aprova versão explícita (admin) |
| POST | `/api/campaigns/:id/reject` | Retorna para rascunho (admin) |
| POST | `/api/campaigns/:id/send` | Envia via Resend, somente admin, com aprovação e reservas |
| POST | `/api/prospecting/jobs` | Cria tarefa (admin) |
| POST | `/api/agent/jobs/claim` | Reserva a tarefa mais antiga por 15 minutos |
| POST | `/api/agent/jobs/:id/complete` | Importa resultados com fontes |
| POST | `/api/agent/jobs/:id/fail` | Registra falha, preserva custos e encerra a reserva |
| POST | `/api/agent/jobs/:id/progress` | Persiste custos/reservas e renova o lease por 15 minutos |
| POST | `/api/agent/jobs/:id/fallback` | Agente registra falha da AISA e aguarda decisão |
| POST | `/api/prospecting/jobs/:id/activate-apify` | Admin ativa a reserva com o saldo restante |
| POST | `/api/agent/decisions` | Registra avaliação relatada pelo worker |
| GET | `/api/integrations/apify` | Status da chave Apify, mascarada (admin) |
| POST | `/api/integrations/apify` | Grava/substitui a chave no `.env` do Hermes (admin) |
| DELETE | `/api/integrations/apify` | Remove a chave do `.env` do Hermes (admin) |

Erros têm o formato `{"error":"mensagem"}`. HTTP 400: validação; 401: autenticação; 403: papel/origem; 404: ausente; 409: conflito, duplicata, versão ou reserva; 429: cota diária insuficiente.

## Ciclo do worker

1. Configure `CRM_URL` e `CRM_AGENT_TOKEN` no ambiente.
2. Execute `node scripts/hermes-client.mjs claim`.
3. Se `job` for `null`, não há trabalho; aguarde conforme a política do worker.
4. Preserve `id`, `leaseToken` e `leaseUntil` retornados. Não exponha o token de reserva em relatórios públicos.
5. Aplique o limite de leads e o orçamento **antes** de chamar qualquer provedor. Orçamento zero impede chamadas cobradas.
6. Consulte o catálogo real da AISA, valide o recurso e o custo. Chame Jev somente quando uma decisão delimitada for necessária.
7. Pesquise e valide as fontes. Se faltar autenticação ou ferramenta, encerre com `fail`; não fabrique resultados. O worker real usa `scripts/aisa-search.mjs` como principal; `scripts/apify-search.mjs` só é usado após ativação explícita no painel. Nunca inventa empresas.
8. Envie `progress` antes e depois das etapas pagas; cada chamada renova a reserva por 15 minutos. Tarefas expiradas com custo, reserva financeira ou ID do provedor são encerradas com erro para conferência, sem repetir automaticamente o trabalho pago. Tarefas expiradas sem indícios de gasto podem ser retomadas.
9. Em timeout no retorno, consulte o estado com o administrador antes de repetir gastos. O endpoint rejeita nova conclusão de uma tarefa já concluída.

As reservas e importações são locais ao servidor. Uma futura execução com múltiplos processos/bancos exige fila e transações apropriadas.

### Criar tarefa (admin)

```json
{"niche":"Academias","city":"São Paulo, SP","limit":10,"budget":0}
```

### Concluir tarefa (agent)

Grave em um arquivo JSON e execute `node scripts/hermes-client.mjs complete ID arquivo.json`.

```json
{
  "leaseToken": "TOKEN_RETORNADO_POR_CLAIM",
  "actualCost": 0,
  "leads": [
    {
      "name": "NOME_REAL_PESQUISADO",
      "segment": "Academia",
      "city": "São Paulo, SP",
      "email": "",
      "phone": "",
      "website": "",
      "contact": "",
      "notes": "Fatos observados, hipóteses separadas e próxima ação.",
      "sources": [{"url":"https://example.com/substitua-por-fonte-real"}]
    }
  ]
}
```

O domínio acima é apenas ilustrativo. Não envie esse exemplo como lead real. A API valida o formato das URLs, não a veracidade da pesquisa.

Todos os resultados precisam de fontes. A importação é atômica: entrada inválida reverte o lote. Duplicatas são ignoradas e informadas no retorno. O custo efetivo é preservado inclusive se exceder o teto, sinalizando a violação do worker.

### Registrar avaliação (agent)

```json
{
  "leadId":"ID_REAL",
  "question":"Existe evidência suficiente de necessidade de um site?",
  "answer":"Insuficiente; verificar o domínio oficial antes de qualificar.",
  "model":"IDENTIFICADOR_REAL_RETORNADO_PELO_PROVEDOR",
  "provider":"PROVEDOR_REAL"
}
```

Não registre a resposta como produzida pelo Jev se ele não foi chamado. A origem é marcada como `relatado_pelo_worker`. Não há score ou confiança inventados.

### Campanha (agent ou admin)

```json
{"name":"Abordagem individual","subject":"ASSUNTO_REVISÁVEL","body":"TEXTO_EXATO","leadIds":["ID_REAL"]}
```

O corpo é texto puro, sem interpolação de variáveis. Para mensagens diferentes, crie rascunhos individuais. Não há substituição automática de `{{empresa}}`.

## Prospecção principal (AISA)

O adapter usa `https://mcp.aisa.one/mcp`, autenticação Bearer e a operação `post_dataforseo_serp_google_maps_live`. Inicializa a sessão, executa `use` com `max_price_usd` igual ao orçamento disponível e encerra a sessão. Envia uma tarefa com nicho e cidade em `keyword`, `language_code: pt`, `depth` igual ao limite de leads e contexto `location_name: Brazil` (configurável por `AISA_LOCATION_NAME`).

A resposta contém o envelope DataForSEO: o adapter valida `status_code` e `tasks[0].status_code`, inclusive em HTTP 200. Converte somente itens `maps_search` com nome e fonte verificável; usa a URL do Google Maps derivada do `place_id`, ou o site retornado. E-mail não é inventado.

Uma falha de busca ou ausência de resultados válidos leva a `aguardando_backup`. O worker não consome esse estado por `claim`. O administrador pode chamar `activate-apify`, que exige saldo suficiente e custo confirmado; marca `searchProvider: apify` e volta para `pendente`. A ação é auditada e uma repetição retorna 409. Nenhuma troca de provedor aumenta automaticamente o orçamento. Dados parciais válidos são importados; não disparam backup.

`searchProvider`, `aisaError`, `apifyActivatedAt` e `apifyActivatedBy` preservam a decisão. Leads importados também guardam `searchProvider`. O custo e a reserva da tentativa anterior acompanham a tarefa. Timeout ou cobrança incerta bloqueiam ativação até conferência administrativa.

O botão **Testar conexão** da AISA usa `get_details` com `with_quote: true`; autentica e obtém contrato/cotação sem chamar `use`. Referências oficiais: [busca Maps da AISA](https://aisa.one/docs/api-reference/dataforseo/post_dataforseo-serp-google-maps-live-advanced) e [MCP e limite por chamada](https://aisa.one/mcp).

## Prospecção de reserva (Apify)

Depois de ativação do administrador, `scripts/apify-search.mjs` consulta o Actor `compass~crawler-google-places` e devolve empresas reais (nome, categoria, endereço, telefone, site e a URL do Google Maps como fonte). O worker importa só o que veio da Apify — não há dados de exemplo.

- **Estimativa local**: US$ 0,005 por lugar + US$ 0,01 de início, usada somente para triagem. Não é cotação nem garantia de preço do provedor.
- **Orçamento obrigatório**: orçamento zero faz o worker recusar a tarefa (a regra do projeto impede chamadas cobradas com teto zero). Antes de chamar a Apify, o worker compara a estimativa com o teto e recusa se exceder. Também envia `maxTotalChargeUsd` à API e reserva esse valor no CRM antes da chamada.
- **Custo confirmado**: `actualCost` soma o `usageTotalUsd` devolvido pela Apify aos custos informados pelo Jev. `reservedCost` guarda valores ainda não confirmados; `costUncertain` sinaliza a pendência. Esses campos, `providerRunId` e `warnings` são aceitos em `progress`, `complete` e `fail`; campos omitidos em `fail` preservam o último progresso.
- **Token**: lido de `APIFY_API_TOKEN` no ambiente ou, se ausente, de `$HERMES_HOME/.env` — o mesmo arquivo gravado pela tela Integrações.
- **Falha honesta**: se a Apify falhar, expirar ou não retornar lugares, o job é marcado como `falhou` com a mensagem do erro. Nenhum resultado é simulado.

### Erros comuns

| Sintoma | Causa |
|---|---|
| Job fica preso em "executando" | O `fail` precisa enviar `leaseToken`, igual ao `complete`; sem ele a reserva não é liberada |
| `Cannot read properties of undefined` | O endpoint `/datasets/:id/items` devolve um array puro, não `{data:...}` |
| Tarefa recusada com "Orçamento zero" | A busca real é cobrada; informe um teto maior que zero |

## Integrações com chave

A tela **Integrações** grava cada chave em `$HERMES_HOME/.env` (padrão `~/.hermes/.env`), no servidor — nunca no navegador. Todas exigem papel **admin**.

| Serviço | ID | Variável no .env | Para que serve |
|---|---|---|---|
| Apify | `apify` | `APIFY_API_TOKEN` | Pesquisa real de empresas no Google Maps |
| AISA | `aisa` | `AISA_API_KEY` | Busca principal no Google Maps e enriquecimento opcional |
| Jev (TypeSafe) | `jev` | `TYPESAFE_API_KEY` | Decisões tipadas com probabilidade |
| Resend | `email` | `RESEND_API_KEY` | Envio real de e-mail após configuração e aprovação |

Rotas: `GET/POST/DELETE /api/integrations/:id` e `POST /api/integrations/:id/test`.

- O valor é validado antes de gravar: 8–400 caracteres, apenas `A-Za-z0-9_.:-`. Sem espaços, aspas ou quebras de linha, para não injetar linhas no `.env`.
- A escrita é atômica (temporário + `rename`), preserva as demais linhas e mantém a permissão `0600`.
- A API devolve só a versão mascarada (`apify_api_••••••1234`), nunca a chave completa.
- **`POST /test` faz uma chamada real ao provedor** com a chave gravada e devolve `{ok, detail}`. Ele não envia e-mail. O teste do Jev faz uma chamada que pode consumir crédito fora do orçamento de uma pesquisa: Apify usa `/users/me`, AISA uma cotação gratuita no MCP, Jev uma decisão trivial, Resend a listagem de chaves.
- Em testes, `HERMES_ENV_FILE` aponta o alvo para um arquivo temporário, evitando tocar no `.env` real.
- O plugin do Hermes lê a chave na inicialização: reinicie a sessão após trocar a da Apify.

### Jev (TypeSafe nativo)

A autenticação usa a chave nativa da TypeSafe (`TYPESAFE_API_KEY`). O endpoint é `POST https://api.typesafe.ai/v1/systemone` com `{model, state, questions}`. As perguntas são tipadas — `choice` (uma entre opções), `noul` (sim/não) e `score` (posição numa escala). A resposta traz a escolha e as probabilidades; não há texto nem justificativa. Modelo usado: `jev-latest`.

### AISA

Gateway em `api.aisa.one` que agrega Apollo, Oxylabs, DataForSEO e outros. O worker usa o enriquecimento de organizações da Apollo, com o domínio do site do lead como chave. Só preenche campos vazios.

## Controle de custo das etapas opcionais

Configure `AISA_MAX_COST_USD` e `JEV_MAX_COST_USD` no ambiente do worker ou no arquivo das integrações. São reservas locais máximas por chamada, não parâmetros enviados a AISA/TypeSafe. Sem valor positivo conhecido, chave ou saldo, a etapa é pulada e o motivo entra em `warnings`. Nenhum valor padrão é inventado. Use limites no provedor e valores conservadores; uma configuração subestimada não garante o teto externo.

O custo AISA não é confirmado pelo adaptador atual; sua reserva continua ocupando saldo. Jev só libera a reserva quando devolve um custo válido. Custo maior que a reserva interrompe etapas pagas seguintes. O worker persiste progresso antes da chamada, evitando que uma interrupção apague a reserva, e não sobrepõe ciclos locais.

Timeout na Apify solicita aborto do run e tenta recuperar o custo. Quando não houver confirmação de encerramento/custo, a reserva permanece a confirmar. Falhas posteriores na importação mantêm os valores conhecidos. Um erro ao registrar decisões depois da importação não muda uma tarefa concluída para falha.

## Envio de e-mail e recuperação

O servidor valida aprovação, versão, conteúdo e destinatários, e reserva todos os envios pendentes em transação SQLite antes de chamar o Resend. As reservas contam no limite diário. Teste e produção têm históricos separados; teste não encerra a campanha.

A outbox usa `processando`, `enviado`, `falhou` e `incerto`. Somente falha confirmada (`retryable: true`) permite nova tentativa automática pela rota de envio. Timeout, 5xx, resposta inválida e falhas históricas sem confirmação bloqueiam repetição. Em lote parcial, repetir envia somente aos destinatários que falharam de maneira confirmada.

Cada tentativa usa seu ID de outbox como `Idempotency-Key`. A chave é proteção adicional; o bloqueio persistente local continua após reinício. Não há reconciliação automática nem tela para liberar registros incertos. Confira o histórico no Resend e faça a recuperação por manutenção administrativa; não apague a outbox para forçar reenvio. O limite diário usa UTC.

Referências: [idempotência do Resend](https://resend.com/docs/dashboard/emails/idempotency-keys) e [limite de custo ao iniciar Actor na Apify](https://docs.apify.com/api/v2/actors-runs-post).

A aceitação pelo Resend não comprova entrega na caixa do destinatário. Webhooks de entrega e janela de envio ainda não estão implementados.

Exclusão comercial: `DELETE /api/sales/conversations/:id` é admin-only, exclusão lógica com cancelamento atômico, bloqueada durante chamadas/envios em andamento. Estado expõe `deletedConversations`; `POST /api/sales/conversations/:id/restore` restaura pausada, sem tarefas novas, e recusa conflito de lead/canal. Custos, histórico e reconciliação continuam disponíveis.
