// OpenPGP helpers shared by the Edge Functions (wrapping openpgp.js).
import * as openpgp from "openpgp";
import { WaxError } from "./errors.ts";

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

// Verifies a clearsigned paste against `key` and returns the signed text (and only that).
async function verifyClearsigned(armored: string, key: openpgp.PublicKey): Promise<string> {
  let message: openpgp.CleartextMessage;
  try {
    message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
  } catch {
    throw new WaxError("bad_request", "not a clearsigned message (use gpg --clearsign)");
  }
  const { data, signatures } = await openpgp.verify({ message, verificationKeys: key });
  if (signatures.length !== 1) throw new WaxError("bad_request", "expected exactly one signature");
  try {
    await signatures[0]!.verified;
  } catch {
    throw new WaxError("bad_request", `signature is not valid for key ${fingerprint(key)}`);
  }
  return data;
}

export { fingerprint, openpgp, readPublicKey, verifyClearsigned };
