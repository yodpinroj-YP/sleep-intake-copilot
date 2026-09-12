# Sleep Intake Copilot

An AI-assisted pre-visit sleep assessment and clinical summarization system.
Patients complete a structured intake, deterministic questionnaire scoring
and safety screening run automatically, and an AI-drafted clinical summary
is generated for a clinician to review, approve, or reject before it ever
becomes part of the patient's record.

Stack: Next.js (TypeScript) on the frontend, Supabase for auth/database, and
deployment to Vercel via GitHub.

**Live app:** https://sleep-intake-copilot.vercel.app

## Architecture

```
Patient
  |
Next.js (App Router)
  |
Supabase
  |-- Auth (email/password)
  |-- PostgreSQL (7 tables, RLS on every table)

Sleep Intake workflow:
  intake_sessions -> intake_responses -> questionnaire_scores
                                       -> safety_flags
                                       -> clinician_summaries (AI-drafted,
                                          pending_review until a clinician
                                          approves/rejects)
                   -> ai_processing_logs (technical audit trail)

GitHub -> Vercel -> Production
```

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS v4 + shadcn/ui |
| Backend / data | Supabase (Auth, PostgreSQL, Row Level Security) |
| Deployment | Vercel, deployed from GitHub |

## Rules this project follows

1. **Business logic separate from UI** — `src/services/intake/service.ts`
   holds all business logic (creating/listing intake sessions, reviewing
   clinician summaries). Pages and components only render and call
   `fetch`/Server Actions; they never call Supabase directly for anything
   beyond simple reads.
2. **Never expose secret API keys** — `SUPABASE_SERVICE_ROLE_KEY` is read
   only in `src/lib/supabase/admin.ts`, which is guarded with
   `import "server-only"` and fails to build if ever imported into a
   Client Component.
3. **Use Supabase Auth** — email/password auth via `@supabase/ssr`, with
   session refresh handled in `src/proxy.ts` (Next.js 16's replacement for
   `middleware.ts`).
4. **Use RLS, no exceptions** — every table in
   `supabase/migrations/0001_init.sql` and
   `supabase/migrations/0002_intake_session_delete_policy.sql` has Row
   Level Security enabled. Patients can only see/edit their own rows;
   clinicians (checked via the `is_clinician()` `SECURITY DEFINER`
   function) can see all patients' clinical data but only ever update the
   review-related columns.
5. **Deterministic vs. AI-generated data is stored separately** —
   `questionnaire_scores` and `safety_flags` are computed by rule-based
   code and are never delegated to an LLM. `clinician_summaries` holds the
   AI-drafted narrative summary and is clearly separated from the
   deterministic tables.
6. **Keep AI output reviewable** — every `clinician_summaries` row is
   created with `status = 'pending_review'` and only becomes
   `approved`/`rejected` through an explicit clinician action (the
   clinician dashboard's Approve/Reject buttons, backed by
   `POST /api/clinician-summaries/review`).
7. **A patient can never self-promote to `clinician`** — the `role`
   column on `profiles` defaults to `patient` on signup and is never read
   from client-supplied signup metadata; changing a user's role is a
   deliberate admin action (e.g. via the Supabase Table Editor or a
   service-role script), not something the app UI exposes.

## Project structure

```
src/
  app/
    api/intake-sessions/route.ts             # POST -> create a session (Create)
    api/intake-sessions/[id]/route.ts         # PATCH/DELETE -> edit/delete a session
    api/clinician-summaries/review/route.ts   # POST -> approve/reject a summary
    auth/callback/route.ts                    # Supabase email/OAuth redirect handler
    auth/signout/route.ts                     # POST to sign out
    login/, signup/                           # Auth pages + Server Actions
    dashboard/page.tsx                        # Protected page; renders the
                                               # patient or clinician view
                                               # depending on profiles.role
  components/
    ui/                          # shadcn/ui primitives (button, card, input, badge, ...)
    intake-sessions-panel.tsx    # Patient view: list/create/edit/delete sessions
    clinician-review-panel.tsx   # Clinician view: approve/reject pending summaries
  lib/supabase/
    client.ts                   # Browser Supabase client (anon key)
    server.ts                   # Server Supabase client (anon key, cookies)
    admin.ts                    # Service-role client — server-only, bypasses RLS
    middleware.ts                # Session refresh + route protection
  services/
    intake/service.ts           # Business logic for the intake/review workflow
  types/database.types.ts       # Types matching the SQL schema (7 tables + enums)
supabase/
  migrations/
    0001_init.sql                             # 7 tables, enums, RLS policies
    0002_intake_session_delete_policy.sql     # Adds the DELETE policy for sessions
  seed.sql                      # Synthetic dev-only data (local Supabase CLI only)
```

## Database schema

7 tables, all with Row Level Security enabled:

| Table | Purpose |
| --- | --- |
| `profiles` | One row per user; `role` is `patient`, `clinician`, or `admin` |
| `intake_sessions` | Hub table — one per patient intake attempt |
| `intake_responses` | Structured/free-text answers linked to a session |
| `questionnaire_scores` | Deterministic ESS / STOP-BANG / ISI / BERLIN scores |
| `safety_flags` | Rule-based red-flag detection (e.g. drowsy driving) |
| `clinician_summaries` | AI-drafted narrative summary; `pending_review` → `approved`/`rejected` |
| `ai_processing_logs` | Technical audit trail of AI feature calls |

See `supabase/migrations/0001_init.sql` for the full column list, and the
project's `DATABASE.md` (if present) for the original design rationale.

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com).

3. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   from your Supabase project's Settings > API page.

4. **Apply the database schema**

   Open the Supabase SQL Editor and run, in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_intake_session_delete_policy.sql`

5. **Run the dev server**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000`, sign up (this creates a `profiles` row
   with `role = 'patient'` automatically), and try starting an intake
   session from the dashboard.

   While testing signups repeatedly, you may hit Supabase's email rate
   limit. For local development, disabling **Confirm email** under
   Authentication > Providers > Email avoids this entirely.

## Deployment

1. Push this repository to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `NEXT_PUBLIC_SITE_URL` (your production URL) to the Vercel project's
   Environment Variables.
4. In Supabase, set **Site URL** and add a **Redirect URL**
   (`<your-production-url>/auth/callback`) under
   Authentication > URL Configuration to match your Vercel domain.
5. Whenever you change an environment variable in Vercel, trigger a
   **Redeploy** — existing deployments don't pick up new env var values
   automatically.
6. Every push to the connected branch redeploys automatically afterwards
   (GitHub -> Vercel -> Production).

## Notes / next steps

- `clinician_summaries` rows are currently created only via
  `supabase/seed.sql` (local dev) or directly in the database — there's
  no UI yet for triggering the AI summarization step itself. Wiring that
  up means adding a service-role-only route that reads `intake_responses`
  + `questionnaire_scores` for a session, calls an LLM, and inserts a
  `pending_review` row into `clinician_summaries`.
- `shadcn/ui` components here were added by hand (network access to the
  shadcn registry wasn't available while scaffolding). To add more
  components later with the CLI: `npx shadcn@latest add <component>`.
- Promoting a user to `clinician` currently requires manually editing
  their `profiles.role` in the Supabase Table Editor. A real admin
  workflow would put this behind a protected admin-only page or a
  service-role script instead.
