// UI mock: every page and flow from docs/ui.md, backed by ./data.ts instead of Supabase.
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  acceptsMe,
  currentKey,
  fakeArmor,
  fakeFingerprint,
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

const route = signal(location.hash || "#/");
addEventListener("hashchange", () => {
  route.value = location.hash || "#/";
  scrollTo(0, 0);
});

function go(hash: string) {
  location.hash = hash;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function CopyBox({ text, hint }: { text: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <div class="copybox">
        <pre>{text}</pre>
        <button type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy command"}</button>
      </div>
      {hint && <p class="hint">{hint}</p>}
    </>
  );
}

// The command writes its output to a file; the user drops or picks that file here.
function FileBox(
  { file, example, submit, onSubmit }: {
    file: string;
    example: string;
    submit: string;
    onSubmit: (text: string) => string | void;
  },
) {
  const [chosen, setChosen] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setError("");
    setChosen({ name: picked.name, text: await picked.text() });
  };
  const send = () => {
    if (!chosen?.text.includes("-----BEGIN PGP")) {
      return setError(`${chosen?.name} doesn't look like gpg output.`);
    }
    setError(onSubmit(chosen.text) ?? "");
  };
  return (
    <div class="filebox">
      <label
        class={dragging ? "drop dragging" : "drop"}
        onDragOver={(event) => (event.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer?.files[0]);
        }}
      >
        {chosen
          ? (
            <span>
              Selected <code>{chosen.name}</code>
            </span>
          )
          : (
            <span>
              Drop <code>{file}</code> here, or click to choose it
            </span>
          )}
        <input
          type="file"
          accept=".asc,text/plain"
          onChange={(event) => choose(event.currentTarget.files?.[0])}
        />
      </label>
      {error && <p class="error">{error}</p>}
      <div class="row">
        <button type="button" disabled={!chosen} onClick={send}>{submit}</button>
        <button
          type="button"
          class="mock"
          onClick={() => setChosen({ name: file, text: example })}
        >
          Use example file (mock)
        </button>
      </div>
    </div>
  );
}

function Steps({ current, names }: { current: number; names: string[] }) {
  return (
    <ol class="steps">
      {names.map((name, index) => (
        <li class={index === current ? "current" : index < current ? "done" : ""}>{name}</li>
      ))}
    </ol>
  );
}

function ago(timestamp: string): string {
  const days = Math.floor((Date.now() - Date.parse(timestamp)) / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function short(fingerprint: string): string {
  return fingerprint.match(/.{4}/g)!.join(" ");
}

function clearsignCommand(statement: string, file: string): string {
  return `printf '%s\\n' '${statement}' \\\n  | gpg --clearsign --output ${file}`;
}

function Notice({ children }: { children: ComponentChildren }) {
  return <p class="notice">{children}</p>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// System → light → dark. The CSS uses light-dark(), which follows color-scheme on <html>.
const themes = ["system", "light", "dark"] as const;
type Theme = (typeof themes)[number];
// 16px line icons, drawn with currentColor.
const themeIcons: Record<Theme, string> = {
  system: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z",
  light:
    "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  dark: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
};

function applyTheme(theme: Theme) {
  document.documentElement.style.colorScheme = theme === "system" ? "light dark" : theme;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("wax-theme") as Theme | null) ?? "system",
  );
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("wax-theme", theme);
  }, [theme]);
  const next = themes[(themes.indexOf(theme) + 1) % themes.length]!;
  return (
    <button
      type="button"
      class="theme"
      title={`Theme: ${theme}. Click for ${next}.`}
      aria-label={`Theme: ${theme}`}
      onClick={() => setTheme(next)}
    >
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={themeIcons[theme]} />
        {theme === "system" && <path fill="currentColor" d="M8 2a6 6 0 0 0 0 12Z" />}
      </svg>
    </button>
  );
}

// On narrow screens the signed-in links fold behind a menu button (CSS decides when).
function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route.value]);
  const user = session.value;
  const unread =
    messages.value.filter((message) =>
      message.to === user?.username && !message.read && trustOf(message.from) !== "ignored"
    ).length;
  return (
    <nav class={open ? "open" : ""}>
      <a href="#/" class="brand">Wax</a>
      {user
        ? (
          <div class="links" id="nav-links">
            <a href="#/inbox">Inbox{unread > 0 && ` (${unread})`}</a>
            <a href="#/outbox">Outbox</a>
            <a href="#/me">
              {user.username ? <Handle username={user.username} /> : "Finish sign-up"}
            </a>
            <a href="#/settings">Settings</a>
          </div>
        )
        : <a href="#/login">Sign in</a>}
      <ThemeToggle />
      {user && (
        <button
          type="button"
          class="menu"
          aria-expanded={open}
          aria-controls="nav-links"
          aria-label="Menu"
          onClick={() => setOpen(!open)}
        >
          <svg
            viewBox="0 0 16 16"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d={open ? "M4 4l8 8M12 4l-8 8" : "M2.5 4.5h11M2.5 8h11M2.5 11.5h11"} />
          </svg>
          {!open && unread > 0 && <span class="dot" />}
        </button>
      )}
    </nav>
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

function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <>
        <h1>Check your email</h1>
        <p>We sent a sign-in link to {email}.</p>
        <button
          type="button"
          class="mock"
          onClick={() => {
            session.value = { email };
            go("#/me");
          }}
        >
          Open the magic link (mock)
        </button>
      </>
    );
  }
  return (
    <>
      <h1>Sign in</h1>
      <p>No password. We email you a link.</p>
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onInput={(event) => setEmail(event.currentTarget.value)}
      />
      <button type="button" disabled={!email.includes("@")} onClick={() => setSent(true)}>
        Send link
      </button>
    </>
  );
}

