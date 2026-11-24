// Calls to Edge Functions and RPCs, with errors in one shape. Retry rules: docs/ui.md.
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import type { ErrorCode } from "../../supabase/functions/_shared/errors.ts";
import type { Api } from "./supabase.ts";

type Failure = { code: ErrorCode | "network"; message: string };
type Result<T> = { data: T; failure?: undefined } | { data?: undefined; failure: Failure };

const networkFailure: Failure = {
  code: "network",
  message: "Couldn't reach Wax. Check your connection.",
};
const internalFailure: Failure = { code: "internal", message: "Something went wrong on our side." };

// The request may have succeeded, or may succeed if sent again: offer Retry with the same body.
function retryable(failure: Failure): boolean {
  return ["unavailable", "internal", "network"].includes(failure.code);
}

/** POSTs `body` to an Edge Function, signed in as the current user. */
async function callFunction<T>(
  api: Api,
  name: string,
  body: Record<string, string>,
): Promise<Result<T>> {
  const { data, error } = await api.functions.invoke<T>(name, { body });
  if (!error) return { data: data as T };
  if (error instanceof FunctionsFetchError) return { failure: networkFailure };
  if (error instanceof FunctionsHttpError) {
    const response: Response = error.context;
    const parsed = await response.json().catch(() => null);
    if (parsed?.error && parsed?.message) {
      return { failure: { code: parsed.error, message: parsed.message } };
    }
  }
  return { failure: internalFailure };
}

// SQLSTATEs raised by Wax SQL functions (supabase/functions/_shared/errors.ts); their messages
// start with "<code>: ".
const sqlCodes: Record<string, ErrorCode> = {
  WX002: "unauthorized",
  WX003: "bad_request",
  WX004: "conflict",
};

/** Turns the result of `api.rpc(…)` into a Result. */
function fromRpc<T>(
  { data, error }: { data: T | null; error: { code: string; message: string } | null },
): Result<T> {
  if (!error) return { data: data as T };
  const code = sqlCodes[error.code];
  if (code) return { failure: { code, message: error.message.replace(/^\w+: /, "") } };
  // supabase-js reports a failed fetch with an empty code.
  if (!error.code) return { failure: networkFailure };
  console.error(error);
  return { failure: internalFailure };
}

export { callFunction, fromRpc, retryable };
export type { Failure, Result };
