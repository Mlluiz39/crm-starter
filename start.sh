#!/bin/bash
# Inicia o servidor CRM e o worker de integração com Hermes
# Uso: ./start.sh [--worker-only] [--server-only]

set -e

cd "$(dirname "$0")"

# Tokens do data/credentials.json (gerados automaticamente)
ADMIN_TOKEN=$(cat data/credentials.json | python3 -c 'import sys,json; print(json.load(sys.stdin)["admin"])')
AGENT_TOKEN=$(cat data/credentials.json | python3 -c 'import sys,json; print(json.load(sys.stdin)["agent"])')

export CRM_ADMIN_TOKEN="$ADMIN_TOKEN"
export CRM_AGENT_TOKEN="$AGENT_TOKEN"
export CRM_URL="http://127.0.0.1:3080"
export HOST="127.0.0.1"
export PORT=3080

echo "🚀 Iniciando CRM + Worker Hermes"
echo "   URL: $CRM_URL"
echo "   Admin token: ${ADMIN_TOKEN:0:8}..."
echo "   Agent token: ${AGENT_TOKEN:0:8}..."

# Verifica se o servidor já está rodando
if curl -s http://127.0.0.1:3080/api/session -H "Authorization: Bearer $AGENT_TOKEN" > /dev/null 2>&1; then
  echo "⚠️  Servidor já está rodando."
else
  echo "📦 Iniciando servidor CRM..."
  node server.mjs &
  SERVER_PID=$!
  echo "   PID: $SERVER_PID"
  
  # Aguardar servidor iniciar
  for i in {1..10}; do
    if curl -s http://127.0.0.1:3080/api/session -H "Authorization: Bearer $AGENT_TOKEN" > /dev/null 2>&1; then
      echo "   ✅ Servidor online!"
      break
    fi
    sleep 1
  done
fi

# Inicia o worker
echo ""
echo "🤖 Iniciando worker de prospecção..."
echo "   Pressione Ctrl+C para parar"
echo ""

node scripts/hermes-worker.mjs --verbose