// A wax seal stamped with the user's initial. The blob's outline is derived from the username, so
// each user's seal keeps the same shape. Colour comes from the CSS variable --wax (configurable
// per user later).
function sealOutline(username: string): string {
  const seed = [...username].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  // A number in [0, 1) per point and purpose, from the seed; the same every render.
  const random = (index: number, salt: number) => {
    const mixed = Math.imul(seed ^ (index * 2654435761) ^ (salt * 40503), 2246822519);
    return ((mixed ^ (mixed >>> 15)) >>> 0) / 2 ** 32;
  };
  const count = 13;
  const points = Array.from({ length: count }, (_, index) => {
    // Lumps from just outside the ring (13.5) to the edge of the box (20).
    const radius = 13.5 + random(index, 1) ** 0.7 * 6.5;
    const angle = ((index + (random(index, 2) - 0.5) * 0.6) / count) * 2 * Math.PI;
    return { x: 20 + radius * Math.cos(angle), y: 20 + radius * Math.sin(angle) };
  });
  // Smooth closed curve: each point is a control point, midpoints are on the curve.
  const midpoint = (index: number) => {
    const from = points[index % count]!;
    const to = points[(index + 1) % count]!;
    return `${((from.x + to.x) / 2).toFixed(2)} ${((from.y + to.y) / 2).toFixed(2)}`;
  };
  const curves = points.map((point, index) =>
    `Q ${point.x.toFixed(2)} ${point.y.toFixed(2)} ${midpoint(index)}`
  );
  return `M ${midpoint(count - 1)} ${curves.join(" ")} Z`;
}

function Seal({ username }: { username: string }) {
  const initial = username[0]!.toUpperCase();
  return (
    <svg class="seal" viewBox="0 0 40 40" aria-hidden="true">
      <path class="seal-wax" d={sealOutline(username)} />
      <circle class="seal-ring" cx="20" cy="20" r="11.5" />
      <text class="seal-shine" x="20" y="20.8">{initial}</text>
      <text class="seal-letter" x="20" y="20">{initial}</text>
    </svg>
  );
}

function Handle({ username }: { username: string }) {
  return (
    <span class="handle">
      <Seal username={username} />
      <span>@{username}</span>
    </span>
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

// Sign-up: username, then key. A signed-in user without both lands here.
function Me() {
  const user = session.value;
  if (!user) return <RequireSignIn />;
  if (!user.username) return <ChooseUsername />;
  if (!currentKey(me.value)) return <PublishKey />;
  return (
    <>
      <ProfilePage username={user.username} />
      <p>
        <a href="#/me/github">Add a GitHub proof</a>
      </p>
    </>
  );
}

function ChooseUsername() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const claim = () => {
    if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(name)) {
      return setError("2–32 of a-z, 0-9, _ and -, starting with a letter or digit.");
    }
    if (profiles.value[name]) return setError("That username is taken.");
    profiles.value = { ...profiles.value, [name]: { username: name, keys: [], proofs: [] } };
    session.value = { ...session.value!, username: name };
  };
  return (
    <>
      <Steps current={0} names={["Username", "Public key", "Sign challenge"]} />
      <h1>Choose a username</h1>
      <p>It can't be changed later.</p>
      <input value={name} onInput={(event) => setName(event.currentTarget.value)} />
      {error && <p class="error">{error}</p>}
      <button type="button" onClick={claim}>Claim</button>
    </>
  );
}

