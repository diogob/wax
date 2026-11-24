# Contracts

How the browser talks to Supabase, per flow. Statement formats: `docs/statements.md`.

- **Edge Functions** do everything that parses keys or signatures, or produces statement text
  (`statements.ts` is the only implementation; `WAX_SITE_URL` is a function secret). They call
  `service.*` functions with the service role.
- **`api.*` RPCs** do everything else. They return composite types; tables stay in `private`.
- Errors: functions return `{ error, message }` with codes from `_shared/errors.ts`; SQL raises
  `WX…` SQLSTATEs, which functions translate.

## Flows

| Flow                  | Browser calls                                                    | Server side                                                    |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Choose username       | `api.claim_username(name)`                                       | —                                                              |
| Get a key challenge   | `key-challenge` `{publicKey}` → `{challenge}`                    | `service.create_key_challenge` (stores nonce, 10 min)          |
| Publish a key         | `publish-key` `{publicKey, signed}`                              | `service.publish_key` (uses the nonce, supersedes the old key) |
| Get GitHub proof text | `proof-statement` `{github}` → `{statement}`                     | reads the caller's current key                                 |
| Add GitHub proof      | `verify-proof` `{gistUrl}`                                       | fetches the gist; `service.add_github_proof`                   |
| Remove a proof        | `api.remove_github_proof(id)`                                    | —                                                              |
| Get message command   | `message-template` `{to}` → `{command}` (`Id`, `Sent` filled in) | reads both current keys                                        |
| Send a message        | `send-message` `{signed}`                                        | `service.store_message`, notification email                    |
| Revoke a key          | `revoke-key` `{revocation}`                                      | `service.revoke_key`                                           |
| View a profile        | `api.profile(username)`                                          | —                                                              |
| Search                | `api.search(query)`                                              | —                                                              |
| Inbox / outbox        | `api.inbox()`, `api.outbox()`, `api.message(id)`                 | —                                                              |
| Set trust in a sender | `api.set_trust(username, level)`                                 | —                                                              |

Error codes per call are added as each flow is implemented.

### `api.claim_username(name)` → `name`

`name`: 2–32 of `a-z 0-9 _ -`, starting with a letter or digit (same as `User` in statements). Once
claimed, it can't be changed.

| Code    | When                                                |
| ------- | --------------------------------------------------- |
| `42501` | not signed in (anon has no EXECUTE)                 |
| `WX003` | invalid format                                      |
| `WX004` | caller already has a username, or the name is taken |

## Avatars

Deferred: handles show a seal for now (`docs/ui.md`). If avatars come back, this is the plan.

Viewers never contact GitHub: a page that loads `github.com/<user>.png` tells GitHub who looks at
which profile. Wax keeps its own copy instead.

- `verify-proof` downloads the avatar after the proof verifies, server side, and uploads it to the
  public Storage bucket `avatars` as `<proof id>`. Only the service role writes to the bucket.
- Accepted: PNG, JPEG, GIF or WebP, checked by magic bytes, not the response's content type; at most
  1 MB. The object is stored with the content type matching the magic bytes. A failed or rejected
  download does not fail the proof; the profile shows the placeholder.
- The copy is refreshed only when the proof is verified again. A proof made with an older key
  (stale) has no avatar.
- Removing a proof, or deleting the account, deletes its object.
- `api.profile` (and every composite carrying a handle) returns `avatar`: the object path of the
  user's most recent fresh proof, or null. The client builds the URL from the Supabase project URL.
- The client's CSP allows images only from the Supabase project.

## Trust

Anyone with a published key can message anyone with one. Each recipient privately rates senders;
only the recipient sees their ratings, and the sender is never told.

| Level      | Set by         | Inbox                                                         |
| ---------- | -------------- | ------------------------------------------------------------- |
| `unknown`  | default        | sender profile + proofs; content hidden behind "Show message" |
| `accepted` | "Show message" | content shown                                                 |
| `ignored`  | "Ignore"       | messages hidden                                               |

- One knock: `send-message` rejects a message from an `unknown` sender while a previous message from
  them to the same recipient is unread. A message is read once the recipient clicks "Show message"
  or "Ignore"; being listed in the inbox doesn't count.
- Ignored senders are not told: `send-message` accepts their messages as usual. The first 10, within
  30 days of the ignore, are stored hidden; after either limit is reached, new ones are dropped
  without being stored. The sender sees a normal success either way.
- New-message email: sent for `unknown` (the knock) and `accepted` senders, never for `ignored`.
- Out of scope: a `known` level, introductions (later, as an explicit action by the introducer),
  signed vouching (`gpg --sign-key`).
