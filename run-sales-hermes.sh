#!/bin/zsh
set -e
cd "$(dirname "$0")"
python3 scripts/prepare-sales-hermes.py
export HERMES_HOME="${HERMES_SALES_HOME:-$PWD/data/hermes-sales}"
exec hermes gateway run
