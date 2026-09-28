-- ---------------------------------------------------------------------------
-- 0008 — let a patient retract an answer
--
-- WHY THIS IS NOT A COSMETIC FIX
-- This system's central claim is that "not answered" and "answered 0" are
-- different things. The scoring engines keep them apart, an incomplete total
-- is reported to the clinician as a floor with a stated ceiling, and the
-- clinician's screen draws an unanswered item as a dashed outline rather than
-- a zero.
--
-- The patient's form could not produce that state. Radio buttons change from
-- one answer to another but never back to none, so a patient who tapped the
-- wrong option was left with an answer they did not mean, counted in a
-- clinical score. The interface promised a distinction the patient had no way
-- to express.
--
-- 0001_init.sql gave `intake_responses` select, insert and update policies and
-- no delete, so retracting an answer was impossible at the database level too.
-- This adds the missing one, scoped exactly like the update policy already
-- there: a patient may remove an answer only on their own session, and only
-- while that session is still open. Once a session is completed — and a
-- clinician may have read it — nothing can be removed from the app.
--
-- Deleting the row is deliberate, rather than writing some "cleared" value
-- into `answer_value`. A row that exists but holds nothing scoreable would
-- look answered in the database and score as a gap, which is the exact
-- inconsistency `saveStructuredResponses` already refuses to create.
-- ---------------------------------------------------------------------------

-- Dropped first so the file can be run twice without an error. PostgreSQL
-- refuses to create a policy that already exists, and a migration that fails
-- the second time is a migration people learn to run nervously.
drop policy if exists "Patients can delete answers on their own in-progress sessions"
  on public.intake_responses;

create policy "Patients can delete answers on their own in-progress sessions"
  on public.intake_responses for delete
  using (
    exists (
      select 1 from public.intake_sessions s
      where s.id = session_id
        and s.patient_id = auth.uid()
        and s.status in ('not_started', 'in_progress')
    )
  );
