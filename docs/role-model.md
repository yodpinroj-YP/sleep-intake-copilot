# Role model — design for caregivers, nurses and doctors

Status: **designed, not built.** Nothing in this document is implemented. It
exists so that the decisions are made while there is time to think about them,
rather than while someone is typing.

Today the system has three roles: `patient`, `clinician`, `admin`. That was
the right size for proving the clinical workflow, and it is not the right size
for a hospital.

## What is missing, and why each one matters

**Nurse and doctor are not the same role.** In a sleep clinic a nurse runs the
intake queue, checks that a patient has answered, and chases missing
measurements. A doctor decides. Today both would share one `clinician` role,
which means a nurse could approve an AI-drafted summary into the medical
record. That is not a permission anyone would grant on purpose.

**A caregiver is not a smaller clinician.** An elderly patient's daughter may
legitimately fill in the questionnaire and read the result — for *her mother*,
and for nobody else. That is access derived from a relationship, not from a
job title, and it needs a different mechanism from the role column.

**Consent must be withdrawable, and the withdrawal must be recorded.** A
caregiver link that cannot be revoked is not consent.

## The seam that already exists

Of the 21 RLS policies in `0001_init.sql`, **13 call one helper function**,
`is_clinician()`. That was written for readability, and it turns out to be the
thing that makes this change tractable: the meaning of "is on the care team"
can be widened in one place instead of in thirteen.

So the nurse/doctor split is mostly additive:

1. Add `nurse` and `doctor` to the `user_role` enum.
2. Keep `is_clinician()` meaning **"is on the care team"** — nurse, doctor,
   the legacy `clinician` value, or admin. All 13 existing policies keep
   working unchanged, and existing rows keep their meaning.
3. Add a second helper, `is_doctor()`, and use it **only** where a decision is
   being recorded: approving or rejecting an AI summary, and acknowledging a
   safety flag.

Nothing is dropped. The narrowing happens by adding a stricter check to two
specific actions, which can be tested one at a time and reverted one at a
time.

> **Warning, worth stating loudly:** PostgreSQL enum values can be added but
> **not removed**. Renaming one later means creating a new type and migrating
> every column that uses it. The role names must be settled before the
> migration runs once.

## Caregivers: a different shape of rule

Not a role, a relationship. A new table:

```
patient_caregivers
  patient_id     -> profiles
  caregiver_id   -> profiles
  relationship   text        -- 'child', 'spouse', 'other'
  granted_at     timestamptz
  revoked_at     timestamptz  -- null while active
  unique (patient_id, caregiver_id)
```

Access is then "this row exists and `revoked_at is null`", added as an
additional policy alongside the existing patient-owns-their-row policies —
never by loosening those.

Two decisions that need making before writing any of it:

- **Can a caregiver see safety flags?** A drowsy-driving flag is exactly the
  thing a family member should know, and exactly the thing a patient might not
  want shared. The safe default is no, with the patient able to opt in.
- **Can a caregiver answer on the patient's behalf?** If yes,
  `intake_responses` needs to record *who* answered, because a questionnaire
  answered by a relative is different clinical evidence from one answered by
  the patient.

Neither question is technical, and both are easier to answer now than halfway
through a migration.

## What has to exist first

**A separate Supabase project as a staging database.** Today local development
and production share one database. That was an acceptable trade while the
schema was small; it is not acceptable while rewriting access rules, because a
mistake in a policy is not a crash — it is data visible to the wrong person,
silently. The free tier allows a second project, and Vercel Preview
deployments can point at it.

**Tests for the policies themselves.** There are 82 tests for the scoring
rules and zero for access control, which is backwards: a wrong score is
something a clinician notices and questions, while data reaching the wrong
person is noticed by nobody. The suite needed is mechanical — sign in as each
role, assert what is visible and, more importantly, what is not.

## Suggested order

1. Staging database + RLS tests for the roles that exist today. No behaviour
   changes. This is the safety net.
2. Nurse/doctor split. Small, additive, and immediately useful.
3. `audit_log`. Once several kinds of user can reach the same record, "who
   looked at what, and when" stops being optional.
4. Caregivers plus `consents`, together. Neither makes sense alone.
