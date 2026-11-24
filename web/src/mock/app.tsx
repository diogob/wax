// UI mock: every page and flow from docs/ui.md, backed by ./data.ts instead of Supabase.
import { useEffect, useState } from "preact/hooks";
import { go, route } from "../route.ts";
import {
  ago,
  clearsignCommand,
  CopyBox,
  FileBox as RealFileBox,
  Handle,
  NavBar,
  Notice,
  short,
} from "../ui.tsx";
import {
  acceptsMe,
  currentKey,
  fakeArmor,
  me,
  messages,
  now,
  type Profile,
  profiles,
  receive,
  session,
  signInAsAlice,
  signOut,
  SITE,
  trust,
  trustOf,
  updateProfile,
} from "./data.ts";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// The real FileBox, plus a button that fills in an example file.
function FileBox(
  { example, ...props }: {
    file: string;
    example: string;
    submit: string;
    onSubmit: (text: string) => string | void;
  },
) {
  return (
    <RealFileBox
      {...props}
      extra={(choose) => (
        <button
          type="button"
          class="mock"
          onClick={() => choose({ name: props.file, text: example })}
        >
          Use example file (mock)
        </button>
      )}
    />
  );
}

// Signed-in links; signing in happens through the mock controls.
function Nav() {
  const user = session.value;
  const unread =
    messages.value.filter((message) =>
      message.to === user?.username && !message.read && trustOf(message.from) !== "ignored"
    ).length;
  return (
    <NavBar
      dot={unread > 0}
      links={user?.username && (
        <div class="links" id="nav-links">
          <a href="#/inbox">Inbox{unread > 0 && ` (${unread})`}</a>
          <a href="#/outbox">Outbox</a>
          <a href="#/me">
            <Handle username={user.username} />
          </a>
          <a href="#/settings">Settings</a>
        </div>
      )}
    />
  );
}

