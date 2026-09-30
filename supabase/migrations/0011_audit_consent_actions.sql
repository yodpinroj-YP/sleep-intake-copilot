-- ---------------------------------------------------------------------------
-- 0011 — two more audit actions, for consent
--
-- Recording consent is itself an event worth auditing: it is the moment a
-- patient granted or removed permission, and "when did they withdraw?" is one
-- of the first questions a data protection enquiry asks.
--
-- This is the widening that 0009 said would be easy. The action column is
-- `text` with a check constraint rather than an enum precisely so that adding
-- a value is a single transactional statement — no ALTER TYPE, no splitting
-- the migration in two the way 0006 and 0007 had to be split.
--
-- The constraint is dropped and recreated rather than altered because
-- PostgreSQL has no "widen this check" statement. Existing rows are re-checked
-- on the way in, which is a feature: if a row somehow held an action outside
-- the list, this migration would refuse to run rather than bless it.
-- ---------------------------------------------------------------------------

alter table public.audit_log
  drop constraint if exists audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check check (action in (
    'record_viewed',
    'summary_requested',
    'summary_approved',
    'summary_rejected',
    'answers_saved',
    'answer_retracted',
    'session_deleted',
    'consent_granted',
    'consent_withdrawn'
  ));
