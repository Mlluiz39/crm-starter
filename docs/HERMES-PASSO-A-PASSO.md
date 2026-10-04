# Como rodar o Hermes (qualquer pessoa)

1. Abra o navegador em: http://localhost:3080
2. Entre com o token de administrador
3. Vá em "Prospecção IA"
4. Clique em "Criar pesquisa" (nicho, cidade, quantidade, custo US$ 0)
5. Abra outro terminal (não feche o do servidor) e rode:

export CRM_URL=http://localhost:3080
export CRM_AGENT_TOKEN=agent-59a9d0090b53aeb20da2b421ac21e749f8f3f131
node scripts/hermes-client.mjs claim

6. Se aparecer job: copie id e leaseToken, pesquise, salve resultado.json, depois:
node scripts/hermes-client.mjs complete ID_DO_JOB resultado.json
