// Revoke one of the caller's keys with an OpenPGP revocation certificate (from gpg). Stores
// the revocation and rewrites keys/<FINGERPRINT>.asc with it merged in, so anyone importing
// the key's link sees it revoked. A revoked key is never current again; the user publishes a
// new one, signed by the new key alone.
//
// Idempotent: revoking a revoked key (a retry, or another certificate) keeps the first
// revocation and rewrites the file from it. Clients offer "Retry" and resend the same body.
import { serviceClient } from "../_shared/db.ts";
import { json } from "../_shared/errors.ts";
import { readOwnKey, revokeOwnKey, storeRevocation, writeKeyFile } from "../_shared/keys.ts";
import { readStrings, serveAuthenticated } from "../_shared/serve.ts";

serveAuthenticated(async (req, { userId }) => {
  const { fingerprint, revocation } = await readStrings(req, ["fingerprint", "revocation"]);
  const service = serviceClient();
  const ownKey = await readOwnKey(service, userId, fingerprint);

  // Checks the certificate before storing it.
  const revoked = await revokeOwnKey(ownKey, revocation);
  const stored = await storeRevocation(service, userId, ownKey, revocation);
  // Another certificate was stored first: the file carries that one.
  const file = stored === revocation ? revoked : await revokeOwnKey(ownKey, stored);
  await writeKeyFile(service, file.fingerprint, file.armored);

  return json({ fingerprint: file.fingerprint });
});
