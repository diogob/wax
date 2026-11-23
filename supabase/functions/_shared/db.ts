import { createClient } from "@supabase/supabase-js";
import type { Database } from "./db.types.ts";

/** Service-role client for the `service` schema. Server-side only. */
function serviceClient() {
  return createClient<Database, "service">(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "service" }, auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Client acting as the caller (for reading their own data via `api`). */
function userClient(authorization: string) {
  return createClient<Database, "api">(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      db: { schema: "api" },
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export { serviceClient, userClient };
