-- ============================================================================
-- Sleep Intake Copilot — initial schema
--
-- Implements DATABASE.md. Tables map directly to the product workflow:
--   Structured Sleep History -> Adaptive Follow-up -> Validated Questionnaires
--   -> Safety/Red-Flag Screening -> AI Processing -> Structured Summary
--   -> Clinician Review
--
-- Ground rules from AI_RULES.md / ARCHITECTURE.md enforced here:
--   - Every table is RLS-enabled, no exceptions.
--   - Deterministic output (questionnaire_scores, safety_flags) is stored
--     separately from LLM-generated output (clinician_summaries) so it's
--     obvious which rows are exact and which need clinician verification.
--   - Every AI-generated clinical artifact carries a review status.
--   - A patient can never self-promote to 'clinician' — role changes are
--     service-role only, i.e. done through a controlled admin action
--     server-side. NOTE: this file never actually enforced that. The column
--     privileges that do are in 0005_profiles_column_privileges.sql, added
--     after tests/rls/access-control.test.ts proved a patient could change
--     their own role. Left here, corrected, rather than quietly rewritten:
--     the gap between what a schema claims and what it enforces is the
--     whole reason those tests exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('patient', 'clinician', 'admin');
-- 'clinician' covers sleep physicians, neurologists, pulmonologists, ENT,
-- psychiatrists, fellows, and sleep nurses/technicians (project doc's
-- "Secondary Users"). MVP does not need finer-grained roles for access
-- control; split further only if a real need shows up.

create type public.intake_status as enum ('not_started', 'in_progress', 'completed', 'abandoned');

create type public.review_status as enum ('pending_review', 'approved', 'rejected');

create type public.response_source as enum ('structured_choice', 'free_text', 'ai_extracted');

create type public.flag_severity as enum ('standard', 'urgent');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'patient',
  full_name text,
  date_of_birth date,
  sex text check (sex in ('male', 'female', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row on signup. Role is hardcoded to 'patient' here
-- — it deliberately does NOT read a role from raw_user_meta_data, because
-- that would let anyone self-register as a clinician by passing role in
-- the signup payload. Promoting a user to 'clinician' must be a separate,
-- service-role-only action (e.g. an admin script/endpoint).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- is_clinician() — RLS helper
--
-- SECURITY DEFINER so it can read profiles.role without recursing through
-- profiles' own RLS policies. Used by every clinical table below to grant
-- clinicians read access across all patients (clinicians are not the
-- "owner" of a patient's data, so a plain auth.uid() = patient_id check
-- can't express their access).
--
-- Must be created after `profiles` (it queries that table) but before any
-- policy that calls it — including the "Clinicians can view all profiles"
-- policy on profiles itself, added right below.
-- ---------------------------------------------------------------------------
create or replace function public.is_clinician()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('clinician', 'admin')
  );
$$;

create policy "Clinicians can view all profiles"
  on public.profiles for select
  using (public.is_clinician());

-- ---------------------------------------------------------------------------
-- intake_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  status public.intake_status not null default 'not_started',
  chief_complaint text,
  height_cm numeric,
  weight_kg numeric,
  bmi numeric generated always as (
    case
      when height_cm is not null and height_cm > 0 and weight_kg is not null
        then round((weight_kg / ((height_cm / 100.0) ^ 2))::numeric, 1)
      else null
    end
  ) stored,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.intake_sessions enable row level security;

create policy "Patients can view their own intake sessions"
  on public.intake_sessions for select
  using (auth.uid() = patient_id);

create policy "Clinicians can view all intake sessions"
  on public.intake_sessions for select
  using (public.is_clinician());

create policy "Patients can create their own intake sessions"
  on public.intake_sessions for insert
  with check (auth.uid() = patient_id);

create policy "Patients can update their own in-progress intake sessions"
  on public.intake_sessions for update
  using (auth.uid() = patient_id and status in ('not_started', 'in_progress'))
  with check (auth.uid() = patient_id);

create index if not exists intake_sessions_patient_id_idx on public.intake_sessions (patient_id);
create index if not exists intake_sessions_status_idx on public.intake_sessions (status);

-- ---------------------------------------------------------------------------
-- intake_responses
-- ---------------------------------------------------------------------------
create table if not exists public.intake_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.intake_sessions (id) on delete cascade,
  question_key text not null,
  question_domain text not null,
  answer_value jsonb not null,
  source public.response_source not null default 'structured_choice',
  raw_patient_text text,
  extraction_confidence numeric check (extraction_confidence between 0 and 1),
  created_at timestamptz not null default now()
);

alter table public.intake_responses enable row level security;

create policy "Patients can view responses on their own sessions"
  on public.intake_responses for select
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id and s.patient_id = auth.uid()
    )
  );

create policy "Clinicians can view all responses"
  on public.intake_responses for select
  using (public.is_clinician());

create policy "Patients can insert responses on their own in-progress sessions"
  on public.intake_responses for insert
  with check (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id
        and s.patient_id = auth.uid()
        and s.status in ('not_started', 'in_progress')
    )
  );

create policy "Patients can update responses on their own in-progress sessions"
  on public.intake_responses for update
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id
        and s.patient_id = auth.uid()
        and s.status in ('not_started', 'in_progress')
    )
  )
  with check (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id
        and s.patient_id = auth.uid()
        and s.status in ('not_started', 'in_progress')
    )
  );

create index if not exists intake_responses_session_id_idx on public.intake_responses (session_id);
create index if not exists intake_responses_question_domain_idx on public.intake_responses (question_domain);

