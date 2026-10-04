# Contexto para continuar no Codex

## Objetivo e referências

Marcelo possui dois repositórios:

- Front: https://github.com/Mlluiz39/crm-leads
- Back: https://github.com/Mlluiz39/crm-client

Não foi possível ler os repositórios nesta sessão porque o GitHub exigiu autenticação. Esta base foi criada separadamente com autorização do usuário, para posterior adaptação. Não substituir os projetos originais por este pacote sem análise.

Referências visuais enviadas: CRM branco/cinza com barra lateral, botões roxos, cartões discretos, dashboard, prospecção por nicho/cidade, campanhas em tabela e tipos de lead em cartões. Os links do YouTube não puderam ser acessados. Não alegar reprodução de telas que não foram vistas.

## O que fazer na máquina do Marcelo

1. Abrir os dois repositórios e ler AGENTS.md/instruções locais. Verificar branches, mudanças locais, stack, rotas, esquema, autenticação e migrations existentes.
2. Comparar a base deste ZIP com a arquitetura real. Portar aparência e fluxos para os componentes existentes; preservar trabalho e dados do usuário.
3. Usar este contrato de API como proposta, adaptando nomes e formatos às rotas reais. Não presumir que o backend é Node, Go ou usa determinado banco.
4. Implementar a persistência definitiva usando o banco real, sem substituir ou importar o SQLite temporário automaticamente.
5. Conectar o Hermes por um worker/ferramenta autenticada. Token do agente não pode ter permissão de aprovação.
6. Descobrir a integração instalada do Jev e os endpoints documentados da AISA. Validar custos, autenticação e resultados com orçamento expressamente configurado. Nunca solicitar chaves em texto no chat.
7. Testar pesquisa piloto pequena, registrar fontes, custo e decisões reais. Sem orçamento, não executar chamadas cobradas.
8. Implementar transporte de e-mail/WhatsApp somente com controles descritos em INTEGRACAO.md e autorização para o envio específico. A aprovação do usuário deve continuar obrigatória.
9. Testar fluxos completos, responsividade, autenticação, escopo, bloqueios, duplicatas e idempotência. Mostrar diffs e resultados.

## Não confundir

- Aprovar campanha não é enviar.
- Criar pesquisa não é executar AISA.
- Registrar decisão do worker não prova consulta ao Jev.
- Prints não contêm o código-fonte do CRM de referência.
- Não há adaptação feita nos repositórios remotos ainda.

## Instrução sugerida ao Codex

“Analise meus repositórios crm-leads e crm-client e a base deste pacote. Preserve a stack, os dados e as alterações existentes. Adapte o visual e os fluxos de leads, pipeline, prospecção, campanhas e aprovações. Integre Hermes como executor, Jev como apoio às decisões e AISA como fonte de ferramentas, verificando as interfaces reais. Implemente controles de custo e autorização no backend. Não envie mensagens sem minha aprovação específica. Comece inspecionando o projeto e implemente as partes independentes das credenciais.”
