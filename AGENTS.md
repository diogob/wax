Wax: OpenPGP key directory, GitHub proofs, signed+encrypted messages. Static client on GitHub Pages,
everything else on Supabase.

## Application

- The client never handles private keys. Private-key operations are shown as copyable `gpg`
  commands; the user pastes the output back.

## Tests

- Use `node:test` + `@std/expect`. Not `@std/testing/bdd` (deprecated).
- No rollbacks, no cleanup. Each test creates its own uniquely named data (`uid()`, `createTestUser()`)
  and only asserts on that. The database is reset once per run (`deno task test`).
- Test-only tables go in the `scratch` schema, never in `private`.
- `deno task test [args]` passes args to `deno test` (e.g. a path or `--filter`).

## Environment & coding style

- Everything runs inside `nix develop`. Do not install tools globally or add Node/npm/Vite.
- Deno is the only JS toolchain (client bundling, Edge Functions, tests).
- Dependencies are declared only in root `deno.json` `imports`. No inline `npm:`/`jsr:` specifiers.
- New dependencies need a strong reason. Current runtime deps: preact, @preact/signals,
  @supabase/supabase-js, openpgp (functions only).
- Small, boring code. No speculative abstractions.