// Two pages, one command each: export the key, then sign the challenge.
function PublishKey({ replacing }: { replacing?: boolean }) {
  const [fingerprint, setFingerprint] = useState("");
  const [typed, setTyped] = useState("");
  // gpg prints fingerprints in groups of four; accept that and normalize.
  const normalized = typed.replaceAll(" ", "").toUpperCase();
  const typedFingerprint = /^[0-9A-F]{40}$/.test(normalized) ? normalized : "";
  const keyFile = `wax-public-key-${typedFingerprint}.asc`;
  const username = session.value!.username!;
  const names = replacing
    ? ["New public key", "Sign challenge"]
    : ["Username", "Public key", "Sign challenge"];
  const offset = replacing ? 0 : 1;

  if (!fingerprint) {
    return (
      <>
        <Steps current={offset} names={names} />
        <h1>{replacing ? "Replace your key" : "Publish your public key"}</h1>
        {replacing && (
          <Notice>
            Your GitHub proofs will show as made with an older key until you add them again.
          </Notice>
        )}
        <label>
          Your key's fingerprint (shown by <code>gpg --list-keys</code>)
          <input
            value={typed}
            placeholder="40 hex characters"
            onInput={(event) => setTyped(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="mock"
          onClick={() => setTyped(short(fakeFingerprint(`${username}-${now()}`)))}
        >
          Use example fingerprint (mock)
        </button>
        {typedFingerprint
          ? (
            <>
              <p>Export the public key:</p>
              <CopyBox
                text={`gpg --armor --export --output ${keyFile} ${typedFingerprint}`}
                hint={`Writes ${keyFile} in the current directory.`}
              />
              <FileBox
                file={keyFile}
                submit="Next"
                example={fakeArmor("PUBLIC KEY BLOCK", `${username}-key`)}
                onSubmit={(text) => {
                  if (!text.includes("PUBLIC KEY")) return "That file isn't a public key.";
                  setFingerprint(typedFingerprint);
                }}
              />
            </>
          )
          : typed && <p class="error">A fingerprint is 40 hex characters (spaces are fine).</p>}
      </>
    );
  }

  const expires = new Date(Date.now() + 600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const challenge = [
    "Wax key challenge v1",
    `Origin: ${SITE}`,
    `User: ${username}`,
    `Fingerprint: ${fingerprint}`,
    `Nonce: ${crypto.randomUUID()}`,
    `Expires: ${expires}`,
  ].join("\n");
  const challengeFile = `wax-key-challenge-${fingerprint}.asc`;
  return (
    <>
      <Steps current={offset + 1} names={names} />
      <h1>Prove you hold the private key</h1>
      <p>
        Key <code>{short(fingerprint)}</code>. Sign this challenge within 10 minutes:
      </p>
      <CopyBox
        text={clearsignCommand(challenge, challengeFile)}
        hint={`gpg asks for your passphrase, then writes ${challengeFile}.`}
      />
      <FileBox
        file={challengeFile}
        submit="Publish key"
        example={`-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n${challenge}\n${
          fakeArmor("SIGNATURE", "challenge")
        }`}
        onSubmit={() => {
          updateProfile(username, (profile) => ({
            ...profile,
            keys: [
              { fingerprint, published: now() },
              ...profile.keys.map((record) =>
                record.revoked ? record : { ...record, revoked: now() }
              ),
            ],
            proofs: profile.proofs.map((proof) => ({ ...proof, stale: true })),
          }));
          go("#/me");
        }}
      />
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
  if (!session.value) {
    return (
      <p>
        <a href="#/login">Sign in</a> first.
      </p>
    );
  }
  return (
    <p>
      Finish <a href="#/me">signing up</a> first.
    </p>
  );
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

function Settings() {
  const username = session.value?.username;
  if (!username) return <RequireSignIn />;
  const key = currentKey(me.value);
  const ignored = Object.entries(trust.value)
    .filter(([, level]) => level === "ignored")
    .map(([sender]) => sender);
  return (
    <>
      <h1>Settings</h1>
      <h2>Key</h2>
      {key
        ? (
          <>
            <p>
              <code class="fingerprint">{short(key.fingerprint)}</code>
            </p>
            <div class="row">
              <button type="button" onClick={() => go("#/settings/replace")}>Replace key</button>
              <button type="button" class="danger" onClick={() => go("#/settings/revoke")}>
                Revoke key
              </button>
            </div>
          </>
        )
        : (
          <p>
            No key. <a href="#/me">Publish one</a>.
          </p>
        )}
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
        <button type="button" class="secondary" onClick={signOut}>Sign out</button>
        <button type="button" class="danger" onClick={() => go("#/settings/delete")}>
          Delete account
        </button>
      </div>
    </>
  );
}

function Revoke() {
  const username = session.value?.username;
  const key = currentKey(me.value);
  if (!username || !key) return <RequireSignIn />;
  return (
    <>
      <h1>Revoke your key</h1>
      <Notice>
        Use this if the private key is lost or compromised. Your profile will show the key as
        revoked, and you can't send or receive messages until you publish a new one.
      </Notice>
      <CopyBox
        text={`gpg --armor --output wax-revocation.asc --gen-revoke ${key.fingerprint}`}
        hint="gpg asks for a reason and your passphrase, then writes wax-revocation.asc."
      />
      <FileBox
        file="wax-revocation.asc"
        submit="Revoke key"
        example={fakeArmor("PUBLIC KEY BLOCK", "revocation")}
        onSubmit={() => {
          updateProfile(username, (profile) => ({
            ...profile,
            keys: profile.keys.map((record, index) =>
              index === 0 ? { ...record, revoked: now() } : record
            ),
            proofs: profile.proofs.map((proof) => ({ ...proof, stale: true })),
          }));
          go("#/settings");
        }}
      />
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
    case "login":
      return <Login />;
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
      if (second === "replace") return <PublishKey replacing />;
      if (second === "revoke") return <Revoke />;
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
