# Hermes vendedor sênior — WhatsApp wacli e e-mail

## Objetivo e decisões do usuário

Transformar os leads prospectados em conversas comerciais acompanhadas pelo Hermes, com Jev auxiliando nas decisões de qualificação, interesse, objeção e próxima ação. O usuário autorizou abordagens, respostas e acompanhamentos automáticos. **Propostas e fechamento exigem aprovação humana.** O transporte WhatsApp escolhido é wacli, interpretando a grafia “waicli” como o projeto openclaw/wacli.

Sucesso significa: selecionar leads reais, acompanhar uma conversa por lead, registrar decisões reais do Jev, preparar mensagens com o Hermes e enviar pelos canais conectados, mantendo propostas e fechamento bloqueados até aprovação da versão exata. A aprovação não pode ser contornada pelo agente.

## Situação verificada

- O CRM tem SQLite, leads com origem e fontes, bloqueio de contato, funil, campanhas de e-mail aprovadas, outbox e registro de decisões.
- O worker atual executa prospecção AISA/Apify e avaliação opcional; ele não é uma instância do agente Hermes conversando com clientes.
- Existe instalação do Hermes e configuração de modelo. A instalação oferece API local `/v1/chat/completions`, mas a porta padrão 8642 não está aberta.
- Existe chave Resend configurada. Recebimento de e-mails ainda não está integrado ao CRM.
- A chave `OPENROUTER_API_KEY` não foi encontrada no arquivo de ambiente consultado. A ausência deve aparecer como pendência de configuração, sem solicitar segredos no chat.
- O binário wacli não foi encontrado no PATH. Outro projeto local contém um adapter de referência, mas sua configuração e dados não serão reutilizados automaticamente.

## Abordagem escolhida para revisão

Recomenda-se adicionar um módulo de vendas ao CRM e manter o servidor como responsável pelo estado e autorização. Hermes redige mensagens com contexto comercial; Jev retorna decisões tipadas; wacli e Resend executam o transporte. Reaproveitar os leads e o banco atual, sem substituir o fluxo AISA/Apify nem a aprovação das campanhas existentes.

Uma alternativa seria concentrar tudo em prompts e ferramentas do Hermes, com menos mudanças no CRM. Isso deixa aprovações, reinício e deduplicação dependentes do agente. A alternativa de construir um CRM separado duplicaria leads e histórico. O módulo integrado atende melhor ao objetivo.

## Configuração comercial

Adicionar painel de Vendas com: nome do vendedor/empresa, serviços oferecidos, descrição das ofertas, portfólio verificado, condições de proposta, preços e prazos permitidos, canais habilitados, horário e fuso, limite diário de mensagens, intervalo e quantidade máxima de acompanhamentos, orçamento das decisões/geração e teto por chamada.

Autonomia fixa neste escopo: contato e acompanhamento automáticos; proposta e fechamento por aprovação. Não inventar valores, descontos, garantias, cases ou prazos. Sem oferta comercial suficiente, o agente pode qualificar necessidades, mas não gerar proposta com termos inventados.

O módulo nasce pausado. O administrador seleciona os leads prospectados que entrarão no atendimento e inicia a operação após configurar canais e limites. Criar uma pesquisa de prospecção não envia mensagens por si só. Leads bloqueados e canais sem endereço disponível não entram na fila. O sistema não deduz que um telefone é WhatsApp apenas porque foi encontrado na pesquisa.

## Dados e interface

Usar registros aditivos no SQLite existente para configurações de vendas, conversas, mensagens, tarefas, decisões comerciais e aprovações. Cada conversa aponta para um lead e preserva os dados usados nas decisões.

O painel mostra: conversas ativas, aguardando cliente, aguardando aprovação, pausadas, ganhas e perdidas; histórico por canal; texto enviado/recebido; status do provedor; próxima ação; custo confirmado e reserva; decisões Jev e confiança quando retornada. O operador pode pausar um atendimento e assumir a conversa.

Propostas exibem destinatário, canal, texto, serviço, preço, prazo e condições, com versão. Aprovar libera somente esse conteúdo; editar ou receber resposta que torne o contexto obsoleto invalida a aprovação. Fechamento também tem ação e versão explícitas. Aceitar uma proposta não comprova pagamento nem autoriza assumir obrigações adicionais.

## Ciclo do vendedor

