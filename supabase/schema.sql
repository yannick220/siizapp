-- SIIZ starter schema for Supabase.
-- Run this in Supabase SQL editor after enabling Auth.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  proximity_enabled boolean not null default true,
  approximate_lat double precision,
  approximate_lng double precision,
  proximity_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  alias text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  audio_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "read own profile and contacts" on public.profiles
  for select using (
    auth.uid() = id or exists (
      select 1 from public.contacts c
      where c.owner_id = auth.uid()
      and c.contact_id = profiles.id
      and c.blocked = false
      and profiles.proximity_enabled = true
    )
  );

create policy "update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "read own contacts" on public.contacts
  for select using (auth.uid() = owner_id);

create policy "manage own contacts" on public.contacts
  for all using (auth.uid() = owner_id);

create policy "read member conversations" on public.conversations
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversations.id
      and cm.profile_id = auth.uid()
    )
  );

create policy "read memberships" on public.conversation_members
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
      and cm.profile_id = auth.uid()
    )
  );

create policy "read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id
      and cm.profile_id = auth.uid()
    )
  );

create policy "send messages as member" on public.messages
  for insert with check (
    auth.uid() = sender_id and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id
      and cm.profile_id = auth.uid()
    )
  );
