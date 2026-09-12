-- ============================================================================
-- Initial schema
--
-- Two example tables that demonstrate the required patterns from the
-- project rules:
--   - profiles: one row per authenticated user (Supabase Auth integration)
--   - ai_outputs: results from the external AI service, always created
--     with a "pending_review" status so a human reviews them before
--     they're treated as trusted ("Keep AI output reviewable").
--
-- Every table has Row Level Security enabled ("Use RLS") with policies
-- scoped to auth.uid().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles are insertable by their owner"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Profiles are updatable by their owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Automatically create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ai_outputs
--
-- Every call to the external AI service is persisted here before it is
-- shown to anyone as a finished result. `status` starts at
-- 'pending_review' and can only move to 'approved' / 'rejected' by a
-- human reviewer action (see src/services/ai).
-- ---------------------------------------------------------------------------
create type public.ai_output_status as enum (
  'pending_review',
  'approved',
  'rejected'
);

create table if not exists public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  response text not null,
  model text not null,
  status public.ai_output_status not null default 'pending_review',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ai_outputs enable row level security;

create policy "Users can view their own AI outputs"
  on public.ai_outputs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own AI outputs"
  on public.ai_outputs for insert
  with check (auth.uid() = user_id);

-- Only the owner may update the review status (approve/reject) in this
-- starter. In a team setting, replace this with a role check (e.g. a
-- `reviewer` role in a separate roles table) instead of auth.uid().
create policy "Users can review their own AI outputs"
  on public.ai_outputs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists ai_outputs_user_id_idx on public.ai_outputs (user_id);
create index if not exists ai_outputs_status_idx on public.ai_outputs (status);
