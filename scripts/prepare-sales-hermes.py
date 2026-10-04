#!/usr/bin/env python3
"""Prepare an isolated, tool-free Hermes API profile without paid generation."""
import json, os, secrets, shutil
from pathlib import Path
import yaml

root = Path(__file__).resolve().parents[1]
source = Path(os.environ.get('HERMES_HOME', str(Path.home() / '.hermes')))
target = Path(os.environ.get('HERMES_SALES_HOME', str(root / 'data/hermes-sales')))
target.mkdir(parents=True, exist_ok=True, mode=0o700)
target.chmod(0o700)
config_file = target / 'config.yaml'
if config_file.exists():
    current = yaml.safe_load(config_file.read_text()) or {}
    if current.get('platform_toolsets', {}).get('api_server') != ['no_mcp']:
        raise SystemExit('Existing profile has tools enabled; not overwritten.')
else:
    original = yaml.safe_load((source / 'config.yaml').read_text()) or {}
    config = {
        'model': original.get('model', {}),
        'platform_toolsets': {'api_server': ['no_mcp']},
        'mcp_servers': {}, 'plugins': {}, 'platforms': {},
        'memory': {'memory_enabled': False, 'user_profile_enabled': False},
        'gateway': {'multiplex_profiles': False},
        'agent': {'max_turns': 2},
    }
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2))
    config_file.chmod(0o600)
env_file = target / '.env'
if not env_file.exists():
    env_file.write_text('API_SERVER_KEY=' + secrets.token_hex(32) + '\nAPI_SERVER_ENABLED=true\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=8642\nAPI_SERVER_MODEL_NAME=hermes\n')
    env_file.chmod(0o600)
else:
    env_text = env_file.read_text()
    if 'API_SERVER_ENABLED=' not in env_text:
        env_file.write_text(env_text + '\nAPI_SERVER_ENABLED=true\n')
# Reuse only this user's Hermes model authentication, in a separate private copy.
if (source / 'auth.json').exists() and not (target / 'auth.json').exists():
    shutil.copyfile(source / 'auth.json', target / 'auth.json')
    (target / 'auth.json').chmod(0o600)
print('Perfil comercial isolado preparado. Ferramentas e MCP desabilitados; nenhuma geração executada.')
