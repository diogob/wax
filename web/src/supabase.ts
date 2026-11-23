import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/functions/_shared/db.types.ts";

type Api = SupabaseClient<Database, "api">;

type Config = { supabaseUrl: string; supabasePublishableKey: string };

/** Loads ./config.json (deployed next to index.html) and creates the client. */
async function connect(): Promise<Api> {
  const res = await fetch("./config.json");
  if (!res.ok) throw new Error(`config.json: ${res.status}`);
  const config: Config = await res.json();

  return createClient<Database, "api">(config.supabaseUrl, config.supabasePublishableKey, {
    db: { schema: "api" },
    auth: { flowType: "pkce" },
  });
}

export { connect };
export type { Api };
