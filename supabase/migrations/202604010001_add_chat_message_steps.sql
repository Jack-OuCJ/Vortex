alter table public.chat_messages
  add column if not exists steps jsonb not null default '[]'::jsonb;