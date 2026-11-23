# Contracts

How the browser talks to Supabase, per flow. Statement formats: `docs/statements.md`.

- **Edge Functions** do everything that parses keys or signatures, or produces statement text
  (`statements.ts` is the only implementation; `WAX_SITE_URL` is a function secret). They call
  `service.*` functions with the service role.
- **`api.*` RPCs** do everything else. They return composite types; tables stay in `private`.
- Errors: functions return `{ error, message }` with codes from `_shared/errors.ts`; SQL raises
  `WX…` SQLSTATEs, which functions translate.

## Flows

| Flow | Browser calls | Server side |
|---|---|---|
| Choose username | `api.claim_username(name)` | — |
| Get a key challenge | `key-challenge` `{publicKey}` → `{challenge}` | `service.create_key_challenge` (stores nonce, 10 min) |
| Publish a key | `publish-key` `{publicKey, signed}` | `service.publish_key` (uses the nonce, supersedes the old key) |
| Get GitHub proof text | `proof-statement` `{github}` → `{statement}` | reads the caller's current key |
| Add GitHub proof | `verify-proof` `{gistUrl}` | fetches the gist; `service.add_github_proof` |
| Remove a proof | `api.remove_github_proof(id)` | — |
| Get message command | `message-template` `{to}` → `{command}` (`Id`, `Sent` filled in) | reads both current keys |
| Send a message | `send-message` `{signed}` | `service.store_message`, notification email |
| Revoke a key | `revoke-key` `{revocation}` | `service.revoke_key` |
| View a profile | `api.profile(username)` | — |
| Search | `api.search(query)` | — |
| Inbox / outbox | `api.inbox()`, `api.outbox()`, `api.message(id)` | — |

Error codes per call are added as each flow is implemented.
