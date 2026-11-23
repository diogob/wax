// In-memory fake backend for the UI mock. Nothing here talks to Supabase.
import { computed, signal } from "@preact/signals";

type Trust = "unknown" | "accepted" | "ignored";

type Proof = { github: string; created: string; stale: boolean };

type KeyRecord = { fingerprint: string; published: string; revoked?: string };

type Profile = {
  username: string;
  keys: KeyRecord[]; // newest first; keys[0] is current unless revoked
  proofs: Proof[];
};

type Message = {
  id: string;
  from: string;
  to: string;
  sent: string;
  armored: string;
  read: boolean;
};

type Session = { email: string; username?: string };

const SITE = "https://example.github.io/wax";

// Deterministic, random-looking hex from a seed (FNV-1a, then an xorshift per digit).
function fakeFingerprint(seed: string): string {
  let state = [...seed].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
  const digits = Array.from({ length: 40 }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 16).toString(16);
  });
  return digits.join("").toUpperCase();
}

function fakeArmor(kind: "MESSAGE" | "PUBLIC KEY BLOCK" | "SIGNATURE", seed: string): string {
  const lines = [0, 1, 2, 3].map((index) =>
    btoa(`${seed}-${index}-wax-mock`.repeat(2)).slice(0, 64)
  );
  return [`-----BEGIN PGP ${kind}-----`, "", ...lines, `-----END PGP ${kind}-----`].join("\n");
}

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
}

const seedProfiles: Profile[] = [
  {
    username: "bob",
    keys: [
      { fingerprint: fakeFingerprint("bob-2"), published: daysAgo(400) },
      { fingerprint: fakeFingerprint("bob-1"), published: daysAgo(1200), revoked: daysAgo(400) },
    ],
    proofs: [{ github: "bob-gh", created: daysAgo(390), stale: false }],
  },
  {
    username: "carol",
    keys: [{ fingerprint: fakeFingerprint("carol"), published: daysAgo(30) }],
    proofs: [
      { github: "carol-dev", created: daysAgo(29), stale: false },
      { github: "carol-old", created: daysAgo(200), stale: true },
    ],
  },
  {
    username: "mallory",
    keys: [{ fingerprint: fakeFingerprint("mallory"), published: daysAgo(0) }],
    proofs: [],
  },
  { username: "dave", keys: [], proofs: [] },
];

const profiles = signal<Record<string, Profile>>(
  Object.fromEntries(seedProfiles.map((profile) => [profile.username, profile])),
);
const session = signal<Session | null>(null);
const messages = signal<Message[]>([]);
// Recipients who have accepted the signed-in user, so one knock doesn't apply to them.
const acceptsMe = ["bob"];
// How the signed-in user rates each sender.
const trust = signal<Record<string, Trust>>({});

const me = computed(() => {
  const username = session.value?.username;
  return username ? profiles.value[username] : undefined;
});

function currentKey(profile: Profile | undefined): KeyRecord | undefined {
  const key = profile?.keys[0];
  return key && !key.revoked ? key : undefined;
}

function trustOf(sender: string): Trust {
  return trust.value[sender] ?? "unknown";
}

function updateProfile(username: string, change: (profile: Profile) => Profile) {
  const profile = profiles.value[username]!;
  profiles.value = { ...profiles.value, [username]: change(profile) };
}

function receive(from: string, read = false, sent = now()) {
  const to = session.value!.username!;
  const message = {
    id: crypto.randomUUID(),
    from,
    to,
    sent,
    armored: fakeArmor("MESSAGE", `${from}-${sent}`),
    read,
  };
  messages.value = [message, ...messages.value];
}

/** Mock shortcut: a fully set-up account with some history. */
function signInAsAlice() {
  session.value = { email: "alice@example.com", username: "alice" };
  profiles.value = {
    ...profiles.value,
    alice: {
      username: "alice",
      keys: [{ fingerprint: fakeFingerprint("alice"), published: daysAgo(90) }],
      proofs: [{ github: "alice-gh", created: daysAgo(89), stale: false }],
    },
  };
  trust.value = { bob: "accepted" };
  messages.value = [];
  receive("bob", true, daysAgo(3));
  receive("carol", false, daysAgo(1));
}

function signOut() {
  session.value = null;
  location.hash = "#/";
}

export {
  acceptsMe,
  currentKey,
  daysAgo,
  fakeArmor,
  fakeFingerprint,
  me,
  messages,
  now,
  profiles,
  receive,
  session,
  signInAsAlice,
  signOut,
  SITE,
  trust,
  trustOf,
  updateProfile,
};
export type { KeyRecord, Message, Profile, Proof, Session, Trust };
