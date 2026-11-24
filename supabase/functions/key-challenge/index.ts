// Step 1 of publishing a key: check the key and return the statement to sign with it.
import { fromRpc, json } from "../_shared/errors.ts";
import { serviceClient } from "../_shared/db.ts";
import { readKeyToPublish } from "../_shared/pgp.ts";
import { readStrings, serveAuthenticated, siteUrl } from "../_shared/serve.ts";
import { buildKeyChallenge } from "../_shared/statements.ts";

serveAuthenticated(async (req, { userId }) => {
  const { publicKey } = await readStrings(req, ["publicKey"]);
  const key = await readKeyToPublish(publicKey);

  const { data, error } = await serviceClient().rpc("create_key_challenge", {
    user_id: userId,
    fingerprint: key.fingerprint,
  });
  if (error) throw fromRpc(error);
  const [row] = data;
  if (!row) throw new Error("create_key_challenge returned no row");

  const challenge = buildKeyChallenge({
    origin: siteUrl(),
    user: row.username,
    fingerprint: key.fingerprint,
    nonce: row.nonce,
    expires: new Date(row.expires_at).toISOString().replace(/\.\d+Z$/, "Z"),
  });
  // userIds: shown before publishing, since they become public.
  return json({ challenge, fingerprint: key.fingerprint, userIds: key.userIds });
});
