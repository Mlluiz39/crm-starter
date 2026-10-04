# Correções do CRM — plano de execução

Escopo: seis pontos da revisão, autorizados pelo usuário. Node 24, SQLite, sem dependências novas. Nenhuma alteração nas credenciais ou no banco real. Diretório atual não é um repositório Git.

- [x] E-mail: testes de concorrência, cota concorrente, repetição após falha, falha ambígua e teste seguido de produção; reserva transacional de outbox antes da chamada; modos separados; chave de idempotência no provedor; resultado incerto exige reconciliação.
- [x] Worker: teste com provedores simulados; consumir array de leads; não falhar tarefa já concluída por erro posterior de decisão; conservar custo nas falhas; reserva renovável para trabalhos longos.
- [x] Orçamento: enviar teto à Apify; registrar run e custo também nas falhas; reservar por chamada AISA/Jev com custo máximo configurado, pular quando desconhecido ou saldo insuficiente; nunca tratar custo desconhecido como zero confirmado.
- [x] Documentação: atualizar envio real, modos, recuperação e limites de custo; executar suíte completa e sintaxe.

Verificação: bancos temporários e provedores simulados, sem mensagens ou pesquisas externas. Testes devem falhar antes das correções e passar depois. Revisão final de regressões, recuperação após interrupção e compatibilidade dos registros existentes.

Resultado: 47 testes passaram; sintaxe de 13 arquivos verificada. Limitações de validação e operação em `docs/VALIDACAO.md` e `README.md`.
