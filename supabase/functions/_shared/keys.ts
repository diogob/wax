// Keys, on the database and Storage side: the caller's published keys, publishing, revoking,
// and the key files (keys/<FINGERPRINT>.asc in the public `keys` bucket). The database is the
// source of truth; files are derived from it and rewritten on retry.
// Rules: docs/contracts.md "## Keys". Crypto lives in pgp.ts; Edge Functions use this module.
import type { ServiceClient } from "./db.ts";
import { fromRpc, WaxError } from "./errors.ts";
import { type PublishableKey, type RevokedKey, revokeKey } from "./pgp.ts";
import type { KeyChallenge } from "./statements.ts";

// Only readOwnKey can produce an OwnKey: it is branded with a symbol that is not exported.
const owned: unique symbol = Symbol("owned");

/** One of the caller's published keys (current or replaced), as stored (cleaned). */
type OwnKey = {
  readonly fingerprint: string;
  readonly armored: string;
  readonly [owned]: true;
};

// Derived from what current_key returns, narrowed to what each caller needs.
type CurrentKeyRow = NonNullable<Awaited<ReturnType<typeof readCurrentKey>>>;
type ReplacedKey = Pick<CurrentKeyRow, "fingerprint">;
type PublishedKey = Pick<CurrentKeyRow, "fingerprint" | "public_key" | "nonce">;

/**
 * The user's current key (none if they have no key or it is revoked), with the challenge
 * nonce that published it and the key it replaced. replaced_public_key is null for a first
 * key, though the generated type says string.
 */
async function readCurrentKey(service: ServiceClient, userId: string) {
  const { data, error } = await service.rpc("current_key", { user_id: userId });
  if (error) throw fromRpc(error);
  return data[0];
}

/** Stores a verified key, as the user's first key or replacing their current one. */
async function storeKey(
  service: ServiceClient,
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
}

/** One of the user's keys, current or replaced. Fails with bad_request if it isn't theirs. */
async function readOwnKey(
  service: ServiceClient,
  userId: string,
  fingerprint: string,
): Promise<OwnKey> {
  const { data, error } = await service.rpc("own_key", { user_id: userId, fingerprint });
  if (error) throw fromRpc(error);
  const [row] = data;
  if (!row) throw new WaxError("bad_request", "this key is not one of yours");
  return { fingerprint: row.fingerprint, armored: row.public_key, [owned]: true };
}

/** Merges a revocation certificate into one of the user's keys, after checking it. */
function revokeOwnKey(key: OwnKey, revocation: string): Promise<RevokedKey> {
  return revokeKey(key.armored, revocation);
}

/**
 * Records the revocation of one of the user's keys. Returns the revocation the database
 * keeps: `revocation`, or an earlier one if the key was already revoked.
 */
async function storeRevocation(
  service: ServiceClient,
  userId: string,
  key: OwnKey,
  revocation: string,
): Promise<string> {
  const { data, error } = await service.rpc("revoke_key", {
    user_id: userId,
    fingerprint: key.fingerprint,
    revocation,
  });
  if (error) throw fromRpc(error);
  return data;
}

/**
 * Writes (or overwrites) a key file. Fails with `unavailable`: the database change already
 * happened, and resending the same request rewrites the file.
 */
async function writeKeyFile(
  service: ServiceClient,
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
    throw new WaxError("unavailable", "saved, but the key file wasn't written; retry");
  }
}

export { readCurrentKey, readOwnKey, revokeOwnKey, storeKey, storeRevocation, writeKeyFile };
export type { OwnKey, PublishedKey, ReplacedKey };
