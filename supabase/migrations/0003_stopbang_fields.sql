-- ============================================================================
-- 0003_stopbang_fields.sql
--
-- Adds the one physical measurement STOP-BANG needs that the schema doesn't
-- already carry.
--
-- STOP-BANG's 8 items are: Snoring, Tired, Observed apnea, Pressure (HTN),
-- BMI > 35, Age > 50, Neck circumference > 40cm, Gender = male.
--
-- Of those, the schema already covers:
--   BMI    -> intake_sessions.bmi (generated column from height_cm/weight_kg)
--   Age    -> profiles.date_of_birth
--   Gender -> profiles.sex
--
-- Only neck circumference has nowhere to live. It belongs next to the other
-- physical measurements on intake_sessions (not in intake_responses) so that
-- it is typed, queryable, and consistent with height_cm/weight_kg.
--
-- Nullable on purpose: a patient may not have a tape measure to hand, and the
-- scoring engine must be able to score a session with this item missing rather
-- than refuse to score at all.
-- ============================================================================

alter table public.intake_sessions
  add column if not exists neck_circumference_cm numeric;

comment on column public.intake_sessions.neck_circumference_cm is
  'Neck circumference in cm. Feeds STOP-BANG item N (> 40cm scores 1). Nullable — scoring treats NULL as "not answered", not as 0.';
