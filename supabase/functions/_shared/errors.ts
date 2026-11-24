// Error codes shared by all Edge Functions. Keep in sync with SQLSTATE codes (class WX).
type ErrorCode =
  | "unauthorized"
  | "bad_request"
  | "conflict"
  | "not_implemented"
  | "unavailable"
  | "internal";

const status: Record<ErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  conflict: 409,
  not_implemented: 501,
  unavailable: 503,
  internal: 500,
};

class WaxError extends Error {
  constructor(public code: ErrorCode, message: string = code) {
    super(message);
  }
}

function errorResponse(err: unknown): Response {
  const error = err instanceof WaxError ? err : new WaxError("internal");
  if (!(err instanceof WaxError)) console.error(err);
  return json({ error: error.code, message: error.message }, status[error.code]);
}

// SQLSTATEs raised by Wax SQL functions; messages start with "<code>: ".
const sqlCodes: Record<string, ErrorCode> = {
  WX002: "unauthorized",
  WX003: "bad_request",
  WX004: "conflict",
};

/**
 * Turns an error returned by `.rpc()` into a WaxError with the SQL message. Anything else
 * becomes a plain Error, which errorResponse logs and reports as "internal".
 */
function fromRpc(error: { code?: string; message: string }): Error {
  const code = sqlCodes[error.code ?? ""];
  return !code
    ? new Error(`rpc failed: ${error.code} ${error.message}`)
    : new WaxError(code, error.message.replace(/^[a-z_]+: /, ""));
}

function json(body: unknown, init: number | ResponseInit = 200): Response {
  const opts = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    ...opts,
    headers: { "content-type": "application/json", ...corsHeaders, ...opts.headers },
  });
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export { corsHeaders, errorResponse, fromRpc, json, WaxError };
export type { ErrorCode };
