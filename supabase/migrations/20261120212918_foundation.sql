-- Wax foundation: schemas, grants, and shared helpers.
--
-- Schemas:
--   private  tables, views, internal functions (never exposed over HTTP)
--   api      RPCs callable by anon/authenticated (exposed)
--   service  RPCs callable only by service_role, i.e. Edge Functions (exposed)
--
-- Error codes (SQLSTATE class WX):
--   WX001  immutable_row
--   WX002  unauthorized   (no signed-in user)
--   WX003  bad_request    (input fails validation)
--   WX004  conflict       (clashes with existing data)

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema private;
create schema api;
create schema service;

-- Functions get EXECUTE for PUBLIC by default. Remove that for everything postgres
-- creates; grant explicitly per function instead.
alter default privileges for role postgres revoke execute on functions from public;

-- Lock everything down; grant explicitly per object later.
revoke all on schema private, api, service from public;

grant usage on schema api to anon, authenticated, service_role;
grant usage on schema service to service_role;
grant usage on schema private to anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- UUIDv7 (time-ordered). Replace with built-in uuidv7() on Postgres 18.
-------------------------------------------------------------------------------
create function private.uuidv7()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

grant execute on function private.uuidv7() to anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- Immutability: rows are never updated or deleted, except by purge_account()
-- which sets the transaction-local flag wax.purge = 'on' (DELETE only).
-------------------------------------------------------------------------------
create function private.guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('wax.purge', true), '') = 'on' then
    return old;
  end if;

  raise exception 'immutable_row: % on %.% is not allowed', tg_op, tg_table_schema, tg_table_name
    using errcode = 'WX001';
end;
$$;

-- Attach the guard to a table. Call for every table in private.
create function private.make_immutable(target regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger guard_immutable before update or delete on %s
       for each row execute function private.guard_immutable()', target);
  execute format(
    'create trigger guard_immutable_truncate before truncate on %s
       for each statement execute function private.guard_immutable()', target);
end;
$$;

-------------------------------------------------------------------------------
-- OpenPGP armor for output. pgcrypto's armor() always says "PGP MESSAGE".
-- No CRC24 (RFC 9580 says it should not be emitted).
-------------------------------------------------------------------------------
create type private.armor_kind as enum ('public_key', 'message', 'signature');

create function private.armor(kind private.armor_kind, data bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select format(
    E'-----BEGIN PGP %1$s-----\n\n%2$s\n-----END PGP %1$s-----\n',
    case kind
      when 'public_key' then 'PUBLIC KEY BLOCK'
      when 'message' then 'MESSAGE'
      when 'signature' then 'SIGNATURE'
    end,
    encode(data, 'base64')
  );
$$;

grant execute on function private.armor(private.armor_kind, bytea) to anon, authenticated, service_role;

-------------------------------------------------------------------------------
-- Smoke-test endpoint.
-------------------------------------------------------------------------------
create function api.health()
returns text
language sql
stable
set search_path = ''
as $$ select 'ok'::text; $$;

grant execute on function api.health() to anon, authenticated;

