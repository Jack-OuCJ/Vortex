-- Create memories table for cross-session persistent memory
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null check (category in ('preference', 'convention', 'lesson', 'context')),
  content text not null,
  relevance_score integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, project_id, content)
);

-- Index for fast lookups by user+project
create index if not exists idx_memories_user_project
  on public.memories (user_id, project_id, relevance_score desc);

-- Automatically refresh updated_at on update
create or replace function public.set_memories_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_memories_updated_at
  before update on public.memories
  for each row
  execute function public.set_memories_updated_at();

-- Enable RLS
alter table public.memories enable row level security;

-- Users can only read/write their own memories (via project ownership)
create policy "memories_select_own"
  on public.memories for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = memories.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "memories_insert_own"
  on public.memories for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = memories.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "memories_update_own"
  on public.memories for update
  using (
    exists (
      select 1 from public.projects
      where projects.id = memories.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "memories_delete_own"
  on public.memories for delete
  using (
    exists (
      select 1 from public.projects
      where projects.id = memories.project_id
        and projects.user_id = auth.uid()
    )
  );
