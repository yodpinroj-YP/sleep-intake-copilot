# Sleep Intake Copilot

An AI-assisted pre-visit sleep assessment and clinical summarisation system.
Patients complete standard screening questionnaires from home, rule-based
scoring and safety screening run on the server, and an AI-drafted summary is
prepared for a clinician to approve or reject before it ever becomes part of
the patient's record.

Stack: Next.js (TypeScript), Supabase for auth and database, deployed to
Vercel from GitHub.

**Live app:** https://sleep-intake-copilot.vercel.app
**See the clinician's screen without an account:**
https://sleep-intake-copilot.vercel.app/demo/clinician

## The one idea this project is built around

A screening score is a clinical fact. A summary is prose about that fact.
The two are produced by different machinery and stored in different tables,
and the boundary between them is enforced rather than assumed.

Scores, risk categories and safety flags come from pure functions with 99
automated tests and no network access. They are computed before the language
model is called and handed to it as given facts. The model's only job is to
turn them into sentences a clinician can read quickly.

If the model is wrong, it is wrong about the prose — never about the number.

## What is built

| Area | Status |
| --- | --- |
| Patient intake, three questionnaires | STOP-BANG (8 items), ESS (8 items), ISI (7 items, asked only when a screening question says to) |
| Deterministic scoring | Server-side, 107 tests, never an LLM |
| Safety flags | Two severities; drowsy-driving fires as `urgent` on one item, independent of the total |
| Incomplete data | Reported as a floor with a stated ceiling, never as a conclusion |
| AI summary | Drafted on request, always lands `pending_review` |
| Clinician review | Approve/reject recorded with reviewer and timestamp |
| Public demo | `/demo/clinician` — the real components, fabricated data, no database access |
| Roles | `patient`, `nurse`, `physician`, `admin` — 28 access-control tests hold the boundary |

## Rules this project follows

1. **Business logic separate from UI** — `src/services/` holds the logic.
   Pages and components render and call `fetch`; they never reach into the
   database for anything beyond simple reads.
2. **Never expose secret keys** — `SUPABASE_SERVICE_ROLE_KEY` is read only in
   `src/lib/supabase/admin.ts` and `GEMINI_API_KEY` only in
   `src/services/ai/gemini.ts`. Both files start with `import "server-only"`,
   which fails the build if either is ever imported into a Client Component.
3. **Use Supabase Auth** — email/password via `@supabase/ssr`, with session
   refresh in `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`).
4. **Row Level Security on every table, no exceptions** — patients see only
   their own rows; the care team (via the `is_clinician()` `SECURITY DEFINER`
   helper) sees all patients' clinical data but can update only the
   review-related columns, enforced by column-level grants.
5. **An instrument that was not administered has no score** — the ISI is only
   asked of patients who answer yes to one screening question, and a 'no'
   writes that answer and no `questionnaire_scores` row at all. Storing a 0
   would be indistinguishable from a patient who genuinely scored 0 on all
   seven items. The clinician's screen separates four states for this reason:
   not asked, asked and no symptoms, symptoms reported but unfinished, scored.
6. **A nurse runs the queue; a physician decides** — `is_clinician()` means
   "is on the care team" and answers yes for both. A second helper,
   `is_physician()`, guards exactly two actions: approving or rejecting an AI
   draft, and acknowledging a safety flag. Those are the two moments where
   someone accepts clinical responsibility, and a nurse holding them was a
   permission nobody would grant on purpose.
7. **Deterministic and AI-generated data are stored separately** —
   `questionnaire_scores` and `safety_flags` are rule-based and have no INSERT
   policy for `authenticated` at all: only the server-side scoring engine
   writes to them, so a patient cannot set their own risk score.
8. **AI output is never the record until a human says so** — every
   `clinician_summaries` row is created `pending_review` and becomes
   `approved`/`rejected` only through an explicit clinician action on a
   separate endpoint.
9. **A patient can never self-promote to `clinician`** — `profiles.role`
   defaults to `patient`, is never read from client-supplied signup metadata,
   and `authenticated` holds UPDATE on only three columns of `profiles`, none
   of them `role`. That last clause is the one that actually enforces it, and
   it was missing until 27 September 2026: the schema asserted this rule in a
   comment for three weeks while the database allowed a patient to set their
   own role with one request. The access-control tests found it on their first
   run; `0005_profiles_column_privileges.sql` closed it.
