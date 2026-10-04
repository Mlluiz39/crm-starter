# MLLUiz DevTech — Base de CRM

Base funcional **local**, inspirada nos prints fornecidos por Marcelo. Preparada enquanto o acesso aos repositórios `Mlluiz39/crm-leads` (front) e `Mlluiz39/crm-client` (back) está pendente.

Este pacote é um ponto de partida independente: não representa alteração nos repositórios existentes nem integração externa já concluída.

## Executar

Requer **Node.js 24 ou superior**. Não há dependências npm para instalar.

```bash
cd crm-starter
npm start
```

Abra **http://127.0.0.1:3080**. No primeiro início, o servidor cria `data/credentials.json` com dois tokens. Use o valor de `admin` na tela de entrada. O valor de `agent` é exclusivo para o worker do Hermes. Não compartilhe esse arquivo.

O token do navegador fica em `sessionStorage` e é removido ao sair. Os registros ficam no arquivo `data/crm.sqlite`, no servidor, e persistem entre reinicializações.

Configuração opcional:

```bash
cp .env.example .env
node --env-file=.env server.mjs
```

Se usar tokens próprios, configure **ambos**, diferentes, com pelo menos 24 caracteres. Não adicione `.env` ou `data/` ao Git.

## Funcionalidades disponíveis

- Dashboard: período, contagem real de leads, funil e atividades recentes.
- Leads: cadastro, edição, busca, detalhes, fontes, notas e bloqueio de contato.
- Exportação CSV com proteção contra fórmulas iniciadas nos campos.
- Pipeline com sete etapas: arraste os cartões entre as colunas (ou use o seletor do cartão), também acessível no celular.
- Clientes: listagem dos negócios marcados como ganhos.
- Tipos de lead: criar, editar, ativar e desativar.
- Prospecção: tarefas por nicho, cidade, quantidade e teto de custo em USD. O worker pesquisa empresas reais pela AISA (Google Maps via DataForSEO), usando o orçamento total como limite por busca. Se a AISA falhar ou não retornar leads válidos, oferece a Apify no painel e aguarda sua ativação.
- Campanhas: rascunhos, destinatários, edição, aprovação e envio real via Resend, com modo de teste e limite diário.
- Aprovações: controle exclusivo do administrador, vinculado à versão e ao conteúdo.
- Integrações: campo de chave para Apify, AISA, Jev (TypeSafe nativo) e Resend, gravada pelo servidor no arquivo de ambiente do Hermes (`$HERMES_HOME/.env`). Cada card abre um modal com salvar/trocar/remover e **Testar conexão**, que valida de verdade contra o provedor.
- Auditoria de operações e registro de decisões relatadas pelo worker.
- API e cliente de referência para integração com o Hermes.

A fonte principal é **AISA**. Na página Prospecção IA, uma falha mostra **“AISA falhou. Deseja ativar a Apify?”**, o motivo e o saldo. Clique em **Ativar Apify** para recolocar a mesma pesquisa na fila usando a reserva. Custos anteriores permanecem registrados; a Apify recebe apenas o saldo restante. Resultados parciais válidos da AISA são importados sem acionar a reserva.

A base inicia **sem leads de demonstração**. Nenhuma empresa é inventada. As pesquisas ficam pendentes até um worker autorizado consumir a fila.

## Limites desta entrega

- O worker consulta a AISA para enriquecer (Apollo Organizations) e o Jev para decidir a aderência de cada lead. As chaves ficam em `$HERMES_HOME/.env`. Essas etapas também exigem `AISA_MAX_COST_USD` e `JEV_MAX_COST_USD`, respectivamente, e saldo suficiente; sem isso, o worker pula a etapa e registra o motivo. Esses máximos são das etapas opcionais; a busca principal AISA usa diretamente o orçamento da tarefa.
- Não instala nem configura Hermes automaticamente. O cliente incluído permite que ele interaja com esta API após configuração.
- Envia e-mail real via Resend após configurar remetente, chave e aprovar a campanha. O modo de teste vem ligado por padrão e envia apenas ao endereço de teste; não encerra a campanha. Não envia WhatsApp ou Instagram.
- Não contém agenda, financeiro, contratos, catálogo, projetos, alunos ou tráfego pago. Os prints apenas mostravam alguns desses itens no menu; seu funcionamento e a estrutura do projeto original ainda precisam ser analisados.
- O dashboard não inventa receita, ticket médio, aberturas ou crescimento percentual.
- A busca AISA usa o gateway MCP com `max_price_usd` igual ao orçamento disponível. A chamada retorna dados e custo relatado; se a cobrança não for confirmada, mantém a reserva e bloqueia a ativação da Apify. Após autorização no painel, o worker envia `maxTotalChargeUsd` à Apify com o saldo restante. Para AISA/Jev, reserva antes de cada chamada o máximo por chamada configurado pelo operador; isso é um controle local, não um limite imposto por esses provedores. Configure valores conservadores conforme a cobrança do serviço e limites na conta do provedor. Custos não confirmados mantêm a reserva; custos conhecidos são preservados inclusive em falhas. A API não controla workers externos que ignorem esse protocolo.
- A API aceita avaliações declaradas pelo worker; isso não comprova que Jev foi realmente chamado. Preserve evidências e identificadores do provedor na integração definitiva.
- Esta base usa HTML/CSS/JavaScript modular e Node/SQLite para rodar sem instalação de pacotes. Quando houver acesso ao código original, portar os componentes e contratos para a stack existente, preservando suas dependências.
- Autenticação por tokens locais; sem contas, recuperação de senha, rate limiting, revogação por sessão ou multiempresa. Antes de exposição pública, integrar autenticação do backend existente, HTTPS, política de retenção, rate limiting, testes e backups.