-- ---------------------------------------------------------------------------
-- questionnaire_scores
--
-- Deterministic scoring output only. Nothing here is ever written by the
-- LLM — computed_by is a constant marker, not a user reference, and no
-- INSERT/UPDATE policy is granted to 'authenticated': only the server-side
-- deterministic scoring engine (using the service-role client, which
-- bypasses RLS) writes to this table.
-- ---------------------------------------------------------------------------
create table if not exists public.questionnaire_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.intake_sessions (id) on delete cascade,
  instrument text not null check (instrument in ('ESS', 'STOP_BANG', 'ISI', 'BERLIN')),
  raw_answers jsonb not null,
  score numeric not null,
  score_breakdown jsonb,
  risk_category text,
  computed_by text not null default 'deterministic_engine',
  computed_at timestamptz not null default now(),
  unique (session_id, instrument)
);

alter table public.questionnaire_scores enable row level security;

create policy "Patients can view their own questionnaire scores"
  on public.questionnaire_scores for select
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id and s.patient_id = auth.uid()
    )
  );

create policy "Clinicians can view all questionnaire scores"
  on public.questionnaire_scores for select
  using (public.is_clinician());

create index if not exists questionnaire_scores_session_id_idx on public.questionnaire_scores (session_id);

-- ---------------------------------------------------------------------------
-- safety_flags
--
-- Predefined red-flag detections, rule-based (per AI_RULES.md). Same
-- write pattern as questionnaire_scores: server-side only, except the
-- acknowledgement action below.
-- ---------------------------------------------------------------------------
create table if not exists public.safety_flags (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.intake_sessions (id) on delete cascade,
  flag_type text not null,
  severity public.flag_severity not null default 'urgent',
  trigger_source text not null,
  detected_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz
);

alter table public.safety_flags enable row level security;

create policy "Patients can view their own safety flags"
  on public.safety_flags for select
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id and s.patient_id = auth.uid()
    )
  );

create policy "Clinicians can view all safety flags"
  on public.safety_flags for select
  using (public.is_clinician());

-- Clinicians may acknowledge a flag. Column privileges (below) restrict
-- this to only the acknowledgement columns, even though the app should
-- still perform this through a dedicated server-side endpoint rather than
-- a raw client update.
create policy "Clinicians can acknowledge safety flags"
  on public.safety_flags for update
  using (public.is_clinician())
  with check (public.is_clinician());

revoke update on public.safety_flags from authenticated;
grant update (acknowledged_by, acknowledged_at) on public.safety_flags to authenticated;

create index if not exists safety_flags_session_id_idx on public.safety_flags (session_id);
create index if not exists safety_flags_severity_idx on public.safety_flags (severity);

-- ---------------------------------------------------------------------------
-- clinician_summaries
--
-- The AI-generated, clinician-facing output. Versioned rather than
-- overwritten so a regenerated summary never erases what a clinician
-- already reviewed.
-- ---------------------------------------------------------------------------
create table if not exists public.clinician_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.intake_sessions (id) on delete cascade,
  version integer not null default 1,
  summary_text text not null,
  key_symptoms jsonb not null default '[]'::jsonb,
  important_negatives jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  needs_verification jsonb not null default '[]'::jsonb,
  model text not null,
  status public.review_status not null default 'pending_review',
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  unique (session_id, version)
);

alter table public.clinician_summaries enable row level security;

create policy "Patients can view their own clinician summaries"
  on public.clinician_summaries for select
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id and s.patient_id = auth.uid()
    )
  );

create policy "Clinicians can view all clinician summaries"
  on public.clinician_summaries for select
  using (public.is_clinician());

-- Clinicians may review (approve/reject) a summary. Column privileges
-- restrict this to only the review columns — see the note on
-- safety_flags above; a dedicated server-side review endpoint is still
-- the intended path, this is defense in depth.
create policy "Clinicians can review clinician summaries"
  on public.clinician_summaries for update
  using (public.is_clinician())
  with check (public.is_clinician());

revoke update on public.clinician_summaries from authenticated;
grant update (status, reviewed_by, reviewed_at, reviewer_notes) on public.clinician_summaries to authenticated;

create index if not exists clinician_summaries_session_id_idx on public.clinician_summaries (session_id);
create index if not exists clinician_summaries_status_idx on public.clinician_summaries (status);

-- ---------------------------------------------------------------------------
-- ai_processing_logs
--
-- Technical audit trail for AI calls (debugging/monitoring only).
-- Deliberately does NOT store raw prompt/response text by default —
-- intake_responses.raw_patient_text and clinician_summaries.summary_text
-- are already the system of record for what the AI saw and produced.
-- If prompt/response logging becomes necessary, add input_text/output_text
-- columns behind an explicit retention policy, admin-only access — don't
-- add them by default.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_processing_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.intake_sessions (id) on delete cascade,
  feature text not null check (
    feature in ('nlu_extraction', 'adaptive_question_selection', 'summarization', 'gap_detection')
  ),
  model text not null,
  latency_ms integer,
  status text not null default 'success' check (status in ('success', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.ai_processing_logs enable row level security;

create policy "Clinicians can view AI processing logs"
  on public.ai_processing_logs for select
  using (public.is_clinician());

-- No patient-facing select policy: this is an internal/ops table, not
-- something a patient needs to see. No insert/update policy for
-- 'authenticated' either — only the service-role client writes here.

create index if not exists ai_processing_logs_session_id_idx on public.ai_processing_logs (session_id);
