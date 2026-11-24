// OpenPGP helpers shared by the Edge Functions (wrapping openpgp.js).
import * as openpgp from "openpgp";
import { WaxError } from "./errors.ts";

// Limits for published keys (docs/contracts.md "## Keys").
const MAX_ARMORED_BYTES = 64 * 1024;
const MAX_USER_IDS = 10;
const MAX_SUBKEYS = 10;

// Only readKeyToPublish can produce a PublishableKey: it is branded with a symbol that is
// not exported, so other modules can't write an object literal of this type.
const checked: unique symbol = Symbol("checked");

/** A key that passed the publishing checks, already cleaned. */
type PublishableKey = {
  readonly fingerprint: string;
  readonly armored: string; // the cleaned copy: what Wax stores and serves
  readonly userIds: readonly string[];
  readonly [checked]: true;
};

async function readPublicKey(armored: string): Promise<openpgp.PublicKey> {
  try {
    const key = await openpgp.readKey({ armoredKey: armored });
    if (key.isPrivate()) throw new WaxError("bad_request", "paste a public key, not a private key");
    return key as openpgp.PublicKey;
  } catch (err) {
    if (err instanceof WaxError) throw err;
    throw new WaxError("bad_request", "not an armored OpenPGP public key");
  }
}

function fingerprint(key: openpgp.PublicKey): string {
  return key.getFingerprint().toUpperCase();
}

// Reads a key for publishing: checks the limits, that it is usable (not expired or revoked,
// can encrypt), and returns a copy with only the primary key, user IDs, their
// self-signatures and the subkeys. Third-party signatures and attributes (photos) are dropped.
async function readKeyToPublish(armored: string): Promise<PublishableKey> {
  if (new TextEncoder().encode(armored).length > MAX_ARMORED_BYTES) {
    throw new WaxError("bad_request", "key is larger than 64 KB");
  }
  const key = await readPublicKey(armored);
  const users = key.users.filter((user) => user.userID !== null);
  if (users.length > MAX_USER_IDS) {
    throw new WaxError("bad_request", `key has more than ${MAX_USER_IDS} user IDs`);
  }
  if (key.subkeys.length > MAX_SUBKEYS) {
    throw new WaxError("bad_request", `key has more than ${MAX_SUBKEYS} subkeys`);
  }

  users.forEach((user) => {
    user.otherCertifications = [];
  });
  key.users = users;

  try {
    await key.verifyPrimaryKey();
  } catch {
    throw new WaxError("bad_request", "key is expired, revoked or has no valid user ID");
  }
  try {
    await key.getEncryptionKey();
  } catch {
    throw new WaxError("bad_request", "key has no usable encryption subkey");
  }
  return {
    fingerprint: fingerprint(key),
    armored: key.armor(),
    userIds: key.getUserIDs(),
    [checked]: true,
  };
}

// Verifies a clearsigned paste and returns the signed text (and only that). It must carry
// exactly one valid signature by each of `armoredKeys` and nothing else.
async function verifyClearsigned(armored: string, armoredKeys: string[]): Promise<string> {
  const keys = await Promise.all(armoredKeys.map(readPublicKey));
  let message: openpgp.CleartextMessage;
  try {
    message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
  } catch {
    throw new WaxError("bad_request", "not a clearsigned message (use gpg --clearsign)");
  }
  const { data, signatures } = await openpgp.verify({ message, verificationKeys: keys });
  if (signatures.length !== keys.length) {
    throw new WaxError(
      "bad_request",
      keys.length === 1 ? "expected exactly one signature" : `expected ${keys.length} signatures`,
    );
  }
  const results = await Promise.all(
    signatures.map((signature) => signature.verified.then(() => signature.keyID, () => null)),
  );
  const missing = keys.filter((key) =>
    !key.getKeyIDs().some((keyID) => results.some((signer) => signer?.equals(keyID)))
  );
  if (missing.length > 0) {
    throw new WaxError(
      "bad_request",
      `signature is not valid for key ${missing.map(fingerprint).join(", ")}`,
    );
  }
  return data;
}

export { readKeyToPublish, verifyClearsigned };
export type { PublishableKey };
