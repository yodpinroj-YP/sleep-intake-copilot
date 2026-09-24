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

Scores, risk categories and safety flags come from pure functions with 82
automated tests and no network access. They are computed before the language
model is called and handed to it as given facts. The model's only job is to
turn them into sentences a clinician can read quickly.

If the model is wrong, it is wrong about the prose — never about the number.

## What is built

| Area | Status |
| --- | --- |
| Patient intake, two questionnaires | STOP-BANG (8 items) and ESS (8 items) |
| Deterministic scoring | Server-side, 82 tests, never an LLM |
| Safety flags | Two severities; drowsy-driving fires as `urgent` on one item, independent of the total |
| Incomplete data | Reported as a floor with a stated ceiling, never as a conclusion |
| AI summary | Drafted on request, always lands `pending_review` |
| Clinician review | Approve/reject recorded with reviewer and timestamp |
| Public demo | `/demo/clinician` — the real components, fabricated data, no database access |

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
   their own rows; clinicians (via the `is_clinician()` `SECURITY DEFINER`
   helper) see all patients' clinical data but can update only the
   review-related columns, enforced by column-level grants.
5. **Deterministic and AI-generated data are stored separately** —
   `questionnaire_scores` and `safety_flags` are rule-based and have no INSERT
   policy for `authenticated` at all: only the server-side scoring engine
   writes to them, so a patient cannot set their own risk score.
6. **AI output is never the record until a human says so** — every
   `clinician_summaries` row is created `pending_review` and becomes
   `approved`/`rejected` only through an explicit clinician action on a
   separate endpoint.
7. **A patient can never self-promote to `clinician`** — `profiles.role`
   defaults to `patient` and is never read from client-supplied signup
   metadata. Even the public demo page refuses to break this rule for
   convenience; it passes fabricated data to the real components instead.
8. **No patient identifier ever reaches the language model** — the prompt
   carries an age *band*, not a date of birth, and no name, hospital number
   or free text the patient typed. An allowlist builds the payload and a
   runtime guard re-checks it against that patient's real identifiers,
   refusing to send if anything matches. `src/services/ai/summary-input.ts`
   explains why, and its tests are the evidence.
9. **A truncated or unparseable AI reply is discarded, not stored** — a
   half-written summary looks like a real one, which makes it the most
   dangerous of the possible failures.

## Project structure

```
src/
  app/
    api/intake-sessions/[id]/stopbang/route.ts  # POST -> save + score STOP-BANG
    api/intake-sessions/[id]/ess/route.ts       # POST -> save + score ESS
    api/intake-sessions/[id]/summary/route.ts   # POST -> draft a summary (clinician only)
    api/clinician-summaries/review/route.ts     # POST -> approve/reject a draft
    intake/[id]/page.tsx                        # Patient: both questionnaires
    dashboard/page.tsx                          # Patient or clinician view, by role
    demo/clinician/page.tsx                     # Public, static, fabricated data
  components/
    stopbang-form.tsx, ess-form.tsx             # Patient-facing questionnaires
    clinician-intake-panel.tsx                  # Scores, breakdowns, safety flags
    clinician-review-panel.tsx                  # AI drafts awaiting review
    generate-summary-button.tsx                 # Asks for a draft
  lib/
    stopbang.ts, ess.ts                         # Item wording (see Licensing)
    supabase/admin.ts                           # Service-role client, server-only
  services/
    intake/stopbang-scoring.ts                  # Pure, tested, no imports
    intake/ess-scoring.ts                       # Pure, tested, no imports
    intake/scoring-service.ts                   # Persists scores + reconciles flags
    ai/summary-input.ts                         # De-identification + guard
    ai/summary-prompt.ts                        # Prompt + response parser
    ai/gemini.ts                                # The only file that calls a model
    ai/summary-service.ts                       # Gathers, asks, validates, files
supabase/migrations/
  0001_init.sql                 # 7 tables, enums, RLS policies
  0002_intake_session_delete_policy.sql
  0003_stopbang_fields.sql      # neck circumference
  0004_summary_prompt_version.sql
scripts/
  check-ai.mjs                  # Credential + latency check, real prompt
  list-ai-models.mjs            # Which models this key can actually use
```

## Tests

```bash
npm test
```

82 tests, run with Node's built-in test runner. They cover the scoring rules,
the safety-flag rules, the de-identification allowlist and guard, and the
parser that decides whether a model's reply is fit to store.

The scoring files deliberately have **no imports at all** — that is what keeps
them runnable by the test runner, and it is also why a wrong threshold can
never be hidden behind a mock.

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

**Questionnaire wording is placeholder text.** STOP-BANG is copyrighted
(University Health Network, Toronto) and the ESS is licensed through the Mapi
Research Trust, which requires a licence whether or not a fee is payable. The
strings in `src/lib/stopbang.ts` and `src/lib/ess.ts` are plain-language
descriptions of each item, **not** the official wording, so development could
proceed before a licence is granted. Scoring, cut-offs and stored data are
independent of the wording; replacing it is a change to two files.

**The AI runs on a free tier whose terms allow prompts to be used for product
improvement.** Acceptable today because every case in the system is synthetic.
Before a single real patient, this must move to a paid endpoint that does not
train on submitted data. The de-identification described in rule 8 is what
makes that transition a configuration change rather than a redesign.

**No `audit_log` or `consents` table yet.** Both are required before real
clinical use — see `docs/hospital-integration.md`.

**Roles are `patient` / `clinician` / `admin` only.** Splitting clinician into
nurse and doctor, and adding caregivers, is designed in
`docs/role-model.md` and deliberately deferred: it rewrites access rules
across the whole schema, which is not work to do under a deadline.

**No automated tests for the RLS policies themselves.** The scoring rules are
well covered; access control is not. That gap is the first thing to close.
