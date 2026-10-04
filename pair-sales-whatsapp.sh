#!/bin/zsh
set -e
cd "$(dirname "$0")"
exec node scripts/pair-sales-whatsapp.mjs
