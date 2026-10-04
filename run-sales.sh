#!/bin/zsh
set -e
cd "$(dirname "$0")"
export CRM_URL="${CRM_URL:-http://127.0.0.1:3080}"
if [[ -z "${CRM_AGENT_TOKEN:-}" ]]; then
 CRM_AGENT_TOKEN=$(node --input-type=module -e 'import {readFileSync} from "node:fs";process.stdout.write(JSON.parse(readFileSync("data/credentials.json","utf8")).agent)')
 export CRM_AGENT_TOKEN
fi
exec node scripts/sales-worker.mjs "$@"
