-- Reads for the client: the caller's username, and public profiles. Rules: docs/contracts.md.

-------------------------------------------------------------------------------
-- The caller's username, or null if they haven't claimed one yet.
--   WX002  not signed in
-------------------------------------------------------------------------------
create function api.my_username()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'unauthorized: sign in first' using errcode = 'WX002';
  end if;
  return (select username from private.usernames where user_id = caller);
end;
$$;

grant execute on function api.my_username() to authenticated;

-------------------------------------------------------------------------------
-- A public profile: one key in the user's key history, newest first.
create type api.profile_key as (
  fingerprint text,
  published_at timestamptz,
  -- The key that superseded this one; null for the newest.
  replaced_by text,
  revoked_at timestamptz
);

create type api.profile as (
  username text,
  keys api.profile_key[]
);

-------------------------------------------------------------------------------
-- A user's public profile, or null if no one has that username. Key bodies are served
-- as files (docs/contracts.md "## Keys").
-------------------------------------------------------------------------------
create function api.profile(username text)
returns api.profile
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    owner.username,
    coalesce(
      (
        select array_agg(
          row(key.fingerprint, key.created_at, successor.fingerprint, revoked.created_at)::api.profile_key
          order by key.created_at desc
        )
        from private.keys as key
        left join private.keys as successor on successor.replaces = key.fingerprint
        left join private.key_revocations as revoked on revoked.fingerprint = key.fingerprint
        where key.user_id = owner.user_id
      ),
      '{}'
    )
  )::api.profile
  from private.usernames as owner
  where owner.username = profile.username;
$$;

grant execute on function api.profile(text) to anon, authenticated;
