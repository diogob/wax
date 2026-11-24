// Step 2 of publishing a key: verify the signed challenge, store the cleaned key, and write
// it to the public `keys` bucket. Three cases, by the user's current key:
//
//   none                 first key: signed by the new key
//   another key          replacement: signed by the new key and the current one
//   this key             retry of the request that published it (the response was lost, or
//                        the file upload failed): verified as the first time, only the file
//                        is written again. Clients offer "Retry" and resend the same body.
import { type ServiceClient, serviceClient } from "../_shared/db.ts";
import { json, WaxError } from "../_shared/errors.ts";
import {
  type PublishedKey,
  readCurrentKey,
  type ReplacedKey,
  storeKey,
  writeKeyFile,
} from "../_shared/keys.ts";
import { type PublishableKey, readKeyToPublish, verifyClearsigned } from "../_shared/pgp.ts";
import { readStrings, serveAuthenticated, siteUrl } from "../_shared/serve.ts";
import { type KeyChallenge, parseKeyChallenge } from "../_shared/statements.ts";

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
  service: ServiceClient,
  userId: string,
  key: PublishableKey,
  challenge: KeyChallenge,
  replacing?: ReplacedKey,
): Promise<void> {
  await storeKey(service, userId, key, challenge, replacing);
  await writeKeyFile(service, key.fingerprint, key.armored);
}

// Only the request that published the key is a retry; any other is a duplicate. Writes what
// the database stored, so the file always matches it. Overwriting is safe: a revoked key is
// never current, so its file (which carries the revocation) is never rewritten here.
async function retryPublish(
  service: ServiceClient,
  currentKey: PublishedKey,
  challenge: KeyChallenge,
): Promise<void> {
  if (challenge.nonce !== currentKey.nonce) {
    throw new WaxError("conflict", "this key is already published");
  }
  await writeKeyFile(service, currentKey.fingerprint, currentKey.public_key);
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
