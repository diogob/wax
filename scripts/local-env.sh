#!/usr/bin/env bash
# Write local config from the running local Supabase stack:
#   config/local.json  client config (served as /config.json by `deno task dev`)
#   .env.local         secrets for tests
set -euo pipefail

status=$(supabase status -o json)

jq '{
  supabaseUrl: .API_URL,
  supabasePublishableKey: (.PUBLISHABLE_KEY // .ANON_KEY)
}' <<<"$status" > config/local.json

jq -r '
  "SUPABASE_URL=\(.API_URL)",
  "SUPABASE_PUBLISHABLE_KEY=\(.PUBLISHABLE_KEY // .ANON_KEY)",
  "SUPABASE_SERVICE_ROLE_KEY=\(.SECRET_KEY // .SERVICE_ROLE_KEY)",
  "SUPABASE_DB_URL=\(.DB_URL)"
' <<<"$status" > .env.local

echo "wrote config/local.json and .env.local"
