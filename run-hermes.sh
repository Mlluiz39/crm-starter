#!/bin/zsh
# Executa o worker real: AISA principal e Apify após ativação no painel.
set -e
cd "$(dirname "$0")"
export CRM_URL="${CRM_URL:-http://127.0.0.1:3080}"
if [[ -z "${CRM_AGENT_TOKEN:-}" ]]; then
  CRM_AGENT_TOKEN=$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const k=JSON.parse(readFileSync("data/credentials.json","utf8")); process.stdout.write(k.agent);')
  export CRM_AGENT_TOKEN
fi
exec node scripts/hermes-worker.mjs "$@"
