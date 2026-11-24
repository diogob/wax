-- Key revocations. Rules: docs/contracts.md "## Keys". revoke-key verifies the certificate
-- (an OpenPGP revocation signature from gpg) and merges it into the key file; this stores it.

create table private.key_revocations (
  fingerprint text primary key references private.keys (fingerprint),
  -- Armored revocation certificate, as pasted (verified by revoke-key).
  revocation text not null check (octet_length(revocation) <= 16384),
  created_at timestamptz not null default now()
);

alter table private.key_revocations enable row level security;
select private.make_immutable('private.key_revocations');

-- The user's newest key, unless it is revoked. A revoked key is never current again, and
-- the key it replaced doesn't become current either: the user publishes a new one.
create or replace function private.current_key(owner uuid)
returns private.keys
language sql
stable
set search_path = ''
as $$
  select latest.*
  from (
    select * from private.keys where user_id = owner order by created_at desc limit 1
  ) as latest
  where not exists (
    select from private.key_revocations as revoked where revoked.fingerprint = latest.fingerprint
  );
$$;

-------------------------------------------------------------------------------
-- One of the user's keys (current or not). No row if the key isn't theirs.
-------------------------------------------------------------------------------
create function service.own_key(user_id uuid, fingerprint text)
returns table (fingerprint text, public_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select key.fingerprint, key.public_key
  from private.keys as key
  where key.user_id = own_key.user_id and key.fingerprint = own_key.fingerprint;
$$;

grant execute on function service.own_key(uuid, text) to service_role;

-------------------------------------------------------------------------------
-- Record the revocation of one of the user's keys. Idempotent: if the key is already
-- revoked, keeps the first revocation. Returns the stored revocation (the one the key file
-- must carry).
--   WX003  the key isn't one of the user's
-------------------------------------------------------------------------------
create function service.revoke_key(user_id uuid, fingerprint text, revocation text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored text;
begin
  if not exists (
    select from private.keys as key
    where key.user_id = revoke_key.user_id and key.fingerprint = revoke_key.fingerprint
  ) then
    raise exception 'bad_request: this key is not one of yours' using errcode = 'WX003';
  end if;

  insert into private.key_revocations (fingerprint, revocation)
  values (revoke_key.fingerprint, revoke_key.revocation)
  on conflict do nothing;

  select revoked.revocation into stored
  from private.key_revocations as revoked
  where revoked.fingerprint = revoke_key.fingerprint;
  return stored;
end;
$$;

grant execute on function service.revoke_key(uuid, text, text) to service_role;
