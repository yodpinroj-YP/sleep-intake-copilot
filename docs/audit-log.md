# Audit log — what it records, and what was decided

Status: **built and tested, not yet run against production.** Migration
`0009_audit_log.sql` creates the table; `src/services/audit/` writes to it.

## The three questions this exists to answer

1. **Who decided this, and did they decide something else first?**
   `clinician_summaries.reviewed_by` holds only the latest decision. A
   physician who approves a draft and then rejects it overwrites the approval,
   and the fact that it ever happened is gone. `safety_flags.acknowledged_by`
   has the same shape.

2. **Who looked at this patient's record?** Nothing recorded a read before
   this. It is the first question a PDPA access request asks.

3. **This answer used to be here — who removed it?** Migration 0008 let
   patients retract an answer, and the row is deleted outright. That was the
   right call for the scoring model and it left no trace whatsoever.

## Decisions on record

**Scope: writes, plus reads of a patient's record.** Loading the clinician
queue writes one `record_viewed` row per patient shown, because in the current
interface the queue *is* the record view — the dashboard renders every
session's scores, breakdowns and flags at once, so opening it really is
reading everybody's record. Aggregate page loads with no patient data are not
logged.

A consequence worth naming: when the queue outgrows a screenful it needs
pagination or a filter. Not to cut down on logging, but because a clinician
opening a list of four hundred is not meaningfully reading four hundred
records, and the log would be claiming they did.

**Retention: none — every row is kept.** Chosen while the system has no real
patients and the rows are small. A deletion rule picked now would be picked
without knowing which questions the log ends up being asked. When that
changes, the rule belongs in its own migration alongside a written statement of
what may be deleted and why, and it will have to disable the append-only
triggers to do it. That friction is the point.

**Access: administrators only, outside the application.** RLS is enabled with
no policy at all, so every account signed into the app — patient, nurse,
physician, admin — reads zero rows. The log is reachable only through the
service-role key or a direct SQL session. Four tests in
`tests/rls/access-control.test.ts` hold this.

Building a screen for it later is one migration and one policy. Deciding
afterwards that the screen should not have existed is not undoable, because by
then people have read it.

## What may be written

`details` is checked against an allowlist in `audit-events.ts` before anything
reaches the database, and an unknown key **throws** rather than being stripped
— a caller must never believe it recorded something it did not.

The rule: this table records *that* something happened, never *what the
clinical data said*. No answer values, no free text, no names, no dates of
birth. Reviewer notes are deliberately not logged; they are clinical text and
they live in the record.

`patient_id` **is** stored, and that is not a contradiction. The
de-identification allowlist for the AI payload exists to stop identifiers
leaving this system for a third party. This table never leaves the database,
and naming the patient is the entire point — a log that cannot say whose record
was opened answers none of the three questions above.

## Known limitation, to close before real patients

The audit write is a **second statement, not part of the caller's
transaction**. If a physician's decision succeeds and the audit insert then
fails, the decision stands and the log is missing an entry. The caller finds
out — `recordAuditEvents` throws and the route returns an error — but for a
moment the database disagrees with its own history.

Closing this properly means moving each decision into a database function so
the change and its audit row commit together. That is the next piece of work
on this table, and it should happen before the system sees a real patient.

Reads are the deliberate exception: `tryRecordAuditEvents` logs loudly to the
server console and lets the read through. A clinician locked out of the queue
cannot see an urgent drowsy-driving flag, and no bookkeeping is worth that.

## Queries an administrator actually runs

Everything below runs in the Supabase SQL editor, which connects as `postgres`
and is therefore not subject to RLS.

Who touched one patient's record:

```sql
select occurred_at, action, actor_id, actor_role, details
from public.audit_log
where patient_id = '<patient uuid>'
order by occurred_at desc;
```

What one member of staff did:

```sql
select occurred_at, action, patient_id, session_id, details
from public.audit_log
where actor_id = '<staff uuid>'
order by occurred_at desc;
```

Every clinical decision, newest first:

```sql
select occurred_at, action, actor_id, actor_role, patient_id, details
from public.audit_log
where action in ('summary_approved', 'summary_rejected')
order by occurred_at desc;
```

Everything that removed data:

```sql
select occurred_at, action, actor_id, patient_id, session_id, details
from public.audit_log
where action in ('answer_retracted', 'session_deleted')
order by occurred_at desc;
```

## Not yet logged, because it does not yet happen

`safety_flags.acknowledged_by` exists in the schema and the clinician screen
reads it, but no route writes it — acknowledging a flag is not implemented. The
day it is, it needs an action of its own here. It is the clearest example of a
decision a clinician makes about a patient's safety, and it would be strange
for it to be the one thing this table cannot see.
