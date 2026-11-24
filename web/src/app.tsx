// The app. Pages not built yet are still in the mock (web/mock.html), which shrinks as they
// move here. Pages and flows: docs/ui.md; calls: docs/contracts.md.
import { useState } from "preact/hooks";
import { callFunction, type Failure, fromRpc, type Result } from "./call.ts";
import { go, route } from "./route.ts";
import {
  account,
  currentKey,
  loadProfile,
  profile,
  type ProfileKey,
  signIn,
  signOut,
  username,
} from "./session.ts";
import type { Api } from "./supabase.ts";
import {
  ago,
  clearsignCommand,
  CopyBox,
  ErrorNotice,
  FileBox,
  Handle,
  NavBar,
  Notice,
  short,
  Steps,
} from "./ui.tsx";

type KeyChallenge = { challenge: string; fingerprint: string; userIds: string[] };

// One request at a time: `busy` while it runs; on failure, the error and a retry that sends
// the same request again.
function useCall() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ failure: Failure; retry: () => void } | null>(null);
  const run = async <T,>(request: () => Promise<Result<T>>, onData: (data: T) => void) => {
    setBusy(true);
    setFailed(null);
    const result = await request();
    setBusy(false);
    if (result.failure) {
      return setFailed({ failure: result.failure, retry: () => run(request, onData) });
    }
    onData(result.data);
  };
  const error = failed && <ErrorNotice failure={failed.failure} onRetry={failed.retry} />;
  return { busy, run, error };
}

