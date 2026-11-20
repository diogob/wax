// Error codes shared by all Edge Functions. Keep in sync with SQLSTATE codes (class WX).
export type ErrorCode =
  | "unauthorized"
  | "bad_request"
  | "not_implemented"
  | "internal";

const status: Record<ErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  not_implemented: 501,
  internal: 500,
};

export class WaxError extends Error {
  constructor(public code: ErrorCode, message: string = code) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  const e = err instanceof WaxError ? err : new WaxError("internal");
  if (!(err instanceof WaxError)) console.error(err);
  return json({ error: e.code, message: e.message }, status[e.code]);
}

export function json(body: unknown, init: number | ResponseInit = 200): Response {
  const opts = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    ...opts,
    headers: { "content-type": "application/json", ...corsHeaders, ...opts.headers },
  });
}

export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
