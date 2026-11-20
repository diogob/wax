# Wax

OpenPGP key directory, GitHub proofs and signed/encrypted messages. Static site on GitHub Pages,
backend on Supabase. One toolchain: Deno.

## Layout

```
web/                  Preact + signals client (src/ bundled, public/ copied as-is)
config/               client runtime config (production.json committed, local.json generated)
supabase/migrations/  database (schemas: private, api, service)
supabase/functions/   Edge Functions; _shared/db.types.ts is shared with web and tests
tests/                deno test: db/ (direct SQL, rolled back) and api/ (supabase-js)
scripts/              dev server, local config writer
```

## Develop

```sh
nix develop
colima start            # macOS only: Docker daemon for the Supabase CLI
supabase start          # local stack (applies migrations)
scripts/local-env.sh    # writes config/local.json and .env.local
deno task dev           # http://127.0.0.1:5173 (rebuilds on change, reload manually)
```

Other commands:

```sh
deno task test                    # resets local db, then runs db + api tests
deno task check                   # typecheck + lint + fmt check
deno task fmt
deno task gen:types               # after changing the api/service schemas
deno task build                   # static site into ./dist
supabase migration new <name>
supabase db reset                 # re-apply migrations + seed
supabase functions serve          # run Edge Functions locally
```

## Deploy

One-time setup:

1. Create a Supabase project.
2. Put its URL and publishable key in `config/production.json` (public values, committed).
3. In Supabase: Settings → API → Exposed schemas = `api, service`. Auth → URL Configuration → Site
   URL = your Pages URL.
4. GitHub repo:
   - Settings → Pages → Source: **GitHub Actions**
   - Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
   - Variables: `SUPABASE_PROJECT_REF`

Then push to `main`. `.github/workflows/deploy.yml` migrates the DB, deploys functions, then builds
and publishes to Pages.
