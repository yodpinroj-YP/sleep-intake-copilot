-- ---------------------------------------------------------------------------
-- 0010 — consents
--
-- WHY THIS BLOCKS THE FIRST REAL PATIENT
--
-- Health data is sensitive personal data under section 26 of Thailand's
-- Personal Data Protection Act, which requires explicit consent and does not
-- allow a controller to fall back on another lawful basis. Until this table
-- exists, the application collects questionnaire answers with no record
-- anywhere that the patient agreed to it — so the question "when did I consent,
-- and to what?" has no answer. That is the same shape of gap that 0009 closed
-- for "who looked at my record".
--
-- THREE PURPOSES, RECORDED SEPARATELY
--
-- Consent has to be specific, so one blanket tick is not enough:
--
--   care       — collecting and using the answers for this patient's own
--                assessment and care. Without it there is no service, so the
--                application refuses to start an intake session.
--   ai_summary — sending the de-identified payload to an AI provider to draft
--                a summary. Genuinely optional: a patient who declines this
--                still gets everything else, because every score and every
--                safety flag is computed without AI.
--   research   — using de-identified data for quality improvement and study.
--                Optional, and declining changes nothing the patient sees.
--
-- APPEND-ONLY, FOR THE SAME REASON AS THE AUDIT LOG
--
-- Withdrawing consent inserts a new row with granted = false. It never edits
-- or deletes the row that granted it. You have to be able to show what the
-- patient had agreed to ON THE DAY the data was collected, and a record that
-- can be overwritten shows only what is true now. UPDATE and DELETE raise,
-- service role included.
--
-- WHAT WITHDRAWAL DOES, AND DOES NOT DO
--
-- It stops future processing for that purpose. It does NOT delete data already
-- held, and deliberately does not try to: medical records carry retention
-- obligations of their own, and the right to withdraw consent and the right to
-- erasure are separate rights with separate answers. Erasure is a request to
-- the hospital's data protection officer, handled as a decision by a person —
-- not a button that quietly destroys a clinical record.
-- ---------------------------------------------------------------------------

create table if not exists public.consents (
  id bigint generated always as identity primary key,

  -- A foreign key here, unlike audit_log. The difference is deliberate: an
  -- audit row records that an action happened and must outlive the account
  -- that performed it, whereas a consent is meaningless without the person who
  -- gave it. If a patient's account is erased, their consent records go with
  -- it rather than lingering as a claim about someone the database can no
  -- longer name.
  patient_id uuid not null references public.profiles (id) on delete cascade,

  -- text + check rather than an enum, the same choice 0009 made and for the
  -- same reason: widening a check constraint is an ordinary transactional
  -- migration, while ALTER TYPE ... ADD VALUE cannot be used in the
  -- transaction that adds it.
  purpose text not null check (purpose in ('care', 'ai_summary', 'research')),

  -- true = given, false = withdrawn. Both are rows; neither is an edit.
  granted boolean not null,

  -- Which wording the patient actually agreed to. Without this the record
  -- proves nothing the day the text changes — and it will change, because the
  -- first version of a consent notice is never the last.
  text_version text not null,

  recorded_at timestamptz not null default now(),

  -- Who performed the action. Equal to patient_id today. Kept separate so that
  -- when caregivers are added, "the daughter consented on her mother's behalf"
  -- is recordable rather than indistinguishable from the patient doing it.
  recorded_by uuid not null,

  source text not null default 'patient_web'
    check (source in ('patient_web', 'staff_entry'))
);

-- The query the application runs on every page load: the newest row per
-- (patient, purpose).
create index if not exists consents_patient_purpose_recorded_idx
  on public.consents (patient_id, purpose, recorded_at desc, id desc);

alter table public.consents enable row level security;

create policy "Patients can view their own consents"
  on public.consents for select
  using (patient_id = auth.uid());

-- The care team can see WHETHER a patient consented, because a clinician
-- needs to know why an AI draft is unavailable for one patient and available
-- for another. They see the fact, not a way to change it.
create policy "Care team can view all consents"
  on public.consents for select
  using (public.is_clinician());

-- A patient may record their own consent and their own withdrawal, and
-- nobody else's. `recorded_by` is pinned to the caller so a row cannot claim
-- that someone else pressed the button.
create policy "Patients can record their own consent"
  on public.consents for insert
  with check (patient_id = auth.uid() and recorded_by = auth.uid());

-- No UPDATE or DELETE policy is declared, and the triggers below make that
-- true for the service role as well.

/**
 * The current state of consent, derived rather than stored.
 *
 * Storing a separate "current" column would create two sources of truth that
 * can disagree, and the one that disagrees is always the one somebody trusts.
 *
 * security_invoker is essential here: without it the view would run with its
 * owner's privileges and hand every row to every caller, quietly bypassing the
 * policies above.
 */
create or replace view public.current_consents
with (security_invoker = true) as
select distinct on (patient_id, purpose)
  patient_id,
  purpose,
  granted,
  text_version,
  recorded_at
from public.consents
order by patient_id, purpose, recorded_at desc, id desc;

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

create or replace function public.consents_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'consents is append-only; % is not permitted. Record a withdrawal as a new row.', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function public.consents_append_only() is
  'Refuses UPDATE and DELETE on consents, service role included. A consent '
  'record that can be rewritten cannot show what was agreed on the day the '
  'data was collected, which is the only thing it exists to show.';

drop trigger if exists consents_no_update on public.consents;
create trigger consents_no_update
  before update on public.consents
  for each row execute function public.consents_append_only();

drop trigger if exists consents_no_delete on public.consents;
create trigger consents_no_delete
  before delete on public.consents
  for each row execute function public.consents_append_only();
