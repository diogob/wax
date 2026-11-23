import { userClient } from "./db.ts";
import { WaxError } from "./errors.ts";

/**
 * Resolves the caller's user id from their JWT.
 * Never trust a user id sent in the request body.
 */
async function requireUser(
  req: Request,
): Promise<{ userId: string; authorization: string }> {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new WaxError("unauthorized");

  const { data, error } = await userClient(authorization).auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new WaxError("unauthorized");

  return { userId: data.user.id, authorization };
}

export { requireUser };
