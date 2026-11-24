# Contracts

How the browser talks to Supabase, per flow. Statement formats: `docs/statements.md`.

- **Edge Functions** do everything that parses keys or signatures, or produces statement text
  (`statements.ts` is the only implementation; `WAX_SITE_URL` is a function secret). They call
  `service.*` functions with the service role.
- **`api.*` RPCs** do everything else. They return composite types; tables stay in `private`.
- Errors: functions return `{ error, message }` with codes from `_shared/errors.ts`; SQL raises
  `WX…` SQLSTATEs, which functions translate.

## Flows

| Flow                  | Browser calls                                                       | Server side                                                    |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Who am I              | `api.my_username()`                                                 | —                                                              |
| Choose username       | `api.claim_username(name)`                                          | —                                                              |
| Get a key challenge   | `key-challenge` `{publicKey}` → `{challenge, fingerprint, userIds}` | `service.create_key_challenge` (stores nonce, 10 min)          |
| Publish a key         | `publish-key` `{publicKey, signed}`                                 | `service.publish_key` (uses the nonce, supersedes the old key) |
| Get GitHub proof text | `proof-statement` `{github}` → `{statement}`                        | reads the caller's current key                                 |
| Add GitHub proof      | `verify-proof` `{gistUrl}`                                          | fetches the gist; `service.add_github_proof`                   |
| Remove a proof        | `api.remove_github_proof(id)`                                       | —                                                              |
| Get message command   | `message-template` `{to}` → `{command}` (`Id`, `Sent` filled in)    | reads both current keys                                        |
| Send a message        | `send-message` `{signed}`                                           | `service.store_message`, notification email                    |
| Revoke a key          | `revoke-key` `{fingerprint, revocation}`                            | `service.own_key`, `service.revoke_key` (first one is kept)    |
| View a profile        | `api.profile(username)`                                             | —                                                              |
| Search                | `api.search(query)`                                                 | —                                                              |
| Inbox / outbox        | `api.inbox()`, `api.outbox()`, `api.message(id)`                    | —                                                              |
| Set trust in a sender | `api.set_trust(username, level)`                                    | —                                                              |

Error codes per call are added as each flow is implemented.

### `api.claim_username(name)` → `name`

`name`: 2–32 of `a-z 0-9 _ -`, starting with a letter or digit (same as `User` in statements). Once
claimed, it can't be changed.

| Code    | When                                                |
| ------- | --------------------------------------------------- |
| `42501` | not signed in (anon has no EXECUTE)                 |
| `WX003` | invalid format                                      |
| `WX004` | caller already has a username, or the name is taken |

### `api.my_username()` → `name` or null

The caller's username; null until they claim one (the client then sends them to choose one).

| Code    | When                                |
| ------- | ----------------------------------- |
| `42501` | not signed in (anon has no EXECUTE) |

### `api.profile(username)` → `{username, keys}`

Public (anon too). `keys` is the key history, newest first:
`{fingerprint, published_at,
replaced_by, revoked_at}`; `replaced_by` is the key that superseded it.
The current key is the first one, unless it is revoked. Key bodies are not included: they are served
from the key URL (`## Keys`). For an unknown username both fields are null.

### `key-challenge` `{publicKey}` → `{challenge, fingerprint, userIds}`

Checks the key (limits and cleaning below; not expired or revoked; has an encryption subkey) and
returns the statement to sign. `userIds` are shown to the user before publishing.

| Error         | When                                                         |
| ------------- | ------------------------------------------------------------ |
| `bad_request` | not a public key, over a limit, unusable, or no username yet |
| `conflict`    | the key is already published (on any account)                |

### `publish-key` `{publicKey, signed}` → `{fingerprint}`

`signed` is the challenge clearsigned by the key (`gpg --clearsign -u NEW`), plus the current key
when replacing one (`gpg --clearsign -u NEW -u CURRENT`): exactly one valid signature per key.
Stores the cleaned key and writes `keys/<FINGERPRINT>.asc`.

Idempotent: resending the request that published the key verifies it again, skips the database and
rewrites the file. The client shows **Retry** on `unavailable`, `internal` and network errors, and
resends the same body (the response may have been lost after the key was published).

| Error         | When                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| `bad_request` | bad key or signatures; Origin, User or Fingerprint wrong; unknown or expired nonce |
| `conflict`    | challenge already used; key already published; the current key changed meanwhile   |

### `revoke-key` `{fingerprint, revocation}` → `{fingerprint}`

Revokes one of the caller's keys, current or replaced. `revocation` is an OpenPGP revocation
certificate: `gpg --gen-revoke <FPR>` output, or the one gpg pre-generated in
`~/.gnupg/openpgp-revocs.d/<FPR>.rev` (its leading `:` is accepted). Stores it and rewrites
`keys/<FINGERPRINT>.asc` with it merged in. A revoked key is never current again (the key it
replaced doesn't come back); the next key is published with the new key's signature alone.

Idempotent: on an already revoked key it keeps the first revocation and rewrites the file from it.

| Error         | When                                                           |
| ------------- | -------------------------------------------------------------- |
| `bad_request` | not one of the caller's keys; not a valid revocation for it    |
| `unavailable` | the revocation is saved but the key file wasn't written: retry |

## Keys

Rules for publishing and serving keys.

- **Replacing needs the old key.** `publish-key` for a user who already has a current key requires
  the challenge to be signed by both the new and the current key. A user who lost the old key
  revokes it first (`revoke-key`, visible on the profile), then publishes. A stolen account (magic
  link) can therefore not swap the key silently.
- **User IDs are public.** Before publishing, the client shows the key's user IDs (usually
  `Name <email>`) and says they become public. Users who mind publish a key made for Wax.
- **Stored keys are cleaned.** `publish-key` stores a minimal copy: primary key, self-signatures,
  user IDs and subkeys only (no third-party signatures, no attributes such as photos). It rejects
  keys over 64 KB armored, with more than 10 user IDs or more than 10 subkeys. Everything Wax serves
  is this copy (SKS-style poisoning can't reach importers).
- **Key URL, by fingerprint.** On publish, the cleaned key is written to the public Storage bucket
  `keys` as `<FINGERPRINT>.asc` (40 uppercase hex; never short IDs), with
  `Content-Type: application/pgp-keys`. Only the service role writes. There is no URL by username: a
  link always serves the key it names, so taking over an account can't redirect shared links.
  Importers check that gpg prints the fingerprint in the URL.
- **Keys URLs never disappear.** Replacing a key leaves its object in place. Revoking rewrites the
  object with the revocation signature merged in, so importing an old link marks the key revoked.
  Cache: 1 day; a revocation can take that long to reach caches.
- Account deletion keeps revoked key objects (they warn importers) and deletes the rest.

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
