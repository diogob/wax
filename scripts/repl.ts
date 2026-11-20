// Loaded by `deno task repl`. Exposes the test harness as globals.
// Example: const u = await createTestUser(); await u.client.rpc("health")
import * as clients from "../tests/harness/clients.ts";
import * as db from "../tests/harness/db.ts";
import { env } from "../tests/harness/env.ts";

Object.assign(globalThis, clients, db, { env });

console.log(
  "Wax REPL. Globals: env, sql(), as(), uid(), closeSql(), anonClient(), adminClient(), createTestUser()",
);
