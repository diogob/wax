# UI

Pages and user flows. Calls: `docs/contracts.md`. Statements: `docs/statements.md`.

## Rules

- The client never handles private keys or plaintext. Private-key steps are a command to copy; the
  command writes its output to a named `wax-….asc` file (`gpg --output`), which the user drops on
  the page or picks with a file dialog. Files work the same on every OS, and the user keeps them to
  refer to later (e.g. the GitHub proof is uploaded to the gist as that file). Messages are
  downloaded as files too. Names include the fingerprint or message id, so they never collide.
- One copy button per page. A flow that needs more than one command becomes a wizard, one page per
  command (decided per flow). A flow with one command is a single page of numbered steps, each shown
  once the previous one is done.
- Messages have no subject: everything a sender writes is encrypted. A cold message is judged by its
  sender's profile, GitHub proofs and key history, so the inbox shows these prominently.
- Profiles and search are public (no sign-in needed).
- Every Wax handle is shown with its seal: an SVG wax seal stamped with the username's first letter.
  The outline is derived from the username, so it stays the same. Wax colour is one CSS variable
  (`--wax`), later chosen per user. Pages never load anything from third parties.

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
   here) → publish key: enter its fingerprint → copy the export command → drop the file → copy the
   challenge command → drop its output file → `#/me`. Without a key you can browse but not send or
   receive; the page says why.
2. **GitHub proof** (`#/me`, one page of numbered steps): enter GitHub username → copy the proof
   command → create a public gist from the output file → paste its URL → verified, or the reason it
   failed.
3. **Profile key**: the current key shows `curl -sf <key URL> | gpg --import` (the one copy button);
   each key in history links to its key URL (`docs/contracts.md` `## Keys`). Publishing shows the
   key's user IDs, which become public.
4. **Send**: search or open a profile (fingerprint, proofs, stale proofs after a key change, key
   history) → "Send message" (one page) → download `wax-key-<user>-<fingerprint>.asc` → copy the
   command, which encrypts to that file with `gpg -f` (no import), type the message → drop its
   output file. If one knock applies, say so.
5. **Inbox**: rows show sender, time and trust.
   - `unknown`: sender's profile summary, "Show message" and "Ignore".
   - `accepted`: open the message: download `wax-from-<user>-<id>.asc` and the sender's key
     `wax-key-<user>-<fingerprint>.asc`, then copy `gpg --import <key> && gpg --decrypt <file>`.
     Importing lets gpg check the inner signature; re-importing a known key is harmless.
   - `ignored`: not listed.
6. **Outbox**: recipient and time; a message downloads as `wax-sent-to-<user>-<id>.asc`, then
   `gpg --decrypt <file>` (messages are encrypted to the sender too; no import needed).
7. **Settings**: replace key (same as publishing), revoke key (drop the `gpg --gen-revoke` output
   file), ignored senders with "Un-ignore", delete account, sign out.
