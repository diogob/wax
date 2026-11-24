// Published keys for tests. publishGpgKey goes through the production code with a real gpg
// key; the SQL helpers below call the service functions directly with placeholder keys, for
// tests of the SQL side, which only stores and compares.
import { serviceClient } from "../../supabase/functions/_shared/db.ts";
import { type OwnKey, readOwnKey, storeKey } from "../../supabase/functions/_shared/keys.ts";
import { readKeyToPublish } from "../../supabase/functions/_shared/pgp.ts";
import { createTestUser } from "./clients.ts";
import { as, uniqueUsername } from "./db.ts";
import type { GpgKey } from "./gpg.ts";

async function publishGpgKey(gpgKey: GpgKey): Promise<{ userId: string; ownKey: OwnKey }> {
  const user = await createTestUser();
  await user.client.rpc("claim_username", { name: uniqueUsername() });
  const service = serviceClient();
  const key = await readKeyToPublish(gpgKey.publicKey);

  const { data, error } = await service.rpc("create_key_challenge", {
    user_id: user.id,
    fingerprint: key.fingerprint,
  });
  if (error) throw error;
  const [challenge] = data;
  await storeKey(service, user.id, key, {
    origin: "http://localhost",
    user: challenge!.username,
    fingerprint: key.fingerprint,
    nonce: challenge!.nonce,
    expires: challenge!.expires_at,
  });

  return { userId: user.id, ownKey: await readOwnKey(service, user.id, key.fingerprint) };
}

// Any text stands in for the armored key.
const placeholderKey =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAQI=\n-----END PGP PUBLIC KEY BLOCK-----\n";

function uniqueFingerprint(): string {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase().padEnd(40, "0");
}

async function userWithName() {
  const user = await createTestUser();
  const username = uniqueUsername();
  await user.client.rpc("claim_username", { name: username });
  return { ...user, username };
}

async function createChallenge(userId: string, fingerprint: string): Promise<string> {
  const [row] = await as(
    { role: "service_role" },
    (tx) => tx`select nonce from service.create_key_challenge(${userId}, ${fingerprint})`,
  );
  return row!.nonce;
}

function publish(
  user: { id: string; username: string },
  nonce: string,
  fingerprint: string,
  replaces: string | null = null,
) {
  return as({ role: "service_role" }, async (tx) => {
    const [row] = await tx`
      select service.publish_key(
        ${user.id}, ${user.username}, ${nonce}, ${fingerprint}, ${placeholderKey}, ${replaces}
      ) as fingerprint`;
    return row!.fingerprint as string;
  });
}

async function publishFirstKey(user: { id: string; username: string }): Promise<string> {
  const fingerprint = uniqueFingerprint();
  await publish(user, await createChallenge(user.id, fingerprint), fingerprint);
  return fingerprint;
}

function revoke(user: { id: string }, fingerprint: string, revocation = "revocation") {
  return as({ role: "service_role" }, async (tx) => {
    const [row] = await tx`
      select service.revoke_key(${user.id}, ${fingerprint}, ${revocation}) as revocation`;
    return row!.revocation as string;
  });
}

export {
  createChallenge,
  placeholderKey,
  publish,
  publishFirstKey,
  publishGpgKey,
  revoke,
  uniqueFingerprint,
  userWithName,
};
