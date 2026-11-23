import postgres from "postgres";
import { env } from "./env.ts";

// Tests never roll back or clean up: every test creates its own uniquely named data
// and only looks at that data. The database is reset once per run (`deno task test`).

let pool: postgres.Sql | undefined;

function sql(): postgres.Sql {
  pool ??= postgres(env.dbUrl, { max: 4, onnotice: () => {} });
  return pool;
}

async function closeSql() {
  await pool?.end();
  pool = undefined;
}

type Tx = postgres.TransactionSql;

type As =
  | { role: "anon" }
  | { role: "authenticated"; userId: string }
  | { role: "service_role" };

/**
 * Runs fn in a committed transaction impersonating a PostgREST request (role + JWT claims),
 * so auth.uid() and RLS behave as in production.
 */
function as<T>(who: As, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    const claims = who.role === "authenticated"
      ? { role: who.role, sub: who.userId }
      : { role: who.role };
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await tx.unsafe(`set local role ${who.role}`);
    return await fn(tx);
  }) as Promise<T>;
}

/** Unique suffix for identifiers/data created by a test. */
function uid(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/** Unique, valid Wax username. */
function uniqueUsername(): string {
  return `u${uid().slice(0, 20)}`;
}

export { as, closeSql, sql, uid, uniqueUsername };
export type { As, Tx };