10. **No patient identifier ever reaches the language model** — the prompt
   carries an age *band*, not a date of birth, and no name, hospital number
   or free text the patient typed. An allowlist builds the payload and a
   runtime guard re-checks it against that patient's real identifiers,
   refusing to send if anything matches. `src/services/ai/summary-input.ts`
   explains why, and its tests are the evidence.
11. **A truncated or unparseable AI reply is discarded, not stored** — a
   half-written summary looks like a real one, which makes it the most
   dangerous of the possible failures.
12. **The record of what happened cannot be edited by the thing that
   happened** — `audit_log` accepts inserts and nothing else. UPDATE and
   DELETE raise, service role included, and no signed-in account can read it
   at all. See `docs/audit-log.md` for the three decisions behind that.

## Project structure

```
src/
  app/
    api/intake-sessions/[id]/stopbang/route.ts  # POST -> save + score STOP-BANG
    api/intake-sessions/[id]/ess/route.ts       # POST -> save + score ESS
    api/intake-sessions/[id]/isi/route.ts       # POST -> screen, save + score ISI
    api/intake-sessions/[id]/summary/route.ts   # POST -> draft a summary (clinician only)
    api/clinician-summaries/review/route.ts     # POST -> approve/reject a draft
    intake/[id]/page.tsx                        # Patient: both questionnaires
    dashboard/page.tsx                          # Patient or clinician view, by role
    demo/clinician/page.tsx                     # Public, static, fabricated data
  components/
    stopbang-form.tsx, ess-form.tsx, isi-form.tsx  # Patient-facing questionnaires
    clinician-intake-panel.tsx                  # Scores, breakdowns, safety flags
    clinician-review-panel.tsx                  # AI drafts awaiting review
    generate-summary-button.tsx                 # Asks for a draft
  lib/
    roles.ts                                    # isCareTeam / isPhysician, for rendering only
    stopbang.ts, ess.ts, isi.ts                 # Item wording (see Licensing)
    supabase/admin.ts                           # Service-role client, server-only
  services/
    intake/stopbang-scoring.ts                  # Pure, tested, no imports
    intake/ess-scoring.ts                       # Pure, tested, no imports
    intake/isi-scoring.ts                       # Pure, tested, no imports
    intake/scoring-service.ts                   # Persists scores + reconciles flags
    ai/summary-input.ts                         # De-identification + guard
    ai/summary-prompt.ts                        # Prompt + response parser
    ai/gemini.ts                                # The only file that calls a model
    ai/summary-service.ts                       # Gathers, asks, validates, files
    audit/audit-events.ts                       # Action list + detail allowlist, no imports
    audit/audit-log.ts                          # The only writer, service-role, server-only
supabase/migrations/
  0001_init.sql                 # 7 tables, enums, RLS policies
  0002_intake_session_delete_policy.sql
  0003_stopbang_fields.sql      # neck circumference
  0004_summary_prompt_version.sql
  0005_profiles_column_privileges.sql  # a patient cannot change their own role
  0006_add_role_values.sql      # nurse, physician (run alone — see the file)
  0007_physician_only_decisions.sql  # is_physician() guards the two decisions
  0008_intake_response_delete_policy.sql  # a patient may retract an answer
  0009_audit_log.sql            # append-only; no read policy by design
tests/rls/
  access-control.test.ts        # What each role can and cannot see
scripts/
  check-ai.mjs                  # Credential + latency check, real prompt
  list-ai-models.mjs            # Which models this key can actually use
```

## Tests

```bash
npm test
```

107 tests, run with Node's built-in test runner. They cover the scoring rules
of all three instruments, the safety-flag rules, the de-identification
allowlist and guard, and the parser that decides whether a model's reply is
fit to store.

The scoring files deliberately have **no imports at all** — that is what keeps
them runnable by the test runner, and it is also why a wrong threshold can
never be hidden behind a mock.

### Access control

```bash
npm run test:rls
```

28 tests that sign in as two patients, a nurse and a physician against a
real database and assert what each one can and cannot see: that a patient
cannot read another patient's session, scores or safety flags; that a
signed-out visitor sees nothing; that a patient cannot write their own score,
raise their own safety flag, or approve an AI draft; that a nurse can read
everything but can neither approve a draft nor acknowledge a flag; that
neither a patient nor a nurse can change their own role; and that a patient
can retract an answer on their own open session but not on a completed one,
and never on anybody else's; and that nobody at all — patient, nurse or
physician — can read the audit log, which not even the service role can edit
or delete.

