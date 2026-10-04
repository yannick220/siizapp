-- SIIZ live setup.
-- Run this after supabase/schema.sql in the Supabase SQL editor.

create extension if not exists "pgcrypto";

alter table public.profiles add column if not exists share_code text;

update public.profiles
set share_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where share_code is null;

alter table public.profiles
  alter column share_code set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

alter table public.profiles
  alter column share_code set not null;

create unique index if not exists profiles_share_code_key
  on public.profiles (share_code);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'SIIZ')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.conversation_members to authenticated;
grant select, insert, update, delete on public.messages to authenticated;

drop policy if exists "read own profile and contacts" on public.profiles;
drop policy if exists "update own profile" on public.profiles;
drop policy if exists "insert own profile" on public.profiles;
drop policy if exists "read visible profiles" on public.profiles;
drop policy if exists "update own profile only" on public.profiles;

create policy "read visible profiles" on public.profiles
for select to authenticated
using (
  auth.uid() = id
  or exists (
    select 1 from public.contacts c
    where c.owner_id = auth.uid()
      and c.contact_id = profiles.id
      and c.blocked = false
      and profiles.proximity_enabled = true
  )
  or exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    where mine.profile_id = auth.uid()
      and theirs.profile_id = profiles.id
      and profiles.proximity_enabled = true
  )
);

create policy "insert own profile" on public.profiles
for insert to authenticated
with check (auth.uid() = id);

create policy "update own profile only" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "read own contacts" on public.contacts;
drop policy if exists "manage own contacts" on public.contacts;
drop policy if exists "read contacts I own" on public.contacts;
drop policy if exists "manage contacts I own" on public.contacts;

create policy "read contacts I own" on public.contacts
for select to authenticated
using (auth.uid() = owner_id);

create policy "manage contacts I own" on public.contacts
for all to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "read member conversations" on public.conversations;
drop policy if exists "create own conversations" on public.conversations;

create policy "read member conversations" on public.conversations
for select to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.profile_id = auth.uid()
  )
);

create policy "create own conversations" on public.conversations
for insert to authenticated
with check (created_by = auth.uid());

drop policy if exists "read memberships" on public.conversation_members;
drop policy if exists "create memberships for own conversations" on public.conversation_members;

create policy "read memberships" on public.conversation_members
for select to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_members.conversation_id
      and cm.profile_id = auth.uid()
  )
);

create policy "create memberships for own conversations" on public.conversation_members
for insert to authenticated
with check (
  profile_id = auth.uid()
  or exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.created_by = auth.uid()
  )
);

drop policy if exists "read conversation messages" on public.messages;
drop policy if exists "send messages as member" on public.messages;

create policy "read conversation messages" on public.messages
for select to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.profile_id = auth.uid()
  )
);

create policy "send messages as member" on public.messages
for insert to authenticated
with check (
  auth.uid() = sender_id
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.profile_id = auth.uid()
  )
);

create or replace function public.find_profile_by_code(lookup_code text)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  proximity_enabled boolean
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url, p.proximity_enabled
  from public.profiles p
  where upper(p.share_code) = upper(regexp_replace(coalesce(lookup_code, ''), '\s+', '', 'g'))
    and p.id <> auth.uid()
    and p.proximity_enabled = true
  limit 1;
$$;

create or replace function public.start_direct_conversation(other_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_profile_id is null or other_profile_id = me then
    raise exception 'Invalid contact';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = other_profile_id
      and proximity_enabled = true
  ) then
    raise exception 'Contact not available';
  end if;

  select c.id into existing_id
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.profile_id = me
  join public.conversation_members b on b.conversation_id = c.id and b.profile_id = other_profile_id
  where c.is_group = false
    and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = 2
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, profile_id, role)
  values
    (new_id, me, 'admin'),
    (new_id, other_profile_id, 'member');

  insert into public.contacts (owner_id, contact_id)
  values
    (me, other_profile_id),
    (other_profile_id, me)
  on conflict (owner_id, contact_id) do nothing;

  return new_id;
end;
$$;

create or replace function public.create_group_conversation(group_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
  member_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (true, nullif(trim(group_title), ''), me)
  returning id into new_id;

  insert into public.conversation_members (conversation_id, profile_id, role)
  values (new_id, me, 'admin');

  foreach member_id in array coalesce(member_ids, array[]::uuid[]) loop
    if member_id <> me and exists (
      select 1
      from public.profiles
      where id = member_id
        and proximity_enabled = true
    ) then
      insert into public.conversation_members (conversation_id, profile_id, role)
      values (new_id, member_id, 'member')
      on conflict do nothing;
    end if;
  end loop;

  return new_id;
end;
$$;

grant execute on function public.find_profile_by_code(text) to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

create index if not exists contacts_owner_idx on public.contacts(owner_id);
create index if not exists contacts_contact_idx on public.contacts(contact_id);
create index if not exists conversation_members_profile_idx on public.conversation_members(profile_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.contacts;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
