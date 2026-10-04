#!/bin/bash
# Wrapper para o worker de prospecção — lê credenciais e executa o ciclo
# Uso: ./worker-cycle.sh

set -e

cd "$(dirname "$0")"

# Verifica se o servidor está rodando
if ! curl -s http://127.0.0.1:3080/api/session > /dev/null 2>&1; then
  echo "Servidor CRM não está rodando. Iniciando..."
  
  # Lê credenciais do arquivo
  ADMIN_TOKEN=$(python3 -c "import json; print(json.load(open('data/credentials.json'))['admin'])")
  AGENT_TOKEN=$(python3 -c "import json; print(json.load(open('data/credentials.json'))['agent'])")
  
  export CRM_ADMIN_TOKEN="$ADMIN_TOKEN"
  export CRM_AGENT_TOKEN="$AGENT_TOKEN"
  export HOST=127.0.0.1
  export PORT=3080
  
  node server.mjs &
  SERVER_PID=$!
  
  # Aguardar servidor iniciar
  for i in {1..10}; do
    if curl -s http://127.0.0.1:3080/api/session > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Lê credenciais para o worker
AGENT_TOKEN=$(python3 -c "import json; print(json.load(open('data/credentials.json'))['agent'])")
export CRM_AGENT_TOKEN="$AGENT_TOKEN"
export CRM_URL=http://127.0.0.1:3080

# Executa o worker
node scripts/hermes-worker.mjs --once --verbose
