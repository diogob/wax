import { requireUser } from "./auth.ts";
import { corsHeaders, errorResponse } from "./errors.ts";

type Handler = (req: Request, ctx: { userId: string; authorization: string }) => Promise<Response>;

/** Wraps a handler with CORS, POST-only, auth and error mapping. */
export function serveAuthenticated(handler: Handler) {
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
