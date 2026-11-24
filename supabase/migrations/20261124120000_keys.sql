-- Keys: challenges and published keys. Rules: docs/contracts.md "## Keys".
-- The Edge Functions do the crypto (key-challenge, publish-key); these functions only
-- store and check what they were told, and are callable by service_role only.

create table private.key_challenges (
  -- Random (not uuidv7): the nonce must not be guessable.
  nonce uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  fingerprint text not null check (fingerprint ~ '^([0-9A-F]{40}|[0-9A-F]{64})$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table private.key_challenges enable row level security;
select private.make_immutable('private.key_challenges');

create table private.keys (
  fingerprint text primary key check (fingerprint ~ '^([0-9A-F]{40}|[0-9A-F]{64})$'),
  user_id uuid not null references private.usernames (user_id),
  -- Cleaned armored key (publish-key strips third-party signatures and attributes).
  public_key text not null check (octet_length(public_key) <= 65536),
  -- Unique: each challenge publishes at most one key.
  nonce uuid not null unique references private.key_challenges (nonce),
  -- The user's key this one superseded. Unique: history is a single chain per user.
  replaces text unique references private.keys (fingerprint),
  created_at timestamptz not null default now()
);

create index keys_user_id on private.keys (user_id, created_at desc);

alter table private.keys enable row level security;
select private.make_immutable('private.keys');

-- The user's newest key (revocation comes in a later step).
create function private.current_key(owner uuid)
returns private.keys
language sql
stable
set search_path = ''
as $$
  select * from private.keys where user_id = owner order by created_at desc limit 1;
$$;

-------------------------------------------------------------------------------
-- The user's current key, if any, with the challenge that published it and the key it
-- replaced. publish-key needs the key to check the second signature, and the rest to
-- recognise a retry of the request that published it.
-------------------------------------------------------------------------------
create function service.current_key(user_id uuid)
returns table (fingerprint text, public_key text, nonce uuid, replaced_public_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select key.fingerprint, key.public_key, key.nonce, replaced.public_key
  from private.current_key(current_key.user_id) as key
  left join private.keys as replaced on replaced.fingerprint = key.replaces
  where key.fingerprint is not null;
$$;

grant execute on function service.current_key(uuid) to service_role;

-------------------------------------------------------------------------------
-- Start publishing `fingerprint` for `user_id`. Returns what the statement needs.
--   WX003  invalid fingerprint, or the user has no username yet
--   WX004  the key is already published (on any account)
-------------------------------------------------------------------------------
create function service.create_key_challenge(user_id uuid, fingerprint text)
returns table (username text, nonce uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_name text;
begin
  if fingerprint is null or fingerprint !~ '^([0-9A-F]{40}|[0-9A-F]{64})$' then
    raise exception 'bad_request: invalid fingerprint' using errcode = 'WX003';
  end if;

  select name.username into owner_name
  from private.usernames as name
  where name.user_id = create_key_challenge.user_id;
  if owner_name is null then
    raise exception 'bad_request: choose a username first' using errcode = 'WX003';
  end if;

  if exists (select from private.keys as key where key.fingerprint = create_key_challenge.fingerprint) then
    raise exception 'conflict: this key is already published' using errcode = 'WX004';
  end if;

  return query
    insert into private.key_challenges (user_id, fingerprint, expires_at)
    values (
      create_key_challenge.user_id,
      create_key_challenge.fingerprint,
      -- Whole seconds: the statement's Expires has no fraction.
      date_trunc('second', now()) + interval '10 minutes'
    )
    returning owner_name, key_challenges.nonce, key_challenges.expires_at;
end;
$$;

grant execute on function service.create_key_challenge(uuid, text) to service_role;

-------------------------------------------------------------------------------
-- Publish a key whose signed challenge publish-key has verified. `username`, `nonce` and
-- `fingerprint` come from the signed statement; `replaces` is the current key the
-- statement was also signed by (omitted if the user had none). Returns the fingerprint.
--   WX003  User is not this user's username; unknown nonce; Fingerprint differs from the
--          challenge; challenge expired
--   WX004  challenge already used; key already published; current key is not `replaces`
-------------------------------------------------------------------------------
create function service.publish_key(
  user_id uuid,
  username text,
  nonce uuid,
  fingerprint text,
  public_key text,
  replaces text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge private.key_challenges;
  current_fingerprint text;
begin
  -- Lock the user's row: concurrent publishes for one user run one after the other.
  perform from private.usernames as name
  where name.user_id = publish_key.user_id and name.username = publish_key.username
  for update;
  if not found then
    raise exception 'bad_request: User is not your username' using errcode = 'WX003';
  end if;

  select * into challenge
  from private.key_challenges as pending
  where pending.nonce = publish_key.nonce and pending.user_id = publish_key.user_id;
  if challenge.nonce is null then
    raise exception 'bad_request: unknown challenge' using errcode = 'WX003';
  end if;
  if challenge.fingerprint <> publish_key.fingerprint then
    raise exception 'bad_request: the challenge is for another key' using errcode = 'WX003';
  end if;
  if challenge.expires_at < now() then
    raise exception 'bad_request: the challenge expired; get a new one' using errcode = 'WX003';
  end if;

  current_fingerprint := (private.current_key(publish_key.user_id)).fingerprint;
  if current_fingerprint is distinct from replaces then
    raise exception 'conflict: your current key changed; start again' using errcode = 'WX004';
  end if;

  insert into private.keys (fingerprint, user_id, public_key, nonce, replaces)
  values (fingerprint, user_id, public_key, nonce, replaces);
  return fingerprint;
exception
  when unique_violation then
    raise exception 'conflict: this challenge was used, or the key is already published'
      using errcode = 'WX004';
end;
$$;

grant execute on function service.publish_key(uuid, text, uuid, text, text, text) to service_role;

-------------------------------------------------------------------------------
-- Public bucket for key files: keys/<FINGERPRINT>.asc. No storage.objects policies, so only
-- the service role (publish-key) writes; anyone reads through the public URL.
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('keys', 'keys', true, 65536, array['application/pgp-keys']);
