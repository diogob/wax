# UI

Pages and user flows. Calls: `docs/contracts.md`. Statements: `docs/statements.md`.

## Rules

- The client never handles private keys or plaintext. Private-key steps are a command to copy and
  its output to paste back.
- One copy button per page. A flow that needs more than one command becomes a wizard, one page per
  command (decided per flow).
- Messages have no subject: everything a sender writes is encrypted. A cold message is judged by its
  sender's profile, GitHub proofs and key history, so the inbox shows these prominently.
- Profiles and search are public (no sign-in needed).

## Pages

| Route           | Who                 | Content                                            |
| --------------- | ------------------- | -------------------------------------------------- |
| `#/`            | anyone              | What Wax is, search                                |
| `#/login`       | signed out          | Email form (magic link)                            |
| `#/u/:username` | anyone              | Profile; "Send message" if the caller has a key    |
| `#/me`          | signed in           | Onboarding until done, then own profile and proofs |
| `#/inbox`       | signed in, with key | Received messages                                  |
| `#/outbox`      | signed in, with key | Sent messages                                      |
| `#/settings`    | signed in           | Key, ignored senders, account                      |

## Flows

1. **Sign up**: email → magic link → choose username (a signed-in user without one is always sent
   here) → publish key: paste public key → copy the challenge command → paste its output → `#/me`.
   Without a key you can browse but not send or receive; the page says why.
2. **GitHub proof** (`#/me`): enter GitHub username → copy the proof command → create a public gist
   with the output → paste its URL → verified, or the reason it failed.
3. **Send**: search or open a profile (fingerprint, proofs, stale proofs after a key change, key
   history) → "Send message" → copy the command → paste its output. If one knock applies, say so.
4. **Inbox**: rows show sender, time and trust.
   - `unknown`: sender's profile summary, "Show message" and "Ignore".
   - `accepted`: the decrypt command.
   - `ignored`: not listed.
5. **Outbox**: recipient, time and the decrypt command (messages are encrypted to the sender too).
6. **Settings**: replace key (same as publishing), revoke key (paste `gpg --gen-revoke` output),
   ignored senders with "Un-ignore", delete account, sign out.