1. Buscar uma tarefa elegível, reservar orçamento e obter lease persistente.
2. Carregar lead, fontes, oferta, histórico, última mensagem e regras configuradas.
3. Consultar Jev sobre questões delimitadas: intenção do cliente, objeção principal, próxima ação e necessidade de intervenção.
4. Validar resultados tipados. Resposta inválida ou indisponibilidade pausa a decisão e informa o motivo; não fingir que Jev respondeu.
5. Solicitar ao Hermes o texto adequado à ação usando sua API local autenticada. Restringir a execução ao contexto e ferramentas necessárias; o agente não deve ter caminho de envio que ignore a autorização do CRM.
6. Validar a mensagem no servidor. Uma mensagem não vira contato automático só porque o modelo a classificou assim: propostas, valores e compromissos passam pelo fluxo de aprovação; a geração automática de contato usa ações e formatos restritos à qualificação e ao acompanhamento.
7. Salvar rascunho/outbox antes de enviar. Contato e acompanhamento permitidos são despachados; proposta e fechamento ficam aguardando aprovação.
8. Registrar aceite, entrega, falha ou incerteza do provedor e agendar próximo passo. Não repetir envio incerto automaticamente.

O Jev não escreve mensagens. O Hermes não decide permissões. Conteúdo recebido é contexto não confiável e não pode aprovar propostas, modificar regras ou revelar segredos.

## WhatsApp com wacli

Configurar caminho do binário e conta/diretório de estado exclusivos para o atendimento comercial. Instalação e pareamento são passos operacionais; o usuário precisa vincular seu telefone pelo QR Code. Não copiar sessões de outros projetos.

Executar comandos por processo filho, sem shell, com argumentos separados, timeout e saída limitada. O comando de envio documentado é `wacli --json send text --to ... --message ...`; a versão instalada deve ser fixada e seu contrato validado antes de habilitar o transporte.

Exigir envelope de sucesso, `sent: true` e ID retornado. Isso representa aceite do envio, não entrega. Falha ambígua conserva a outbox para reconciliação, sem retry automático. Receber somente mensagens privadas dos leads atendidos; ignorar grupos, status e mensagens do próprio agente para não criar loops.

Manter sincronização e importar mensagens locais com cursor persistente e deduplicação por conta/ID. Usar JSON documentado; se recuperação exigir SQLite, acessar somente `wacli.db` em modo leitura, validar o schema da versão e nunca abrir `session.db`. Não depender exclusivamente do webhook best-effort. Histórico anterior ao início da conversa não dispara respostas automáticas.

## E-mail com Resend

Reaproveitar a integração Resend e os controles existentes, preservando o modo de teste e limite diário. Mensagens comerciais individuais terão autorização própria, sem alterar retroativamente as campanhas já aprovadas.

Receber respostas pela API de recebimento Resend em um endereço/domínio configurado, com polling persistente para o servidor local. Associar por identificadores de thread/endereços previamente vinculados; remetente desconhecido ou associação ambígua aguarda revisão. Configurar Reply-To correspondente ao endereço de recebimento. Se o recebimento não estiver configurado, informar a limitação e permitir registro manual da resposta, sem simular atendimento automático completo.

## Custos, concorrência e interrupções

O orçamento comercial é separado do orçamento AISA/Apify. Sem orçamento/tetos configurados, não fazer chamadas pagas. Reservas devem ser persistidas antes das chamadas; custo não confirmado mantém reserva e impede repetição automática. Nunca presumir que o modelo configurado permanece gratuito.

Processar uma ação por conversa, validar versão antes do despacho e revalidar bloqueio/pausa antes de cada mensagem. Uma resposta interrompe o acompanhamento agendado; recusa ou pedido de não contato pausa o atendimento e bloqueia novos envios. Falha permanente encerra a sequência daquele canal. Após reinício, recuperar tarefas pendentes e conservar operações com resultado incerto.

## Validação

Testes com Hermes, Jev, Resend e executável wacli simulados; nenhum contato real durante a implementação. Cobrir: leads prospectados elegíveis, decisões Jev reais no contrato simulado, resposta inválida, proposta/fechamento bloqueados para agente, aprovação versionada, invalidação por edição/resposta, bloqueio e pausa, deduplicação de inbound/outbound, timeout incerto, reinício, orçamento e limites diários, HTML do painel e preservação dos testes atuais.

Teste operacional posterior usa destinatário controlado escolhido pelo usuário, após pareamento e configuração. Relatar separadamente implementação validada por testes, canal autenticado e entrega real confirmada.

## Fontes consultadas

- [wacli](https://github.com/openclaw/wacli)
- [Envio wacli](https://github.com/openclaw/wacli/blob/main/docs/send.md)
- [Mensagens wacli](https://github.com/openclaw/wacli/blob/main/docs/messages.md)
- [Sincronização wacli](https://github.com/openclaw/wacli/blob/main/docs/sync.md)
- [Jev: decisões tipadas](https://docs.typesafe.ai/introduction)
- [Recebimento Resend](https://resend.com/docs/dashboard/receiving/introduction)

Status: desenho para revisão; nenhuma funcionalidade de vendas foi ativada.
