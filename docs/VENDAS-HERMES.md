# Vendas com Hermes, Jev, wacli e Resend

O painel **Vendas Hermes** organiza conversas dos leads manuais e prospectados. Hermes redige e Jev avalia intenção, objeção e próxima ação; o CRM controla destinatários, orçamento, versões, aprovações e transporte.

**Propostas e fechamento exigem aprovação.** Abordagens e acompanhamentos usam templates do servidor com identificação da empresa. Texto livre, inclusive mensagem manual, passa pela revisão: um modelo não pode liberar um compromisso comercial apenas classificando o texto como contato.

O módulo começa pausado e o ingresso é explícito. Criar uma pesquisa AISA/Apify não inicia contato.

## WhatsApp

Foi instalado **openclaw/wacli 0.20.0** em `.tools/wacli-0.20.0/wacli`, com checksum SHA256 verificado. A sessão comercial usa `data/wacli-sales`, sem copiar sessões de outros projetos. Os caminhos podem ser alterados nas configurações de Vendas.

Com o servidor iniciado, execute:

```sh
./pair-sales-whatsapp.sh
```

No telefone, abra WhatsApp → Dispositivos conectados → Conectar dispositivo e escaneie o QR do terminal. Depois mantenha a sincronização:

```sh
./run-sales-whatsapp-sync.sh
```

O CRM lê apenas `wacli.db`, em modo leitura, validando schema e cursor por rowid; nunca lê `session.db`. Importa somente mensagens privadas dos leads selecionados. Ignora grupos, status e mensagens do próprio agente. IDs deduplicam a importação e o cursor só avança após persistência.

Aceite com ID não equivale a entrega. Recibos de entrega não são importados automaticamente nesta versão; confirme com evidência pela reconciliação na conversa. Resultado incerto não permite reenvio automático.

## Hermes comercial e Jev

Foi preparado um perfil privado separado em `data/hermes-sales`. `config.yaml` aceita JSON e YAML (o Hermes pode regravá-lo como YAML), ferramentas `api_server: [no_mcp]`, sem MCP/plugins. A autenticação do modelo existente foi copiada privadamente, sem vínculo com o arquivo original. A chave da API local foi gerada e não vai ao navegador.

```sh
./run-sales-hermes.sh
```

API padrão: `http://127.0.0.1:8642`. Se necessário, reautentique o modelo no perfil isolado:

```sh
HERMES_HOME="$PWD/data/hermes-sales" hermes model
```

Preserve ferramentas/MCP desabilitados. O adapter bloqueia geração quando o perfil ou a API anuncia ferramentas habilitadas. Hermes não tem caminho alternativo de envio.

Configure Jev/TypeSafe em **Integrações → Jev**. Não cole chaves no chat. O contrato é `POST https://api.typesafe.ai/v1/systemone`. Jev devolve decisões tipadas; não escreve mensagens nem aprova propostas.

## E-mail

Configure a chave em **Integrações → E-mail**. Habilite recebimento no Resend e informe o endereço em **Reply-To** nas configurações comerciais. O worker consulta a API de recebimento, filtra a caixa e os remetentes selecionados, importa em ordem cronológica e salva cursor. Mensagens sem texto ou remetentes não matriculados não iniciam atendimento; registre manualmente respostas quando necessário. Respostas usam o Message-ID recebido quando disponível.

Modo de teste e cota global de e-mail são preservados. Teste não marca contato de produção. A cota inclui campanhas e vendas, inclusive reservas incertas; a cota global de e-mail usa UTC, a cota comercial por canal usa o fuso configurado.

## Configurar e iniciar

1. Em **Vendas Hermes → Configurar vendas**, preencha empresa, vendedor, oferta, portfólio real e condições permitidas. Sem preços/prazos informados, Hermes não pode inventá-los.
2. Defina orçamento diário de IA e tetos Jev/Hermes em USD. São reservas locais, não limites impostos às contas: configure limites nos provedores também. O orçamento comercial é separado de AISA/Apify. Reservas incertas continuam ocupando saldo no dia seguinte.
3. Defina canais, horário/fuso, limite diário por canal, intervalo e máximo de acompanhamentos.
4. Use **Verificar conexões**. Chave presente ou endereço informado não comprova entrega/recebimento real.
5. Selecione **Selecionar leads** e o canal. Para WhatsApp, confirme que os telefones são canais das empresas.
6. Use **Iniciar vendas** e mantenha o worker:

```sh
./run-sales.sh
# Ou um ciclo:
./run-sales.sh --once
```

