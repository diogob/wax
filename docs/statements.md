# Signed statements

Everything a user signs for Wax. Implemented in `supabase/functions/_shared/statements.ts`.

## Rules

- ASCII, LF line endings, signed with `gpg --clearsign`.
- Line 1 is the type and version. Then one `Key: value` line per field, in the order shown, nothing
  else. Statements are canonical: the server rebuilds the text from the parsed fields and rejects it
  unless it matches byte for byte (one trailing newline is tolerated).
- The server parses only the verified signed text, never the raw paste.
- The server always generates statement text; the client only displays it.
- `Origin` is the public site URL (`WAX_SITE_URL`), so statements from another deployment don't
  verify.
- `Fingerprint`: full, uppercase hex (40 chars for v4 keys, 64 for v6).
- Timestamps: UTC, `YYYY-MM-DDTHH:MM:SSZ`.
- `Nonce`, `Id`: UUIDs.

## Key challenge

Proves the holder of the private key wants it published on this account. Single-use nonce, stored by
the server, expires after 10 minutes. Publishing a key supersedes the previous one.

```
Wax key challenge v1
Origin: https://example.github.io/wax
User: alice
Fingerprint: 9F3B2C...E1A4
Nonce: 0193f1c2-7a4e-7b55-9c1d-3f0e8a2b6d11
Expires: 2026-11-23T15:14:05Z
```

Checks: signed by the pasted key, `Fingerprint` is that key, text equals the stored challenge, nonce
unused and not expired.

## GitHub proof

Signed and posted as a public gist. Verified once when added; stays valid until removed or the key
changes (then shown as stale). Later edits or deletion of the gist are not detected.

```
Wax github proof v1
Origin: https://example.github.io/wax
User: alice
GitHub: alice-gh
Fingerprint: 9F3B2C...E1A4
Created: 2026-11-23T15:04:05Z
```

Checks: gist owner equals `GitHub` (case-insensitive), gist contains exactly one clearsigned block,
signed by the user's current key, `Fingerprint` is that key, `User` is the caller.

## Message

An encrypted, signed message wrapped in a clearsigned envelope. The inner message is encrypted to
the recipient and the sender (so the sender can read their outbox).

```
Wax message v1
Origin: https://example.github.io/wax
From: alice
To: bob
Id: 0193f1c4-1b2a-7c3d-8e4f-5a6b7c8d9e0f
Sent: 2026-11-23T15:04:05Z

-----BEGIN PGP MESSAGE-----
...
-----END PGP MESSAGE-----
```

Checks: outer signature from `From`'s current key, `From` is the caller, `To` has a published key,
`Sent` within ±10 minutes of server time, `Id` unused for this sender, total size ≤ 12 KB, inner
message encrypted to both keys (checked from key IDs, without decrypting). The inner signature is
checked by the recipient's `gpg --decrypt`.

## Revocation

No Wax statement: the user pastes an OpenPGP revocation certificate (`gpg --gen-revoke`, or
`openpgp-revocs.d/<FPR>.rev`). It can be merged into the key file, which a statement couldn't.
