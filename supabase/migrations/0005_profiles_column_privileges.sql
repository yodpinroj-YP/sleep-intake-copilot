-- ---------------------------------------------------------------------------
-- 0005 — stop a patient from promoting themselves to clinician
--
-- THE DEFECT
-- 0001_init.sql claims, in its own header, that "a patient can never
-- self-promote to 'clinician' (see the column privilege revoke near the
-- bottom)". That revoke was written for `safety_flags` and
-- `clinician_summaries`. It was never written for `profiles`.
--
-- The policy on profiles reads:
--
--   create policy "Users can update their own profile"
--     on public.profiles for update
--     using (auth.uid() = id) with check (auth.uid() = id);
--
-- which says *which row* a user may change and says nothing about *which
-- columns*. Postgres grants UPDATE on every column by default, so a signed-in
-- patient could send one request and set their own `role` to 'clinician'.
-- Thirteen of the twenty-one policies in this schema decide access by calling
-- is_clinician(). All thirteen would then answer yes: every session, every
-- score, every safety flag, every summary, for every patient.
--
-- HOW IT WAS FOUND
-- tests/rls/access-control.test.ts, on its first run, 27 September 2026.
-- The test signed in as a real patient, issued the update, and read the role
-- back with the service-role client:
--
--   actual: 'clinician'   expected: 'patient'
--
-- No error was raised and nothing was logged, which is exactly why reading
-- the policy was never going to be enough. The schema comment had been wrong
-- for three weeks and looked right the whole time.
--
-- THE FIX
-- Take UPDATE back and hand back only the columns a patient legitimately
-- edits about themselves. `role` is not one of them; neither are `id`, which
-- would let a row be reassigned, nor the timestamps.
--
-- This is a privilege change, not a policy change: the policy above still
-- decides which row, and these grants decide which columns. Both have to
-- allow a write for it to happen, so the row-level rule is untouched and
-- still does its job.
--
-- Promoting someone to clinician stays what the trigger comment in 0001 always
-- said it was: a service-role action, done deliberately, from outside the app.
-- ---------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;

-- `anon` gets nothing back. An unauthenticated caller has no own row to edit
-- — auth.uid() is null, so the policy already refuses — but a privilege that
-- is never needed should not be held.
grant update (full_name, date_of_birth, sex) on public.profiles to authenticated;

-- What the application actually writes here is date_of_birth and sex, from
-- step 1 of the intake form (src/services/intake/service.ts). full_name is
-- included so a patient can correct their own name without this migration
-- having to be revisited; it carries no access-control meaning.
