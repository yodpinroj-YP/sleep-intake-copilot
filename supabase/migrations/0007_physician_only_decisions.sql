-- ---------------------------------------------------------------------------
-- 0007 — a nurse runs the queue, a physician decides
--
-- Run AFTER 0006 has committed. It names the enum values 0006 added, and
-- PostgreSQL will reject it if both run in one transaction.
--
-- WHY
-- Until now a sleep clinic's nurse and its physician would share one
-- 'clinician' role, which means a nurse could approve an AI-drafted summary
-- into the medical record. Nobody would grant that permission on purpose; it
-- existed because the role model was one size too small.
--
-- THE SHAPE OF THE CHANGE
-- is_clinician() keeps its meaning — "is on the care team" — and is widened
-- to accept the two new roles. All 13 policies that call it keep working
-- unchanged, and a nurse gets exactly the read access a clinician had.
--
-- Narrowing happens in one place only: a second helper, is_physician(), is
-- applied to the two actions that record a decision rather than perform a
-- task. Approving or rejecting an AI summary, and acknowledging a safety
-- flag. Both are moments where someone accepts clinical responsibility.
--
-- Nothing is taken away from anyone who is not making one of those two
-- decisions, which is what keeps this migration small enough to reason about
-- and reversible one policy at a time.
-- ---------------------------------------------------------------------------

-- 1. Widen the care team. Legacy 'clinician' stays accepted so that any row
--    missed by the conversion below keeps its read access rather than
--    silently losing it.
create or replace function public.is_clinician()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('nurse', 'physician', 'clinician', 'admin')
  );
$$;

-- 2. The narrower question. Deliberately a separate function rather than an
--    argument to the first one: every policy that calls is_physician() is a
--    place where the system records who decided, and they should be findable
--    by searching for one word.
create or replace function public.is_physician()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('physician', 'admin')
  );
$$;

-- 3. Approving an AI draft into the record is a physician's decision.
drop policy if exists "Clinicians can review clinician summaries" on public.clinician_summaries;

create policy "Physicians can review clinician summaries"
  on public.clinician_summaries for update
  using (public.is_physician())
  with check (public.is_physician());

-- 4. So is accepting a safety flag as seen and handled. A nurse may well be
--    the person who acts on it; recording that it has been dealt with is a
--    different act from acting on it.
drop policy if exists "Clinicians can acknowledge safety flags" on public.safety_flags;

create policy "Physicians can acknowledge safety flags"
  on public.safety_flags for update
  using (public.is_physician())
  with check (public.is_physician());

-- 5. Everyone who holds the legacy role today is, in fact, a physician: the
--    only accounts carrying it are the project's own clinician logins, which
--    approve summaries. Converting them keeps those accounts working and
--    leaves 'clinician' as a value nothing is written with any more.
--
--    This is the one statement in this file that changes data rather than
--    rules. It is idempotent — running it twice converts nothing the second
--    time — and reversible with the same statement in the other direction.
update public.profiles set role = 'physician' where role = 'clinician';
