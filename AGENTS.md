Wax: OpenPGP key directory, GitHub proofs, signed+encrypted messages. Static client on GitHub Pages,
everything else on Supabase.

## Application

- The client never handles private keys. Private-key operations are shown as copyable `gpg`
  commands; the user pastes the output back.

## Edge Functions

- Layers: `index.ts` handlers → domain modules (`_shared/keys.ts`: RPCs and Storage around
  `ServiceClient`) → `pgp.ts` (crypto only, no Wax types; openpgp types never leave it). Handlers
  make no `.rpc()` calls; keep dependencies one-way.
- A handler reads its input, works out which case applies, and calls one function per case with
  validated, typed arguments (see `publish-key`).
- Values that passed a check get a branded type that only the checking function can make (a
  non-exported `unique symbol`, e.g. `PublishableKey`, `OwnKey`); later steps take that type, not a
  string.
- Parameter types are as narrow as the function needs. Derive them from the generated row types
  (`Pick<…>` of an inferred RPC result) so SQL changes break `deno task check`. Generated types
  claim non-null for function result columns; note nullable ones in a comment.
- The database is the source of truth; Storage files are derived from it. Write the database first,
  then the file. Functions are idempotent: resending the same request after a partial failure
  finishes the job. A failed write after the database commit is `unavailable` (503); clients offer
  Retry on `unavailable`, `internal` and network errors.
- SQL errors reach clients through `fromRpc` (WX003 → `bad_request`, WX004 → `conflict`); anything
  else is logged and reported as `internal`.

## Tests

- Use `node:test` + `@std/expect`. Not `@std/testing/bdd` (deprecated).
- No rollbacks, no cleanup. Each test creates its own uniquely named data (`uid()`,
  `createTestUser()`) and only asserts on that. The database is reset once per run
  (`deno task test`).
- Test-only tables go in the `scratch` schema, never in `private`.
- `deno task test [args]` passes args to `deno test` (e.g. a path or `--filter`).
- Structure: root `describe` = exported function name (one per function); second level =
  `describe("when …")`, the precondition; `it` = how the function responds.
- Test files mirror the module under test (`_shared/pgp.ts` → `tests/functions/pgp.test.ts`).
- Each `it` has three blocks separated by blank lines: setup (all preconditions), subject
  (`const result = …`), assertion. One assertion per test.
- For throws use `const result = () => f()`; for rejections keep the unawaited promise and
  `await expect(result).rejects…`.
- Setup should be correct by construction (literal inputs that visibly meet the precondition), so it
  never needs its own assertions.
- Real crypto, no mocks: use `tests/harness/gpg.ts` (throwaway keyrings) and the same gpg commands
  users run. Check results the way users get them (e.g. import into a fresh gpg keyring), not
  through openpgp internals.
- No test-only constructors. Build branded values through the production path, against the database
  (`tests/harness/keys.ts` `publishGpgKey`).
- `deno test` only type-checks what tests import; Edge Function `index.ts` files are covered by
  `deno task check`. Run both before handing back.
- `deno task test` doesn't start the Edge Functions. After changing one, exercise it by hand with
  `supabase functions serve --env-file <file with WAX_SITE_URL>` (temporary script, then delete it).

## Environment & coding style

- Everything runs inside `nix develop`. Do not install tools globally or add Node/npm/Vite.
- Deno is the only JS toolchain (client bundling, Edge Functions, tests).
- Dependencies are declared only in root `deno.json` `imports`. No inline `npm:`/`jsr:` specifiers.
- New dependencies need a strong reason. Current runtime deps: preact, @preact/signals,
  @supabase/supabase-js, openpgp (functions only).
- Small, boring code. No speculative abstractions.
- Prefer `map`/`filter`/`Object.fromEntries` over loops that push into an array or fill a record.
  Avoid `reduce` that builds objects. Descriptive names (`field`, `index`), not single letters.
- Exports go in one list at the end of the module (`export { … }` / `export type { … }`), never
  inline.