RLS is evaluated by Postgres, not by this codebase, so reading the policies
proves nothing — the only honest test asks the database. The first run of this
suite found a real hole (rule 7 above), which is the argument for having it.

These are kept out of `npm test` on purpose. They need a live database and
credentials, and a suite that fails for environmental reasons teaches you to
ignore failures.

They run against a **separate staging Supabase project**, never production:
they create and delete rows, and `before()` refuses to run at all if the
database contains any account other than the three `@example.com` test users.
Requires `RLS_TEST_PASSWORD` in `.env.local` alongside the staging credentials.

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in:

| Variable | Where from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API Keys |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (secret — server only) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `RLS_TEST_PASSWORD` | The password of the three `@example.com` staging test accounts — only needed for `npm run test:rls` |

Local development points at a **staging** Supabase project, not production.
The two share a schema and nothing else: staging holds three test accounts and
no clinical data, which is what makes it safe to run tests that create and
delete rows. Production credentials belong in the Vercel project only.

Optional: `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` override the defaults in
`src/services/ai/gemini.ts`. Providers retire model names on their own
schedule, so `npm run check:ai:models` lists what the key can actually use.

Then run the migrations in `supabase/migrations/` in order in the Supabase SQL
Editor, and:

```bash
npm run check:ai        # is the key valid and the model reachable?
npm run check:ai:full   # how long does the real prompt take, and what comes back?
npm run dev
```

Signing up creates a `profiles` row with `role = 'patient'`. To see the
clinician view, change that row's `role` to `clinician` in the Supabase Table
Editor — the app deliberately offers no way to do this from the UI.

## Deployment

Add the same environment variables to the Vercel project (Production, Preview
and Development), then redeploy — Vercel does not apply new environment values
to existing deployments. In Supabase, set **Site URL** and add
`<production-url>/auth/callback` as a Redirect URL.

## Known limitations

These are deliberate and documented rather than hidden.

**Questionnaire wording is placeholder text, on all three instruments.**
STOP-BANG is copyrighted (University Health Network, Toronto); the ESS and the
ISI are licensed through the Mapi Research Trust, which requires a licence
whether or not a fee is payable. The strings in `src/lib/stopbang.ts`,
`src/lib/ess.ts` and `src/lib/isi.ts` are plain-language descriptions of each
item, **not** the official wording, so development could proceed before a
licence is granted. Three instruments now means three licences to obtain, and
the request should be made well before any pilot — it is the item on this list
with the longest lead time and the least control over it. Scoring, cut-offs and stored data are
independent of the wording; replacing it is a change to two files.

**The AI runs on a free tier whose terms allow prompts to be used for product
improvement.** Acceptable today because every case in the system is synthetic.
Before a single real patient, this must move to a paid endpoint that does not
train on submitted data. The de-identification described in rule 8 is what
makes that transition a configuration change rather than a redesign.

**The audit log is not yet transactional.** `audit_log` exists and records
reads, decisions, saves, retractions and deletions — but each row is written
as a second statement rather than inside the caller's transaction, so a
decision that succeeds and then fails to log leaves the log a row short. The
caller is told; the database is briefly inconsistent with its own history.
Closing this means moving each decision into a database function. It should
happen before a real patient, and `docs/audit-log.md` records it as the next
step on this table rather than leaving it to be discovered.

**No `consents` table yet.** Required before real clinical use — see
`docs/hospital-integration.md`.

**No caregiver access yet.** The nurse/physician split is built and tested;
caregivers are not. A relative who legitimately fills in the questionnaire
for an elderly parent needs access derived from a relationship rather than a
job title, which needs the `patient_caregivers` and `consents` tables and a
column recording *who answered* each question. Designed in
`docs/role-model.md`, including the two clinical decisions behind it.

**RLS test coverage is real but partial.** 14 tests now cover the three roles
that exist today (see Tests → Access control). They do not yet cover
`intake_responses`, the clinician acknowledgement path on `safety_flags`, or
the column-level grants on `clinician_summaries` beyond the review status.
Every policy this suite does not touch is still a policy nobody has verified.