O ciclo é serial, a cada 30 segundos. Propostas aprovadas são enviadas pelo worker no horário autorizado; o painel permite enviar explicitamente a versão aprovada também.

Na conversa, revise/edite/aprove/rejeite mensagens, pause/assuma atendimento, registre respostas e registre ganho/perda com evidência. Editar ou receber resposta invalida a aprovação antiga. Recusa/pedido de não contato bloqueia o lead e interrompe sequências. Resposta cancela o acompanhamento agendado.

Pausa impede novos despachos; envio já entregue ao provedor pode terminar e permanece registrado. Envios incertos exigem conferência antes de retomar. **Conferir custos pendentes** permite registrar a cobrança com evidência quando a API não informou `usage.cost`. A reserva não é declarada como gasto confirmado.

## Operação e limites

- `CRM_URL`/`CRM_AGENT_TOKEN`: worker; wrapper lê token local sem imprimir.
- `HERMES_ENV_FILE`/`HERMES_HOME`: chaves das integrações existentes.
- `HERMES_SALES_HOME`: perfil isolado; padrão `data/hermes-sales`.
- `HERMES_SALES_API_KEY`: substituição opcional da chave local gerada.
- Conta, binário/store wacli e URL Hermes: configuração admin.

Conversas, tarefas, mensagens, custos, decisões, cursores e aprovações ficam no SQLite atual, em registros separados. Proteja perfil/sessão/backups e não apague dados para liberar uma reserva.

Os testes substituem CLI/provedores: nenhum WhatsApp, e-mail ou chamada paga real. O teste operacional depende do telefone pareado e de destinatário controlado escolhido pelo usuário. Diferencie código validado, canal autenticado e entrega real.

- [wacli](https://github.com/openclaw/wacli)
- [Contrato Jev/TypeSafe](https://api.typesafe.ai/redoc)
- [Recebimento Resend](https://resend.com/docs/dashboard/receiving/introduction)

Leads manuais também podem ser selecionados para atendimento, mantendo a origem do cadastro. Leads bloqueados ficam fora da seleção; validações de e-mail e WhatsApp se aplicam a todos.

Jev usa a chave nativa `TYPESAFE_API_KEY`, modelo `jev-latest` (a versão devolvida é registrada). O teste consulta `GET /v1/models` sem gerar decisão. A API informa tokens, mas não custo em USD; por isso a reserva fica pendente até conferência, sem conversão presumida de tokens em cobrança.

## Excluir conversas

Use **Excluir conversa** no cartão ou no histórico. Após confirmação, a conversa sai da lista ativa, tarefas e mensagens pendentes são canceladas e o lead permanece cadastrado. A exclusão é lógica: histórico, custos e registros de transporte permanecem para auditoria e conferência.

Abra **Conversas excluídas** para consultar o histórico, conferir envios incertos ou restaurar. Restaurar mantém a conversa pausada, sem iniciar novas mensagens. Chamadas/envios em andamento impedem exclusão. Um envio incerto impede criar outra conversa no mesmo canal/destinatário até ser conferido.

## Orçamento mensal e Hermes incluído

Configure **Período do orçamento: Mensal** e **Orçamento mensal: US$ 3**. O orçamento soma gastos informados e custos calculados dos serviços cobrados por uso no mês do calendário, no fuso escolhido. Reservas incertas de meses anteriores continuam descontadas até conferência.

Marcar **Hermes incluído no meu plano** exclui gerações Hermes do orçamento e registra novas chamadas como incluídas (sem cobrança adicional informada pelo operador). Reservas antigas ficam preservadas no histórico, mas não consomem o orçamento Jev quando essa configuração está ativa. Se o provedor cobrar por uso, desmarque a opção e configure o teto Hermes.

Jev é fixado em `jev-1.13.0`. A tarifa oficial consultada em 03/10/2026 é US$ 0,042 por milhão de tokens de entrada, saída grátis: https://docs.typesafe.ai/models. Quando o provedor informar tokens dessa versão sem custo USD, o CRM registra `estimatedUsd`, tokens e origem da tarifa como **calculada**, liberando a reserva. Isso não é confirmação de fatura. Sem tokens válidos ou versão tarifada conhecida, a reserva permanece incerta. O orçamento é controle local; não altera limites no provedor.

`dailyLimit: 0` desativa o teto local de mensagens comerciais; a cota global de e-mail continua aplicável. Para atendimento 24 horas, use início 0 e final 24. Recusas, bloqueios e revisão humana continuam pausando conversas; propostas e fechamento continuam aguardando aprovação.
