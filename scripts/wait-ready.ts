// Waits until PostgREST has loaded its schema cache (api.health answers "ok").
// Needed after `supabase db reset`: PostgREST returns PGRST002 while reloading.
import { env } from "../tests/harness/env.ts";

const deadline = Date.now() + 30_000;
let last = "";

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${env.url}/rest/v1/rpc/health`, {
      method: "POST",
      headers: { apikey: env.publishableKey, "content-profile": "api" },
    });
    last = await res.text();
    if (res.ok) Deno.exit(0);
  } catch (err) {
    last = String(err);
  }
  await new Promise((r) => setTimeout(r, 250));
}

console.error(`API not ready after 30s: ${last}`);
Deno.exit(1);
