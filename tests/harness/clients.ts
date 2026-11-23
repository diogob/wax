import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/functions/_shared/db.types.ts";
import type { Api } from "../../web/src/supabase.ts";
import { env } from "./env.ts";

const noSession = { persistSession: false, autoRefreshToken: false };

function anonClient(): Api {
  return createClient<Database, "api">(env.url, env.publishableKey, {
    db: { schema: "api" },
    auth: noSession,
  });
}

/** Setup only. Bypasses RLS: never assert behaviour through it. */
function adminClient(): Api {
  return createClient<Database, "api">(env.url, env.serviceKey, {
    db: { schema: "api" },
    auth: noSession,
  });
}

type TestUser = { id: string; email: string; client: Api };

/** Creates a confirmed user with a unique email and returns a client signed in as them. */
async function createTestUser(): Promise<TestUser> {
  const email = `test-${crypto.randomUUID()}@wax.test`;
  const password = crypto.randomUUID();

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { id: data.user.id, email, client };
}

export { adminClient, anonClient, createTestUser };
export type { TestUser };
