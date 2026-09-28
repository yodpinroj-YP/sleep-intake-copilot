-- ---------------------------------------------------------------------------
-- 0009 — audit_log
--
-- WHAT THIS ANSWERS THAT THE REST OF THE SCHEMA CANNOT
--
-- Three questions have no answer in this database today:
--
--   1. "Who approved this summary, and was it ever approved before it was
--      rejected?" — clinician_summaries.reviewed_by holds only the LAST
--      decision. A physician who approves and then changes their mind
--      overwrites the first decision, and nothing records that it happened.
--      safety_flags.acknowledged_by has the same shape and the same gap.
--
--   2. "Who looked at this patient's record?" — nothing records a read.
--
--   3. "This answer used to be here. Who removed it?" — since 0008 a patient
--      can retract an answer, and the row is deleted. Deliberately: a row that
--      exists but holds nothing scoreable would be worse. But the deletion
--      itself left no trace at all.
--
-- The first two are the questions an ethics committee and a PDPA request ask
-- first. The third is one this project created for itself yesterday.
--
-- WHAT GOES IN, AND WHAT MUST NOT
--
-- This table records THAT something happened, never WHAT the clinical data
-- said. No answer values, no free text a patient typed, no names, no dates of
-- birth. `details` is checked against an allowlist of keys in
-- src/services/audit/audit-events.ts before anything is written, in the same
-- spirit as the de-identification allowlist used for the AI payload.
--
-- `patient_id` IS stored, and that is not a contradiction. The AI allowlist
-- exists to stop identifiers leaving this system for a third party. This table
-- never leaves the database, and "whose record was this" is the entire point —
-- an audit log that cannot name the patient answers none of the three
-- questions above.
--
-- APPEND-ONLY, AND MEANT LITERALLY
--
-- RLS with no policy would stop `authenticated` from touching it, but the
-- writer here is the service-role client, which bypasses RLS completely. So
-- immutability is enforced by triggers instead, which service role cannot
-- bypass: an UPDATE or DELETE on this table raises. A record that the
-- application can quietly edit proves nothing, and this one exists only to
-- prove things.
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),

  -- Deliberately NOT foreign keys. profiles.id cascades from auth.users, so a
  -- reference here would either be deleted along with a departing staff member
  -- — destroying the evidence — or block the deletion outright. session_id and
  -- patient_id are plain uuids for the same reason: the record of a deletion
  -- has to outlive the thing that was deleted.
  actor_id uuid,
  -- The role AT THE TIME. Reading it back from profiles later would report
  -- today's role, which is the wrong answer to "who was allowed to do this".
  actor_role public.user_role,

  -- text + check rather than an enum, on purpose. This list will grow, and
  -- ALTER TYPE ... ADD VALUE cannot run in the same transaction that uses the
  -- new value — a limitation this project already paid for once, in the split
  -- between 0006 and 0007. Widening a check constraint is an ordinary,
  -- transactional migration.
  action text not null check (action in (
    'record_viewed',
    'summary_requested',
    'summary_approved',
    'summary_rejected',
    'answers_saved',
    'answer_retracted',
    'session_deleted'
  )),

  patient_id uuid,
  session_id uuid,
  entity_table text,
  entity_id uuid,

  details jsonb not null default '{}'::jsonb
);

-- "Who touched this patient's record, most recent first" — the PDPA query.
create index if not exists audit_log_patient_occurred_idx
  on public.audit_log (patient_id, occurred_at desc);

-- "What did this person do" — the query you run about a member of staff.
create index if not exists audit_log_actor_occurred_idx
  on public.audit_log (actor_id, occurred_at desc);

-- "What happened in this episode of care" and "what happened last week".
create index if not exists audit_log_session_occurred_idx
  on public.audit_log (session_id, occurred_at desc);
create index if not exists audit_log_occurred_idx
  on public.audit_log (occurred_at desc);

alter table public.audit_log enable row level security;

-- NO POLICY IS DECLARED HERE, AND THAT IS THE FEATURE.
--
-- With RLS enabled and no policy, every request carrying an anon or
-- authenticated JWT reads zero rows — a patient, a nurse, a physician and an
-- admin signed into the app all see nothing. The log is reachable only through
-- the service-role key or a direct SQL session, which is what "administrators
-- only, outside the application" means.
--
-- Building a screen for it later is one migration and one policy; deciding
-- afterwards that a screen should not have existed is not undoable, because by
-- then people have read it.
revoke all on public.audit_log from anon;
revoke all on public.audit_log from authenticated;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted on this table', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function public.audit_log_append_only() is
  'Refuses UPDATE and DELETE on audit_log, including from the service role. '
  'Removing rows is a deliberate administrative act that requires disabling '
  'this trigger by hand, and should leave a trace of its own.';

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_append_only();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- Retention: none.
--
-- The decision on record is to keep every row indefinitely. This project has
-- no real patients yet, the rows are small, and a deletion rule chosen now
-- would be chosen without knowing which questions the log ends up being asked.
--
-- When that changes, the retention rule belongs in its own migration, next to
-- a written statement of what may be deleted and why — and it will have to
-- disable the trigger above to do it. That friction is intentional.
-- ---------------------------------------------------------------------------