function MockControls() {
  const canReceive = !!currentKey(me.value);
  return (
    <aside class="mock-controls">
      <strong>Mock controls</strong>
      <button type="button" onClick={() => (signInAsAlice(), go("#/inbox"))}>
        Sign in as @alice (set up)
      </button>
      <button
        type="button"
        disabled={!canReceive}
        onClick={() => receive("mallory")}
      >
        Receive cold message from @mallory
      </button>
      <button
        type="button"
        disabled={!canReceive}
        onClick={() => receive("bob")}
      >
        Receive message from @bob
      </button>
      <button type="button" onClick={() => location.reload()}>Reset</button>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function Home() {
  const [query, setQuery] = useState("");
  const results = Object.values(profiles.value).filter((profile) =>
    query && profile.username.includes(query.toLowerCase())
  );
  return (
    <>
      <h1>Wax</h1>
      <p>
        A directory of OpenPGP keys, linked to GitHub accounts, and a way to send signed, encrypted
        messages. Your private key never leaves your machine: Wax shows you gpg commands to run.
      </p>
      <input
        type="search"
        placeholder="Search usernames"
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <ul class="results">
        {results.map((profile) => (
          <li>
            <ProfileSummary profile={profile} link />
          </li>
        ))}
      </ul>
      {query && results.length === 0 && <p>No one found.</p>}
    </>
  );
}

function ProfileSummary({ profile, link }: { profile: Profile; link?: boolean }) {
  const key = currentKey(profile);
  const verified = profile.proofs.filter((proof) => !proof.stale);
  return (
    <div class="summary">
      {link
        ? (
          <a href={`#/u/${profile.username}`}>
            <Handle username={profile.username} />
          </a>
        )
        : (
          <strong>
            <Handle username={profile.username} />
          </strong>
        )}
      <span>
        {key ? `key published ${ago(key.published)}` : "no key"}
        {" · "}
        {verified.length > 0
          ? verified.map((proof) => `GitHub @${proof.github} ✓`).join(", ")
          : "no GitHub proof"}
      </span>
    </div>
  );
}

// Public Storage object per key (docs/contracts.md ## Keys).
function keyUrl(fingerprint: string): string {
  return `https://project.supabase.co/storage/v1/object/public/keys/${fingerprint}.asc`;
}

function ProfilePage({ username }: { username: string }) {
  const profile = profiles.value[username];
  if (!profile) return <p>No user @{username}.</p>;
  const key = currentKey(profile);
  const isMe = session.value?.username === username;
  return (
    <>
      <h1>
        <Handle username={profile.username} />
      </h1>
      <h2>Key</h2>
      {key
        ? (
          <>
            <code class="fingerprint">{short(key.fingerprint)}</code>
            <p>Import it:</p>
            <CopyBox
              text={`curl -sf ${keyUrl(key.fingerprint)} | gpg --import`}
              hint={`Check that gpg prints ${short(key.fingerprint)}.`}
            />
          </>
        )
        : <p>No published key.</p>}
      <h2>GitHub</h2>
      {profile.proofs.length === 0 && <p>No proofs.</p>}
      <ul>
        {profile.proofs.map((proof) => (
          <li>
            @{proof.github} {proof.stale
              ? <span class="stale">made with an older key</span>
              : <span class="ok">verified {ago(proof.created)}</span>}
          </li>
        ))}
      </ul>
      <h2>Key history</h2>
      <ul class="keys">
        {profile.keys.map((record, index) => (
          <li>
            <code class="fingerprint">{short(record.fingerprint)}</code>
            <span class="meta">
              <a href={keyUrl(record.fingerprint)}>key file</a>
              {" · "}
              published {ago(record.published)}
              {record.revoked
                ? <span class="stale">revoked {ago(record.revoked)}</span>
                : index === 0
                ? <span class="ok">current</span>
                : <span class="meta-note">replaced</span>}
            </span>
          </li>
        ))}
      </ul>
      {!isMe && key && <SendButton username={username} />}
    </>
  );
}

function SendButton({ username }: { username: string }) {
  if (!session.value) {
    return (
      <p>
        <a href="#/login">Sign in</a> to send a message.
      </p>
    );
  }
  if (!currentKey(me.value)) {
    return <Notice>Publish your key first: messages are signed with it.</Notice>;
  }
  return <button type="button" onClick={() => go(`#/send/${username}`)}>Send message</button>;
}

// Sign-up, publishing and replacing keys are in the real app (web/src/app.tsx).
function Me() {
  const user = session.value;
  if (!user?.username || !currentKey(me.value)) return <RequireSignIn />;
  return (
    <>
      <ProfilePage username={user.username} />
      <p>
        <a href="#/me/github">Add a GitHub proof</a>
      </p>
    </>
  );
}

// One page of numbered steps; each step appears once the previous one is done.
function GithubProof() {
  const [typed, setTyped] = useState("");
  const [github, setGithub] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const key = currentKey(me.value);
  const username = session.value?.username;
  if (!username || !key) return <RequireSignIn />;

  const file = `wax-github-proof-${github}.asc`;
  const statement = [
    "Wax github proof v1",
    `Origin: ${SITE}`,
    `User: ${username}`,
    `GitHub: ${github}`,
    `Fingerprint: ${key.fingerprint}`,
    `Created: ${createdAt}`,
  ].join("\n");

  return (
    <>
      <h1>Add a GitHub proof</h1>
      <p>Links your GitHub account to this key, through a public gist only you could create.</p>
      <ol>
        <li>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setGithub(typed.trim());
              setCreatedAt(now());
            }}
          >
            <input
              placeholder="GitHub username"
              value={typed}
              onInput={(event) => setTyped(event.currentTarget.value)}
            />
            <button type="submit" disabled={!typed.trim() || typed.trim() === github}>
              {github ? "Change" : "Next"}
            </button>
          </form>
        </li>
        {github && (
          <>
            <li>
              Sign the proof:
              <CopyBox
                text={clearsignCommand(statement, file)}
                hint={`gpg asks for your passphrase, then writes ${file}.`}
              />
            </li>
            <li>
              Open <a href="https://gist.github.com" target="_blank">gist.github.com</a>{" "}
              as @{github} and drag <code>{file}</code> into it, then create a{" "}
              <strong>public</strong> gist.
            </li>
            <li>
              Paste the gist's URL:
              <GistUrl
                github={github}
                onVerified={() => {
                  updateProfile(username, (profile) => ({
                    ...profile,
                    proofs: [
                      { github, created: now(), stale: false },
                      ...profile.proofs.filter((proof) => proof.github !== github),
                    ],
                  }));
                  go("#/me");
                }}
              />
            </li>
          </>
        )}
      </ol>
    </>
  );
}

