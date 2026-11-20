import { after, describe, it } from "node:test";
import { expect } from "@std/expect";
import { closeSql, sql, uid } from "../harness/db.ts";

after(closeSql);

describe("uuidv7", () => {
  it("is version 7 and time-ordered", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [row] = await sql()`select private.uuidv7()::text as id, pg_sleep(0.002)`;
      ids.push(row!.id);
    }
    for (const id of ids) expect(id[14]).toBe("7");
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("armor", () => {
  it("uses the right header per kind", async () => {
    const [row] = await sql()`
      select private.armor('public_key', '\\x0102'::bytea) as key,
             private.armor('message', '\\x0102'::bytea) as msg`;
    expect(row!.key).toBe(
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAQI=\n-----END PGP PUBLIC KEY BLOCK-----\n",
    );
    expect(row!.msg).toContain("-----BEGIN PGP MESSAGE-----");
  });
});

describe("immutability guard", () => {
  // Each test gets its own probe table in `scratch` (outside `private`, so catalog checks
  // ignore it). Nothing is cleaned up; `deno task test` resets the database first.
  const probe = async () => {
    const table = `scratch.probe_${uid()}`;
    await sql().unsafe(`create schema if not exists scratch`);
    await sql().unsafe(`create table ${table} (id int primary key)`);
    await sql()`select private.make_immutable(${table}::regclass)`;
    await sql().unsafe(`insert into ${table} values (1)`);
    return table;
  };

  for (
    const [op, statement] of [
      ["update", "update %t set id = 2"],
      ["delete", "delete from %t"],
      ["truncate", "truncate %t"],
    ]
  ) {
    it(`rejects ${op}`, async () => {
      const table = await probe();
      await expect(sql().unsafe(statement!.replace("%t", table))).rejects.toMatchObject({
        code: "WX001",
      });
    });
  }

  it("allows delete during purge", async () => {
    const table = await probe();
    await sql().begin(async (tx) => {
      await tx`select set_config('wax.purge', 'on', true)`;
      await tx.unsafe(`delete from ${table}`);
    });
    const [row] = await sql().unsafe(`select count(*)::int as n from ${table}`);
    expect(row!.n).toBe(0);
  });
});

describe("catalog invariants", () => {
  it("every object in private/api/service is owned by wax_owner", async () => {
    const offenders = await sql()`
      select n.nspname || '.' || c.relname as obj from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('private', 'api', 'service') and c.relowner <> 'wax_owner'::regrole
      union all
      select n.nspname || '.' || p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'api', 'service') and p.proowner <> 'wax_owner'::regrole
      union all
      select n.nspname || '.' || t.typname from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ('private', 'api', 'service') and t.typowner <> 'wax_owner'::regrole
      union all
      select nspname from pg_namespace
      where nspname in ('private', 'api', 'service') and nspowner <> 'wax_owner'::regrole`;
    expect(offenders.map((r) => r.obj)).toEqual([]);
  });
  it("every private table has RLS and the immutability guard", async () => {
    const offenders = await sql()`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relkind = 'r'
        and (
          not c.relrowsecurity
          or not exists (select 1 from pg_trigger t
                         where t.tgrelid = c.oid and t.tgname = 'guard_immutable')
          or not exists (select 1 from pg_trigger t
                         where t.tgrelid = c.oid and t.tgname = 'guard_immutable_truncate')
        )`;
    expect(offenders.map((r) => r.relname)).toEqual([]);
  });

  it("no function in api/service/private is executable by PUBLIC", async () => {
    const offenders = await sql()`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'service', 'private')
        and exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )`;
    expect(offenders.map((r) => r.fn)).toEqual([]);
  });

  it("security definer functions pin search_path", async () => {
    const offenders = await sql()`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('api', 'service', 'private')
        and p.prosecdef
        and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`;
    expect(offenders.map((r) => r.fn)).toEqual([]);
  });
});
