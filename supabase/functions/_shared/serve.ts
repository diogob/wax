import { requireUser } from "./auth.ts";
import { corsHeaders, errorResponse, WaxError } from "./errors.ts";

type Handler = (req: Request, ctx: { userId: string; authorization: string }) => Promise<Response>;

/** Wraps a handler with CORS, POST-only, auth and error mapping. */
function serveAuthenticated(handler: Handler) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") return new Response(null, { status: 405, headers: corsHeaders });
    try {
      return await handler(req, await requireUser(req));
    } catch (err) {
      return errorResponse(err);
    }
  });
}

/** Reads a JSON body and returns the named fields, each required to be a string. */
async function readStrings<Name extends string>(
  req: Request,
  names: Name[],
): Promise<Record<Name, string>> {
  const body: unknown = await req.json().catch(() => null);
  const values = names.map((name) => [name, (body as Record<string, unknown> | null)?.[name]]);
  const missing = values.filter(([, value]) => typeof value !== "string").map(([name]) => name);
  if (missing.length > 0) {
    throw new WaxError("bad_request", `expected a JSON body with ${missing.join(", ")}`);
  }
  return Object.fromEntries(values) as Record<Name, string>;
}

/** The public site URL; statements carry it as Origin. */
function siteUrl(): string {
  const url = Deno.env.get("WAX_SITE_URL");
  if (!url) throw new Error("WAX_SITE_URL is not set");
  return url;
}

export { readStrings, serveAuthenticated, siteUrl };
