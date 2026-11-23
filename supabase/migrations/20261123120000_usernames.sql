-- Usernames: each account claims one, once. Same format as the `User` field in statements
-- (supabase/functions/_shared/statements.ts).

create table private.usernames (
  -- No cascade: account deletion purges Wax rows first (the immutability guard blocks it otherwise).
  user_id uuid primary key references auth.users (id),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  created_at timestamptz not null default now()
);

alter table private.usernames enable row level security;
select private.make_immutable('private.usernames');

-------------------------------------------------------------------------------
-- Claim a username for the caller. Returns it.
--   WX002  not signed in
--   WX003  invalid format
--   WX004  caller already has a username, or the name is taken
-------------------------------------------------------------------------------
create function api.claim_username(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'unauthorized: sign in first' using errcode = 'WX002';
  end if;

  if name is null or name !~ '^[a-z0-9][a-z0-9_-]{1,31}$' then
    raise exception 'bad_request: username must be 2-32 of a-z, 0-9, _ and -, starting with a letter or digit'
      using errcode = 'WX003';
  end if;

  if exists (select from private.usernames where user_id = caller) then
    raise exception 'conflict: you already have a username' using errcode = 'WX004';
  end if;

  insert into private.usernames (user_id, username) values (caller, name);
  return name;
exception
  when unique_violation then
    raise exception 'conflict: username is taken' using errcode = 'WX004';
end;
$$;

grant execute on function api.claim_username(text) to authenticated;
