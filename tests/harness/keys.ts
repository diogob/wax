// Publishes a real gpg key for a new test user through the production code (the same SQL and
// keys.ts functions publish-key uses), without the signed-challenge round trip.
import { serviceClient } from "../../supabase/functions/_shared/db.ts";
import { type OwnKey, readOwnKey, storeKey } from "../../supabase/functions/_shared/keys.ts";
import { readKeyToPublish } from "../../supabase/functions/_shared/pgp.ts";
import { createTestUser } from "./clients.ts";
import { uniqueUsername } from "./db.ts";
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

export { publishGpgKey };