## Arquivos

```text
public/                 Interface e identidade visual
server.mjs              Servidor, regras de negócio e persistência SQLite
scripts/hermes-client.mjs Cliente CLI para o worker
scripts/aisa-search.mjs   Busca principal na AISA (MCP com limite de preço)
scripts/apify-search.mjs  Busca de reserva na Apify (Google Maps Scraper)
scripts/enrich-decide.mjs Enriquecimento (AISA) e decisão (Jev) por lead
scripts/ui-smoke.cjs     Teste opcional de navegador (requer Playwright + Chromium)
tests/api.test.mjs       Testes de API e regras de aprovação
tests/apify.test.mjs     Testes da chave Apify (validação, gravação e remoção)
docs/INTEGRACAO.md       Contratos HTTP e fluxo do agente
docs/CONTINUAR_NO_CODEX.md Contexto para adaptar os repositórios existentes
PROMPT_HERMES.md         Prompt comercial elaborado nesta conversa
```

## Testar

```bash
npm test
```

Os testes usam banco temporário e não enviam mensagens nem consultam serviços externos. Verificam autorização, validação, duplicatas, bloqueios, versões, invalidação de aprovação, envio simulado, concorrência, repetição após falha, separação de teste/produção, reservas de tarefas e orçamento e importação atômica com fontes.

Os testes de Apify gravam em um arquivo temporário (`HERMES_ENV_FILE`), nunca no `.env` real do usuário.

Consulte `docs/VALIDACAO.md` para os cenários verificados. Os testes do worker substituem a rede e os testes de e-mail usam um servidor local simulando o Resend; não há cobrança nem envio real na suíte.

## Vendedor Hermes — WhatsApp e e-mail

O painel **Vendas Hermes** organiza conversas dos leads prospectados, decisões Jev, rascunhos, aprovação de propostas/fechamento e envio por wacli/Resend. Começa pausado e recebe leads por seleção explícita. Contatos/acompanhamentos usam templates controlados; texto livre entra em revisão. O orçamento comercial é separado da prospecção.

Leia [o guia de vendas](docs/VENDAS-HERMES.md) para parear WhatsApp, iniciar Hermes isolado, configurar Jev/Resend e rodar `./run-sales.sh`.

## Configurar custos da prospecção

No ambiente do processo do worker ou no mesmo arquivo `$HERMES_HOME/.env` das integrações, defina `AISA_MAX_COST_USD` e `JEV_MAX_COST_USD` com valores positivos em USD por chamada, baseados na cobrança contratada. Não há valores padrão presumidos. `HERMES_ENV_FILE` permite apontar explicitamente esse arquivo tanto no servidor quanto no worker. A busca principal não exige um máximo adicional: usa o orçamento da tarefa. O contexto geográfico padrão é Brasil, com nicho e cidade na consulta; `AISA_LOCATION_NAME` permite definir outro contexto aceito pelo DataForSEO.

O painel separa custo confirmado de reserva **a confirmar**. A busca AISA registra o custo retornado pelo MCP; quando não há confirmação, mantém a reserva. O enriquecimento opcional AISA não informa custo confirmado no contrato consumido, portanto sua reserva continua ocupando orçamento. Jev libera a reserva quando informa um custo válido. Se o Jev exceder o máximo configurado, o worker interrompe as próximas chamadas pagas. Pesquisas sem resultado também conservam o custo já incorrido.

## Executar a prospecção

Com o servidor iniciado, execute `./run-hermes.sh --once` para consumir uma pesquisa, ou `./run-hermes.sh` para manter o worker contínuo. Ele lê o token do agente de `data/credentials.json` quando `CRM_AGENT_TOKEN` não estiver definido. A AISA usa a chave já salva em Integrações; **Testar conexão** valida autenticação e cotação sem realizar busca paga. Uma ativação de Apify é processada na próxima execução do worker. A página atualiza o acompanhamento a cada cinco segundos enquanto houver tarefa na fila ou em execução, preservando formulários em edição.

As buscas são cobradas pelos provedores quando executadas. A integração foi validada com respostas simuladas e uma cotação gratuita; a consulta paga não foi executada durante o desenvolvimento.

## Recuperação de envios

- Falha confirmada permite repetir o envio da mesma versão, somente para destinatários que ainda não receberam.
- Resultado incerto (timeout, conexão perdida, resposta ambígua) bloqueia repetição. Confira o Resend antes de qualquer recuperação. A caixa de saída guarda o ID da tentativa, enviado como chave de idempotência.
- Reservas em processamento permanecem no banco após reinício e também bloqueiam repetição. Não apague esses registros para tentar novamente: ainda não há uma tela de reconciliação; a recuperação exige conferir o provedor e ajustar o registro por manutenção administrativa.
- Falhas antigas, sem a marcação de falha confirmada, também exigem conferência. Campanhas antigas encerradas por um teste não são reabertas automaticamente; revise o histórico antes de preparar uma nova versão.
- Testes e produção têm registros separados. Um teste conta na cota diária, mas preserva a aprovação para produção. A cota usa o dia UTC e inclui reservas pendentes, inclusive de dias anteriores.

## Backup local

Pare o servidor antes de copiar a pasta `data/` inteira para um local protegido. Com o servidor ativo, use uma rotina de backup compatível com SQLite/WAL. Não copie somente o arquivo principal enquanto o processo estiver gravando.