function GistUrl({ github, onVerified }: { github: string; onVerified: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const verify = () => {
    if (!url.startsWith(`https://gist.github.com/${github}/`)) {
      return setError(`Expected a gist owned by @${github}: https://gist.github.com/${github}/…`);
    }
    onVerified();
  };
  return (
    <>
      <input
        placeholder={`https://gist.github.com/${github}/…`}
        value={url}
        onInput={(event) => setUrl(event.currentTarget.value)}
      />
      {error && <p class="error">{error}</p>}
      <div class="row">
        <button type="button" onClick={verify}>Verify</button>
        <button
          type="button"
          class="mock"
          onClick={() => setUrl(`https://gist.github.com/${github}/3f2a9c`)}
        >
          Fill example (mock)
        </button>
      </div>
    </>
  );
}

// One page: download their key, run one command, drop the output file.
function Send({ username }: { username: string }) {
  const [sentAt] = useState(now);
  const [id] = useState(() => crypto.randomUUID());
  const recipient = profiles.value[username];
  const recipientKey = currentKey(recipient);
  const sender = session.value?.username;
  const senderKey = currentKey(me.value);
  if (!sender || !senderKey) return <RequireSignIn />;
  if (!recipient || !recipientKey) return <p>@{username} has no published key.</p>;

  const keyFile = `wax-key-${username}-${recipientKey.fingerprint}.asc`;
  const file = `wax-message-to-${username}-${id.slice(0, 8)}.asc`;
  const envelope = [
    "Wax message v1",
    `Origin: ${SITE}`,
    `From: ${sender}`,
    `To: ${username}`,
    `Id: ${id}`,
    `Sent: ${sentAt}`,
  ].join("\n");
  // -f encrypts to the key in the file without importing it; -r adds the sender for the outbox.
  const command = [
    `gpg --sign --encrypt --armor -f ${keyFile} -r ${senderKey.fingerprint} \\`,
    `  | { printf '%s\\n\\n' '${envelope}'; cat; } \\`,
    `  | gpg --clearsign --output ${file}`,
  ].join("\n");

  return (
    <>
      <h1>
        Message <Handle username={username} />
      </h1>
      <ProfileSummary profile={recipient} />
      <ol>
        <li>
          <DownloadLink file={keyFile} text={fakeArmor("PUBLIC KEY BLOCK", username)} />
        </li>
        <li>In the directory you saved it to, run this, type your message, then press Ctrl-D:</li>
      </ol>
      <CopyBox
        text={command}
        hint={`gpg asks for your passphrase twice, then writes ${file}.`}
      />
      <FileBox
        file={file}
        submit="Send"
        example={`-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n${envelope}\n\n${
          fakeArmor("MESSAGE", id)
        }\n${fakeArmor("SIGNATURE", id)}`}
        onSubmit={() => {
          const knocked = messages.value.some((message) =>
            message.from === sender && message.to === username && !message.read
          );
          if (knocked && !acceptsMe.includes(username)) {
            return `@${username} hasn't read your previous message yet. You can send another once they do.`;
          }
          messages.value = [{
            id,
            from: sender,
            to: username,
            sent: sentAt,
            armored: fakeArmor("MESSAGE", id),
            read: false,
          }, ...messages.value];
          go("#/outbox");
        }}
      />
    </>
  );
}

function RequireSignIn() {
  return <p>Use “Sign in as @alice” in the mock controls (sign-up is in the real app).</p>;
}

function Inbox() {
  const username = session.value?.username;
  if (!username || !currentKey(me.value)) return <RequireSignIn />;
  const received = messages.value.filter((message) =>
    message.to === username && trustOf(message.from) !== "ignored"
  );
  return (
    <>
      <h1>Inbox</h1>
      {received.length === 0 && <p>No messages.</p>}
      <ul class="messages">
        {received.map((message) => {
          const sender = profiles.value[message.from]!;
          if (trustOf(message.from) === "accepted") {
            return (
              <li class={message.read ? "" : "unread"}>
                <a href={`#/inbox/${message.id}`}>
                  <Handle username={message.from} />
                </a>
                <span>{ago(message.sent)}</span>
              </li>
            );
          }
          return (
            <li class="unknown">
              <p>
                <strong>Unknown sender</strong> · {ago(message.sent)}
              </p>
              <ProfileSummary profile={sender} link />
              <div class="row">
                <button
                  type="button"
                  onClick={() => {
                    trust.value = { ...trust.value, [message.from]: "accepted" };
                    go(`#/inbox/${message.id}`);
                  }}
                >
                  Show message
                </button>
                <button
                  type="button"
                  class="secondary"
                  onClick={() => {
                    trust.value = { ...trust.value, [message.from]: "ignored" };
                    markRead(message.id);
                  }}
                >
                  Ignore
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function markRead(id: string) {
  messages.value = messages.value.map((message) =>
    message.id === id ? { ...message, read: true } : message
  );
}

function DownloadLink({ file, text }: { file: string; text: string }) {
  const [url] = useState(() => URL.createObjectURL(new Blob([`${text}\n`])));
  return <a href={url} download={file}>Download {file}</a>;
}

function MessagePage({ id, box }: { id: string; box: "inbox" | "outbox" }) {
  const message = messages.value.find((candidate) => candidate.id === id);
  useEffect(() => {
    if (box === "inbox" && message && !message.read) markRead(id);
  }, [id]);
  if (!message) return <p>No such message.</p>;
  const other = box === "inbox" ? message.from : message.to;
  if (box === "outbox") {
    const file = `wax-sent-to-${other}-${id.slice(0, 8)}.asc`;
    return (
      <>
        <p>
          <a href="#/outbox">← Outbox</a>
        </p>
        <h1>
          To <Handle username={other} />
        </h1>
        <p>Sent {ago(message.sent)}.</p>
        <ol>
          <li>
            <DownloadLink file={file} text={message.armored} />
          </li>
          <li>Decrypt it, in the directory you saved it to:</li>
        </ol>
        <CopyBox
          text={`gpg --decrypt ${file}`}
          hint="Messages are encrypted to you too, so you can read what you sent."
        />
      </>
    );
  }

  // The inner signature can only be checked with the sender's key in the keyring.
  // Importing a key that is already there is harmless ("not changed").
  const file = `wax-from-${other}-${id.slice(0, 8)}.asc`;
  const senderKey = profiles.value[other]!.keys[0]!;
  const keyFile = `wax-key-${other}-${senderKey.fingerprint}.asc`;
  return (
    <>
      <p>
        <a href="#/inbox">← Inbox</a>
      </p>
      <h1>
        From <Handle username={other} />
      </h1>
      <p>
        Sent {ago(message.sent)}, signed with key <code>{short(senderKey.fingerprint)}</code>.
      </p>
      <ol>
        <li>
          <DownloadLink file={file} text={message.armored} />
        </li>
        <li>
          <DownloadLink file={keyFile} text={fakeArmor("PUBLIC KEY BLOCK", other)} />{" "}
          (to check @{other}'s signature)
        </li>
        <li>In the directory you saved them to, import the key and decrypt:</li>
      </ol>
      <CopyBox
        text={`gpg --import ${keyFile} && gpg --decrypt ${file}`}
        hint={`Look for "Good signature" with fingerprint ${short(senderKey.fingerprint)}.`}
      />
    </>
  );
}

function Outbox() {
  const username = session.value?.username;
  if (!username || !currentKey(me.value)) return <RequireSignIn />;
  const sent = messages.value.filter((message) => message.from === username);
  return (
    <>
      <h1>Outbox</h1>
      {sent.length === 0 && <p>Nothing sent yet.</p>}
      <ul class="messages">
        {sent.map((message) => (
          <li>
            <a href={`#/outbox/${message.id}`}>
              To <Handle username={message.to} />
            </a>
            <span>{ago(message.sent)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// The key and sign-out parts are in the real app (web/src/app.tsx).
function Settings() {
  const username = session.value?.username;
  if (!username) return <RequireSignIn />;
  const ignored = Object.entries(trust.value)
    .filter(([, level]) => level === "ignored")
    .map(([sender]) => sender);
  return (
    <>
      <h1>Settings</h1>
      <h2>Ignored senders</h2>
      {ignored.length === 0 && <p>None.</p>}
      <ul>
        {ignored.map((sender) => (
          <li>
            <Handle username={sender} />{" "}
            <button
              type="button"
              class="secondary"
              onClick={() => (trust.value = { ...trust.value, [sender]: "unknown" })}
            >
              Un-ignore
            </button>
          </li>
        ))}
      </ul>
      <h2>Account</h2>
      <div class="row">
        <button type="button" class="danger" onClick={() => go("#/settings/delete")}>
          Delete account
        </button>
      </div>
    </>
  );
}

function DeleteAccount() {
  const [typed, setTyped] = useState("");
  const username = session.value?.username;
  if (!username) return <RequireSignIn />;
  return (
    <>
      <h1>Delete your account</h1>
      <Notice>
        Removes your profile, keys, proofs and messages. @{username} can never be claimed again.
      </Notice>
      <label>
        Type your username to confirm
        <input value={typed} onInput={(event) => setTyped(event.currentTarget.value)} />
      </label>
      <button
        type="button"
        class="danger"
        disabled={typed !== username}
        onClick={() => {
          const { [username]: _removed, ...rest } = profiles.value;
          profiles.value = rest;
          signOut();
        }}
      >
        Delete account
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function Page() {
  const [, first, second] = route.value.slice(1).split("/");
  switch (first) {
    case "":
    case undefined:
      return <Home />;
    case "u":
      return <ProfilePage username={second ?? ""} />;
    case "me":
      return second === "github" ? <GithubProof /> : <Me />;
    case "send":
      return <Send username={second ?? ""} />;
    case "inbox":
      return second ? <MessagePage id={second} box="inbox" /> : <Inbox />;
    case "outbox":
      return second ? <MessagePage id={second} box="outbox" /> : <Outbox />;
    case "settings":
      if (second === "delete") return <DeleteAccount />;
      return <Settings />;
    default:
      return <p>Not found.</p>;
  }
}

function MockApp() {
  return (
    <>
      <Nav />
      <main key={route.value}>
        <Page />
      </main>
      <MockControls />
    </>
  );
}

export { MockApp };
