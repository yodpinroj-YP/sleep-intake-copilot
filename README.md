# Next.js + Supabase + AI Starter

A project scaffold implementing the architecture below: Next.js (TypeScript)
on the frontend, Supabase for auth/database/storage, an external AI API
called only from the server, and deployment to Vercel via GitHub.

## Architecture

```
User
  |
Next.js
  |
Supabase
  |-- Auth
  |-- PostgreSQL
  |-- Storage

Next.js
  |
AI Service
  |
LLM Provider

GitHub -> Vercel -> Production
```

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS v4 + shadcn/ui |
| Backend / data | Supabase (Auth, PostgreSQL, Storage) |
| AI | External AI API, called from server-side routes only |
| Deployment | Vercel, deployed from GitHub |

## Rules this scaffold follows

1. **Business logic separate from UI** — `src/services/*` holds all
   business logic (AI calls, review workflow). Pages and components only
   render and call `fetch`/Server Actions; they never call Supabase or
   the AI provider's business rules directly.
2. **Never expose secret API keys** — `SUPABASE_SERVICE_ROLE_KEY` and
   `AI_API_KEY` are read only in files marked `import "server-only"`
   (`src/lib/supabase/admin.ts`, `src/services/ai/client.ts`), which fail
   to build if ever imported into a Client Component.
3. **Use Supabase Auth** — email/password auth via `@supabase/ssr`, with
   session refresh handled in `src/middleware.ts`.
4. **Use RLS** — every table in `supabase/migrations/0001_init.sql` has
   Row Level Security enabled with owner-scoped policies.
5. **Server-side API routes for secret AI calls** — `src/app/api/ai/*`
   are the only place the client ever talks to for AI features; they
   delegate to `src/services/ai`, which is server-only.
6. **Synthetic data during development** — `supabase/seed.sql` inserts a
   fake auth user and fake `ai_outputs` rows for local development only.
7. **Keep AI output reviewable** — every AI generation is stored with
   `status = 'pending_review'` and only becomes `approved`/`rejected`
   through an explicit human action (the dashboard's Approve/Reject
   buttons, backed by `POST /api/ai/review`).

## Project structure

```
src/
  app/
    api/ai/generate/route.ts   # POST -> src/services/ai (generate + store)
    api/ai/review/route.ts     # POST -> src/services/ai (approve/reject)
    auth/callback/route.ts     # Supabase email/OAuth redirect handler
    auth/signout/route.ts      # POST to sign out
    login/, signup/            # Auth pages + Server Actions
    dashboard/page.tsx         # Protected page, renders <AiPanel />
  components/
    ui/                        # shadcn/ui primitives (button, card, input, ...)
    ai-panel.tsx                # Client component: generate + review AI outputs
  lib/supabase/
    client.ts                  # Browser Supabase client (anon key)
    server.ts                  # Server Supabase client (anon key, cookies)
    admin.ts                   # Service-role client — server-only, bypasses RLS
    middleware.ts               # Session refresh + route protection
  services/
    ai/client.ts                # Calls the external AI provider — server-only
    ai/service.ts                # Business logic: generate/list/review AI outputs
  types/database.types.ts      # Hand-written types matching the SQL schema
supabase/
  migrations/0001_init.sql     # Tables + RLS policies
  seed.sql                     # Synthetic dev-only data
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com)
   (or run one locally with the [Supabase CLI](https://supabase.com/docs/guides/cli):
   `supabase init && supabase start`).

3. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project's API settings,
   and `AI_API_URL` / `AI_API_KEY` / `AI_MODEL` for your AI provider.

4. **Apply the database schema**

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push          # applies supabase/migrations
   supabase db reset         # local only: reapplies migrations + seed.sql
   ```

5. **Generate real database types** (replaces the hand-written starter
   types so they can't drift from the schema):

   ```bash
   npx supabase gen types typescript --project-id <your-project-ref> \
     --schema public > src/types/database.types.ts
   ```

6. **Run the dev server**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000`, sign up, confirm the email (or use the
   seeded `demo@example.com` / `password123` user on a local Supabase
   instance), and try generating an AI output from the dashboard.

## Wiring up the real AI provider

`src/services/ai/client.ts` is a placeholder HTTP call. Replace the
`fetch` call (and the response-shape mapping at the bottom of the file)
with your provider's actual SDK or endpoint — Anthropic, OpenAI, or
otherwise. Nothing else needs to change: the route handlers and UI
already treat `requestAiCompletion` as an opaque function.

## Deployment

1. Push this repository to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Add the same environment variables from `.env.local` to the Vercel
   project's Environment Variables settings.
4. Add your production URL as a Redirect URL in Supabase Auth settings
   (Authentication > URL Configuration) and update `NEXT_PUBLIC_SITE_URL`.
5. Every push to the connected branch redeploys automatically
   (GitHub -> Vercel -> Production).

## Notes / next steps

- The `ai_outputs` review policy currently lets any user review their
  own outputs. For a real reviewer/approver workflow, add a `roles`
  table and check a `reviewer` role instead of `auth.uid() = user_id`.
- Storage (`supabase.storage`) isn't wired into the UI yet; add a bucket
  and a small `src/services/storage` module following the same pattern
  as `src/services/ai` when you need file uploads.
- `shadcn/ui` components here were added by hand (network access to the
  shadcn registry wasn't available while scaffolding). To add more
  components later with the CLI: `npx shadcn@latest add <component>`.
