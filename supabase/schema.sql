-- Core project/chat tables (manual SQL execution)
-- Execute in Supabase SQL Editor

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  share_token text not null default encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_projects_share_token_unique
  on public.projects(share_token);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, path)
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  agent_name text,
  agent_role text,
  content text not null default '',
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'thinking' check (status in ('thinking', 'streaming', 'done', 'stopped', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_messages
  add column if not exists steps jsonb not null default '[]'::jsonb;

create index if not exists idx_projects_user_updated
  on public.projects(user_id, updated_at desc);

create index if not exists idx_project_files_project_path
  on public.project_files(project_id, path);

create index if not exists idx_chat_sessions_project_updated
  on public.chat_sessions(project_id, updated_at desc);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages(session_id, created_at asc);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_set_updated_at on public.projects;
create trigger trg_projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_project_files_set_updated_at on public.project_files;
create trigger trg_project_files_set_updated_at
before update on public.project_files
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_chat_sessions_set_updated_at on public.chat_sessions;
create trigger trg_chat_sessions_set_updated_at
before update on public.chat_sessions
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_chat_messages_set_updated_at on public.chat_messages;
create trigger trg_chat_messages_set_updated_at
before update on public.chat_messages
for each row execute function public.set_updated_at_timestamp();

alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own
on public.projects
for select
using (auth.uid() = user_id);

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own
on public.projects
for insert
with check (auth.uid() = user_id);

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own
on public.projects
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own
on public.projects
for delete
using (auth.uid() = user_id);

drop policy if exists project_files_all_own on public.project_files;
create policy project_files_all_own
on public.project_files
for all
using (
  exists (
    select 1 from public.projects p
    where p.id = project_files.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = project_files.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists chat_sessions_all_own on public.chat_sessions;
create policy chat_sessions_all_own
on public.chat_sessions
for all
using (
  exists (
    select 1 from public.projects p
    where p.id = chat_sessions.project_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = chat_sessions.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists chat_messages_all_own on public.chat_messages;
create policy chat_messages_all_own
on public.chat_messages
for all
using (
  exists (
    select 1
    from public.chat_sessions s
    join public.projects p on p.id = s.project_id
    where s.id = chat_messages.session_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.chat_sessions s
    join public.projects p on p.id = s.project_id
    where s.id = chat_messages.session_id
      and p.user_id = auth.uid()
  )
);
