# Validação das correções — 03/10/2026

## Executado

- `npm test`: **115 testes passaram, zero falhas**.
- `node --check`: sintaxe verificada no servidor, interface, scripts e testes; `zsh -n run-hermes.sh` também passou.
- Os novos testes principais foram executados antes das correções e reproduziram os defeitos de concorrência, repetição, modo de teste, decisões e custos.

## Cenários cobertos

- Autenticação, autorização, validação, deduplicação e importação atômica.
- E-mails simultâneos da mesma campanha sem duplicação.
- Cota diária considerando reservas de outras campanhas ainda em processamento.
- Repetição após falha confirmada e lote parcial sem repetir destinatários já enviados.
- Teste seguido de produção, inclusive usando como teste o endereço de um lead.
- Conexão perdida e falhas históricas sem confirmação bloqueiam repetição.
- Edição durante o envio preservada e restante do lote interrompido.
- Interrupção forçada do servidor de teste durante uma chamada ao provedor: após reinício, reservas continuam no SQLite e bloqueiam duplicação.
- Worker consumindo o array de leads e registrando decisões.
- Orçamento encaminhado à Apify, etapas opcionais puladas sem saldo/custo máximo conhecido e reserva separada do gasto confirmado.
- Custos conservados em pesquisa sem resultados, falha da Apify e falha na importação.
- Progresso renova lease; tarefa expirada com indício de gasto não é repetida automaticamente.
- Renderização dos textos de estado: processamento, resultado incerto, reserva a confirmar e avisos da prospecção.
- AISA como fonte principal, usando o orçamento disponível como teto da chamada MCP.
- Falha da AISA pausa a pesquisa e apresenta a opção de ativar a Apify; nenhuma troca automática de provedor.
- Ativação da Apify restrita ao administrador e ao saldo restante, bloqueada quando há custo incerto ou reserva pendente.
- Respostas MCP em JSON/SSE, erros de negócio mesmo com HTTP 200 e preservação do custo da tentativa anterior.

## Isolamento e limitações

Os testes usam bancos e arquivos de configuração temporários. O Resend é simulado por servidor HTTP local; no worker a rede é substituída por respostas controladas. Nenhum e-mail real foi enviado e nenhuma pesquisa paga foi executada. O banco e as credenciais de uso real não foram modificados pelos testes.

Os testes de interface verificam o HTML gerado, não layout visual nem interação completa em navegador. `scripts/ui-smoke.cjs` não foi executado nesta revisão. A chave e o contrato MCP da AISA foram validados ao vivo com uma cotação gratuita (`get_details`), sem executar `use`. A pesquisa paga e a conta da Apify não foram validadas ao vivo.

A revisão independente foi tentada, mas ficou indisponível por limite de uso. Foi realizada revisão local, acompanhada da suíte automatizada.

Servidor e worker precisam carregar as alterações. O teto da busca AISA é o orçamento disponível da pesquisa. Os máximos por chamada AISA/Jev do README se referem ao enriquecimento opcional; não foram presumidos valores nem alterado o ambiente real.

## Vendas Hermes

Validados aprovação com versão, invalidação após resposta/edição, envio concorrente, custos e reservas persistentes, opt-out, limite diário, recuperação WhatsApp por rowid e recebimento cronológico Resend. Templates automáticos e propostas foram testados com provedores simulados.

Verificação local confirmou wacli 0.20.0 instalado (sem pareamento), Hermes API conectado com ferramentas desabilitadas e worker comercial pausado. Jev não tem chave configurada; Reply-To e recebimento e-mail ainda precisam de configuração. Nenhuma geração paga ou mensagem real foi executada. Revisão independente indisponível por limite de uso; revisão local e 115 testes concluídos. Interface verificada por testes de renderização; sem validação visual completa em navegador.

Leads manuais: novos testes reproduziram a exclusão na lista e na API antes da correção. Validada matrícula por e-mail/WhatsApp, origem preservada, bloqueio e canal inválido impedidos.

Correção Jev nativo: confirmado contrato oficial TypeSafe em https://api.typesafe.ai/redoc e autenticação ao vivo com GET /v1/models (HTTP 200). Chave migrada para TYPESAFE_API_KEY, endpoint /v1/systemone e modelo jev-latest; versão respondida registrada como jev-1.13.0. Suíte 115 testes passou. Testes reproduziram transporte incorreto e bloqueio da segunda etapa após custo não informado. Reserva incerta de outro serviço continua no orçamento; chamadas simultâneas, repetição do mesmo serviço com custo pendente e orçamento insuficiente continuam bloqueados. Decisão real no lead de teste: qualificar, confiança 0,65.

Hermes live: rascunho de template inicio retornou terms como string vazia; normalização limitada a templates automáticos conhecidos testada, propostas continuam estritas. Rascunho e decisão reutilizados sem novas chamadas pagas. Tentativa WhatsApp no lead de teste ficou incerta, sem confirmação de envio; telefone do lead coincide com a conta pareada. Não houve repetição. Reservas incertas preservadas: Jev US$0,25 e Hermes US$2,75; não são gastos confirmados. Módulo pausado após demonstração.

Exclusão comercial: cinco novos cenários verificam cancelamento e preservação de histórico/custos, autorização, exclusão durante trabalho/envio em andamento, recebimento após exclusão, conflito ao restaurar, envio incerto e painel com exclusão/restauração. Suíte completa: 115 testes, zero falhas.

Orçamento mensal: seis novos testes cobrem configuração de Hermes incluído e envio sem teto local, orçamento agregando dias/estimativas/reservas, estimativa auditável por tokens, rejeição de preço presumido para modelo desconhecido, worker repassando metadados e painel de configuração. Suíte 115 passou; sintaxe validada. Configuração real ativada: Jev US$3/mês, teto por chamada US$0,01, Hermes incluído, WhatsApp 24h, dailyLimit 0. Worker ativo e recuperação de resposta real "Não nesse momento" levou a pausa por recusa com confiança 0,93; 1226 tokens, cálculo US$0,000051492. Nenhum envio adicional feito após recusa.
