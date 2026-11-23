// Build and parse the statements users sign. Text only, no crypto: callers verify the
// clearsigned paste first (pgp.ts) and pass the verified text here. Spec: docs/statements.md.
import { WaxError } from "./errors.ts";

type KeyChallenge = {
  origin: string;
  user: string;
  fingerprint: string;
  nonce: string;
  expires: string;
};

type GithubProof = {
  origin: string;
  user: string;
  github: string;
  fingerprint: string;
  created: string;
};

type MessageEnvelope = {
  origin: string;
  from: string;
  to: string;
  id: string;
  sent: string;
  body: string; // armored PGP MESSAGE
};

const fields = {
  origin: ["Origin", /^https?:\/\/[^\s]+$/],
  user: ["User", /^[a-z0-9][a-z0-9_-]{1,31}$/],
  from: ["From", /^[a-z0-9][a-z0-9_-]{1,31}$/],
  to: ["To", /^[a-z0-9][a-z0-9_-]{1,31}$/],
  github: ["GitHub", /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/],
  fingerprint: ["Fingerprint", /^(?:[0-9A-F]{40}|[0-9A-F]{64})$/],
  nonce: ["Nonce", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/],
  id: ["Id", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/],
  expires: ["Expires", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/],
  created: ["Created", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/],
  sent: ["Sent", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/],
} as const;

type Field = keyof typeof fields;

const KEY_CHALLENGE = "Wax key challenge v1";
const GITHUB_PROOF = "Wax github proof v1";
const MESSAGE = "Wax message v1";

const keyChallengeFields = ["origin", "user", "fingerprint", "nonce", "expires"] as const;
const githubProofFields = ["origin", "user", "github", "fingerprint", "created"] as const;
const messageFields = ["origin", "from", "to", "id", "sent"] as const;

function checked(field: Field, value: string): string {
  const [label, pattern] = fields[field];
  if (!pattern.test(value)) throw new WaxError("bad_request", `invalid ${label}: ${value}`);
  return value;
}

function buildHeader(
  title: string,
  order: readonly Field[],
  values: Record<string, string>,
): string {
  const fieldLines = order.map((field) =>
    `${fields[field][0]}: ${checked(field, values[field] ?? "")}`
  );
  return [title, ...fieldLines].join("\n");
}

function parseHeader(
  title: string,
  order: readonly Field[],
  lines: string[],
): Record<string, string> {
  const [first, ...rest] = lines;
  if (first !== title) throw new WaxError("bad_request", `expected "${title}"`);
  if (rest.length !== order.length) {
    throw new WaxError("bad_request", `"${title}" must have exactly ${order.length} fields`);
  }
  return Object.fromEntries(order.map((field, index) => {
    const [label] = fields[field];
    const prefix = `${label}: `;
    const line = rest[index]!;
    if (!line.startsWith(prefix)) {
      throw new WaxError("bad_request", `expected ${label} on line ${index + 2}`);
    }
    return [field, checked(field, line.slice(prefix.length))];
  }));
}

// Statements are canonical: rebuild from the parsed fields and require an exact match.
function canonical(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function buildKeyChallenge(c: KeyChallenge): string {
  return buildHeader(KEY_CHALLENGE, keyChallengeFields, c);
}

function parseKeyChallenge(text: string): KeyChallenge {
  const t = canonical(text);
  const c = parseHeader(KEY_CHALLENGE, keyChallengeFields, t.split("\n")) as KeyChallenge;
  if (buildKeyChallenge(c) !== t) throw new WaxError("bad_request", "statement is not canonical");
  return c;
}

function buildGithubProof(p: GithubProof): string {
  return buildHeader(GITHUB_PROOF, githubProofFields, p);
}

function parseGithubProof(text: string): GithubProof {
  const t = canonical(text);
  const p = parseHeader(GITHUB_PROOF, githubProofFields, t.split("\n")) as GithubProof;
  if (buildGithubProof(p) !== t) throw new WaxError("bad_request", "statement is not canonical");
  return p;
}

const ARMORED_MESSAGE =
  /^-----BEGIN PGP MESSAGE-----\n(?:(?!-----)[\s\S])*\n-----END PGP MESSAGE-----$/;

function buildMessage(m: MessageEnvelope): string {
  const header = buildHeader(MESSAGE, messageFields, m);
  if (!ARMORED_MESSAGE.test(m.body)) {
    throw new WaxError("bad_request", "body must be one armored PGP MESSAGE");
  }
  return `${header}\n\n${m.body}`;
}

function parseMessage(text: string): MessageEnvelope {
  const t = canonical(text);
  const split = t.indexOf("\n\n");
  if (split < 0) throw new WaxError("bad_request", "message has no body");
  const header = parseHeader(MESSAGE, messageFields, t.slice(0, split).split("\n"));
  const m = { ...header, body: t.slice(split + 2) } as MessageEnvelope;
  if (buildMessage(m) !== t) throw new WaxError("bad_request", "statement is not canonical");
  return m;
}

export {
  buildGithubProof,
  buildKeyChallenge,
  buildMessage,
  parseGithubProof,
  parseKeyChallenge,
  parseMessage,
};
export type { GithubProof, KeyChallenge, MessageEnvelope };
