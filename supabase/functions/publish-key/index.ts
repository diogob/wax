// Step 2 of publishing a key: verify the signed challenge, store the cleaned key, and write
// it to the public `keys` bucket. Three cases, by the user's current key:
//
//   none                 first key: signed by the new key
//   another key          replacement: signed by the new key and the current one
//   this key             retry of the request that published it (the response was lost, or
//                        the file upload failed): verified as the first time, only the file
//                        is written again. Clients offer "Retry" and resend the same body.
import { fromRpc, json, WaxError } from "../_shared/errors.ts";
import { serviceClient } from "../_shared/db.ts";
import { type PublishableKey, readKeyToPublish, verifyClearsigned } from "../_shared/pgp.ts";
import { readStrings, serveAuthenticated, siteUrl } from "../_shared/serve.ts";
import { type KeyChallenge, parseKeyChallenge } from "../_shared/statements.ts";

type Service = ReturnType<typeof serviceClient>;
// Derived from what current_key returns, narrowed to what each function needs.
type CurrentKeyRow = NonNullable<Awaited<ReturnType<typeof readCurrentKey>>>;
type ReplacedKey = Pick<CurrentKeyRow, "fingerprint">;
type PublishedKey = Pick<CurrentKeyRow, "fingerprint" | "public_key" | "nonce">;

serveAuthenticated(async (req, { userId }) => {
  const { publicKey, signed } = await readStrings(req, ["publicKey", "signed"]);
  const key = await readKeyToPublish(publicKey);
  const service = serviceClient();
  const currentKey = await readCurrentKey(service, userId);

  if (!currentKey) {
    const challenge = await verifyChallenge(signed, key, []);
    await publishOrReplaceKey(service, userId, key, challenge);
  } else if (currentKey.fingerprint === key.fingerprint) {
    // Signed as the first time: by this key, plus the key it replaced, if any.
    // replaced_public_key is null for a first key (the generated type says string).
    const challenge = await verifyChallenge(
      signed,
      key,
      currentKey.replaced_public_key ? [currentKey.replaced_public_key] : [],
    );
    await retryPublish(service, currentKey, challenge);
  } else {
    const challenge = await verifyChallenge(signed, key, [currentKey.public_key]);
    await publishOrReplaceKey(service, userId, key, challenge, currentKey);
  }

  return json({ fingerprint: key.fingerprint });
});

async function publishOrReplaceKey(
  service: Service,
  userId: string,
  key: PublishableKey,
  challenge: KeyChallenge,
  replacing?: ReplacedKey,
): Promise<void> {
  const { error } = await service.rpc("publish_key", {
    user_id: userId,
    username: challenge.user,
    nonce: challenge.nonce,
    fingerprint: key.fingerprint,
    public_key: key.armored,
    replaces: replacing?.fingerprint,
  });
  if (error) throw fromRpc(error);
  await writeKeyFile(service, key.fingerprint, key.armored);
}

// Only the request that published the key is a retry; any other is a duplicate. Writes what
// the database stored, so the file always matches it.
async function retryPublish(
  service: Service,
  currentKey: PublishedKey,
  challenge: KeyChallenge,
): Promise<void> {
  if (challenge.nonce !== currentKey.nonce) {
    throw new WaxError("conflict", "this key is already published");
  }
  await writeKeyFile(service, currentKey.fingerprint, currentKey.public_key);
}

async function readCurrentKey(service: Service, userId: string) {
  const { data, error } = await service.rpc("current_key", { user_id: userId });
  if (error) throw fromRpc(error);
  return data[0];
}

// Verifies `signed` is the challenge for `key`, signed by it and by each of `otherSigners`.
async function verifyChallenge(
  signed: string,
  key: PublishableKey,
  otherSigners: string[],
): Promise<KeyChallenge> {
  const text = await verifyClearsigned(signed, [key.armored, ...otherSigners]);
  const challenge = parseKeyChallenge(text);
  if (challenge.origin !== siteUrl()) {
    throw new WaxError("bad_request", "the statement is for another site");
  }
  if (challenge.fingerprint !== key.fingerprint) {
    throw new WaxError("bad_request", "the statement is for another key");
  }
  return challenge;
}

// Overwriting is safe: the content only ever comes from the stored key, and a revoked key
// (step 3) is no longer current, so its file is never rewritten here.
async function writeKeyFile(
  service: Service,
  fingerprint: string,
  armored: string,
): Promise<void> {
  const { error } = await service.storage.from("keys").upload(`${fingerprint}.asc`, armored, {
    contentType: "application/pgp-keys",
    cacheControl: "86400",
    upsert: true,
  });
  if (error) {
    console.error(error);
    throw new WaxError("unavailable", "your key is published, but its file wasn't saved; retry");
  }
}