// Public Storage object per key (docs/contracts.md ## Keys).
function keyUrl(api: Api, fingerprint: string): string {
  return api.storage.from("keys").getPublicUrl(`${fingerprint}.asc`).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function Home() {
  return (
    <>
      <h1>Wax</h1>
      <p>
        A directory of OpenPGP keys, linked to GitHub accounts, and a way to send signed, encrypted
        messages. Your private key never leaves your machine: Wax shows you gpg commands to run.
      </p>
      {account.value === null && <a href="#/login">Sign in or sign up</a>}
      {username.value && <a href="#/me">Your keys</a>}
    </>
  );
}

function Login({ api }: { api: Api }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, run, error } = useCall();
  if (account.value) return <p>You're signed in.</p>;
  if (sent) {
    return (
      <>
        <h1>Check your email</h1>
        <p>We sent a sign-in link to {email}. Open it in this browser.</p>
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
      {error}
      <button
        type="button"
        disabled={!email.includes("@") || busy}
        onClick={() => run(() => signIn(api, email), () => setSent(true))}
      >
        Send link
      </button>
    </>
  );
}

// A signed-in user without a username is always sent here.
function ChooseUsername({ api }: { api: Api }) {
  const [name, setName] = useState("");
  const { busy, run, error } = useCall();
  return (
    <>
      <Steps current={0} names={["Username", "Public key", "Sign challenge"]} />
      <h1>Choose a username</h1>
      <p>2–32 of a-z, 0-9, _ and -, starting with a letter or digit. It can't be changed later.</p>
      <input value={name} onInput={(event) => setName(event.currentTarget.value)} />
      {error}
      <button
        type="button"
        disabled={!name || busy}
        onClick={() =>
          run(
            async () => fromRpc(await api.rpc("claim_username", { name })),
            (claimed) => {
              username.value = claimed;
              loadProfile(api);
              go("#/me");
            },
          )}
      >
        Claim
      </button>
    </>
  );
}

// Sign-up, then the user's own keys.
function Me({ api }: { api: Api }) {
  const name = username.value;
  const keys = profile.value?.keys;
  if (!name || !keys) return <p>Loading…</p>;
  const key = currentKey(keys);
  // After revoking their key, the user publishes a new one (signed by it alone).
  if (!key) return <PublishKey api={api} again={keys.length > 0} />;
  return (
    <>
      <h1>
        <Handle username={name} />
      </h1>
      <h2>Key</h2>
      <code class="fingerprint">{short(key.fingerprint!)}</code>
      <p>Anyone can import it:</p>
      <CopyBox
        text={`curl -sf ${keyUrl(api, key.fingerprint!)} | gpg --import`}
        hint={`Check that gpg prints ${short(key.fingerprint!)}.`}
      />
      <KeyHistory api={api} keys={keys} />
    </>
  );
}

function KeyHistory({ api, keys }: { api: Api; keys: ProfileKey[] }) {
  return (
    <>
      <h2>Key history</h2>
      <ul class="keys">
        {keys.map((record) => (
          <li>
            <code class="fingerprint">{short(record.fingerprint!)}</code>
            <span class="meta">
              <a href={keyUrl(api, record.fingerprint!)}>key file</a>
              {" · "}
              published {ago(record.published_at!)}
              {record.revoked_at
                ? <span class="stale">revoked {ago(record.revoked_at)}</span>
                : record.replaced_by
                ? <span class="meta-note">replaced</span>
                : <span class="ok">current</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Two pages, one command each: export the key (then key-challenge), then sign the challenge
// (then publish-key). Replacing a key signs with the new and the current key.
function PublishKey(
  { api, replacing, again }: { api: Api; replacing?: ProfileKey; again?: boolean },
) {
  const [typed, setTyped] = useState("");
  const [started, setStarted] = useState<{ publicKey: string; challenge: KeyChallenge } | null>(
    null,
  );
  const { busy, run, error } = useCall();
  const names = replacing || again
    ? ["New public key", "Sign challenge"]
    : ["Username", "Public key", "Sign challenge"];
  const offset = names.length === 2 ? 0 : 1;

  if (!started) {
    // gpg prints fingerprints in groups of four; accept that and normalize.
    const normalized = typed.replaceAll(" ", "").toUpperCase();
    const fingerprint = /^([0-9A-F]{40}|[0-9A-F]{64})$/.test(normalized) ? normalized : "";
    const keyFile = `wax-public-key-${fingerprint}.asc`;
    return (
      <>
        <Steps current={offset} names={names} />
        <h1>{replacing ? "Replace your key" : "Publish your public key"}</h1>
        {again && (
          <Notice>Your key is revoked. Publish a new one, signed by the new key alone.</Notice>
        )}
        <label>
          {replacing || again ? "Your new key's" : "Your key's"} fingerprint (shown by{" "}
          <code>gpg --list-keys</code>)
          <input
            value={typed}
            placeholder="40 hex characters"
            onInput={(event) => setTyped(event.currentTarget.value)}
          />
        </label>
        {fingerprint
          ? (
            <>
              <p>Export the public key:</p>
              <CopyBox
                text={`gpg --armor --export --output ${keyFile} ${fingerprint}`}
                hint={`Writes ${keyFile} in the current directory.`}
              />
              {error}
              <FileBox
                file={keyFile}
                submit="Next"
                busy={busy}
                onSubmit={(publicKey) => {
                  run(
                    () => callFunction<KeyChallenge>(api, "key-challenge", { publicKey }),
                    (challenge) => setStarted({ publicKey, challenge }),
                  );
                }}
              />
            </>
          )
          : typed && <p class="error">A fingerprint is 40 hex characters (spaces are fine).</p>}
      </>
    );
  }

  const { publicKey, challenge } = started;
  const fingerprint = challenge.fingerprint;
  const challengeFile = `wax-key-challenge-${fingerprint}.asc`;
  const signers = replacing ? [fingerprint, replacing.fingerprint!] : [fingerprint];
  return (
    <>
      <Steps current={offset + 1} names={names} />
      <h1>Prove you hold the private key</h1>
      <p>
        Key <code>{short(fingerprint)}</code>. Its user IDs become public:
      </p>
      <ul>
        {challenge.userIds.map((userId) => <li key={userId}>{userId}</li>)}
      </ul>
      <p>
        Sign this challenge within 10 minutes{replacing
          ? (
            <>
              , with the new key and your current key <code>{short(replacing.fingerprint!)}</code>
            </>
          )
          : ""}:
      </p>
      <CopyBox
        text={clearsignCommand(challenge.challenge, challengeFile, signers)}
        hint={`gpg asks for your passphrase, then writes ${challengeFile}.`}
      />
      {error}
      <FileBox
        file={challengeFile}
        submit={replacing ? "Replace key" : "Publish key"}
        busy={busy}
        onSubmit={(signed) => {
          run(
            () => callFunction(api, "publish-key", { publicKey, signed }),
            async () => {
              await loadProfile(api);
              go("#/me");
            },
          );
        }}
      />
      <p>
        <button type="button" class="secondary" onClick={() => setStarted(null)}>
          Start over
        </button>
      </p>
    </>
  );
}

function Settings({ api }: { api: Api }) {
  const keys = profile.value?.keys;
  if (!keys) return <p>Loading…</p>;
  const key = currentKey(keys);
  return (
    <>
      <h1>Settings</h1>
      <h2>Key</h2>
      {key
        ? (
          <p>
            <code class="fingerprint">{short(key.fingerprint!)}</code>
          </p>
        )
        : (
          <p>
            No key. <a href="#/me">Publish one</a>.
          </p>
        )}
      <div class="row">
        {key && <button type="button" onClick={() => go("#/settings/replace")}>Replace key</button>}
        {keys.some((record) => !record.revoked_at) && (
          <button
            type="button"
            class="danger"
            onClick={() => go("#/settings/revoke")}
          >
            Revoke a key
          </button>
        )}
      </div>
      <h2>Account</h2>
      <p>{account.value?.email}</p>
      <div class="row">
        <button type="button" class="secondary" onClick={() => signOut(api)}>Sign out</button>
      </div>
    </>
  );
}

function ReplaceKey({ api }: { api: Api }) {
  const keys = profile.value?.keys;
  if (!keys) return <p>Loading…</p>;
  const key = currentKey(keys);
  if (!key) return <PublishKey api={api} again />;
  return <PublishKey api={api} replacing={key} />;
}

// Any key that isn't revoked yet: the current one, or one it replaced.
function RevokeKey({ api }: { api: Api }) {
  const keys = profile.value?.keys?.filter((record) => !record.revoked_at);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const { busy, run, error } = useCall();
  if (!keys) return <p>Loading…</p>;
  if (keys.length === 0) return <p>All your keys are revoked.</p>;
  const fingerprint = picked ?? keys[0]!.fingerprint!;
  const file = `wax-revocation-${fingerprint}.asc`;
  return (
    <>
      <h1>Revoke a key</h1>
      <Notice>
        Use this if a private key is lost or compromised. Its key file will show it as revoked. If
        it's your current key, you can't send or receive messages until you publish a new one.
      </Notice>
      {keys.length > 1 && keys.map((record) => (
        <label class="choice">
          <input
            type="radio"
            name="key"
            checked={record.fingerprint === fingerprint}
            onChange={() => setPicked(record.fingerprint!)}
          />{" "}
          <code>{short(record.fingerprint!)}</code>{" "}
          {record.replaced_by ? "(replaced)" : "(current)"}
        </label>
      ))}
      <CopyBox
        text={`gpg --armor --output ${file} --gen-revoke ${fingerprint}`}
        hint={`gpg asks for a reason and your passphrase, then writes ${file}. Or use the certificate gpg made with the key: ~/.gnupg/openpgp-revocs.d/${fingerprint}.rev`}
      />
      {error}
      <FileBox
        key={fingerprint}
        file={file}
        submit="Revoke key"
        busy={busy}
        onSubmit={(revocation) => {
          run(
            () => callFunction(api, "revoke-key", { fingerprint, revocation }),
            async () => {
              await loadProfile(api);
              go("#/settings");
            },
          );
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout and router
// ---------------------------------------------------------------------------

function Nav() {
  const name = username.value;
  return (
    <NavBar
      links={account.value && (
        <div class="links" id="nav-links">
          <a href="#/me">{name ? <Handle username={name} /> : "Finish sign-up"}</a>
          <a href="#/settings">Settings</a>
        </div>
      )}
    >
      {account.value === null && <a href="#/login">Sign in</a>}
    </NavBar>
  );
}

function Page({ api }: { api: Api }) {
  const [, first, second] = route.value.slice(1).split("/");
  // Signed in without a username: always choose one first.
  if (account.value && username.value === null) return <ChooseUsername api={api} />;
  if (first === "" || first === undefined) return <Home />;
  if (first === "login") return <Login api={api} />;
  if (account.value === undefined || (account.value && username.value === undefined)) {
    return <p>Loading…</p>;
  }
  if (!account.value) {
    return (
      <p>
        <a href="#/login">Sign in</a> first.
      </p>
    );
  }
  if (first === "me" && !second) return <Me api={api} />;
  if (first === "settings" && !second) return <Settings api={api} />;
  if (first === "settings" && second === "replace") return <ReplaceKey api={api} />;
  if (first === "settings" && second === "revoke") return <RevokeKey api={api} />;
  return <p>Not found.</p>;
}

function App({ api }: { api: Api }) {
  return (
    <>
      <Nav />
      <main key={route.value}>
        <Page api={api} />
      </main>
    </>
  );
}

export { App };
