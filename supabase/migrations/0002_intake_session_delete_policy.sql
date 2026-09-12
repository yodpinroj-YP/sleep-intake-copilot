-- ============================================================================
-- Adds the missing DELETE policy for intake_sessions.
--
-- 0001_init.sql covered select/insert/update but not delete. A patient may
-- delete (abandon) a session only while it is still 'not_started' or
-- 'in_progress' — the same condition already used for updates — so a
-- completed session that a clinician may have reviewed can never be
-- deleted from the app.
-- ============================================================================

create policy "Patients can delete their own in-progress intake sessions"
  on public.intake_sessions for delete
  using (auth.uid() = patient_id and status in ('not_started', 'in_progress'));
