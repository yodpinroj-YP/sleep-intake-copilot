# Consent — what is recorded, and the decisions behind it

Status: **built and tested, not yet run against staging or production.**
Migrations `0010_consents.sql` and `0011_audit_consent_actions.sql` create it;
`src/lib/consent.ts` holds the wording and `src/services/consent/` the logic.

## Why this had to exist before the first patient

Health data is sensitive personal data under section 26 of Thailand's Personal
Data Protection Act. It requires explicit consent, and a controller cannot fall
back on another lawful basis for it.

Until this work, the application asked for a name, an email and a password, and
then collected questionnaire answers. `createIntakeSession` inserted a row with
no check of any kind. So the question a patient is entitled to ask — *when did
I agree, and to what?* — had no answer anywhere in the system.

## Decisions on record

**Three purposes, recorded separately.** Consent has to be specific, so one
tick covering everything would not be consent at all.

| Purpose | Required | What declining costs the patient |
|---|---|---|
| `care` | Yes | There is no service without it; the app refuses to start an intake session. |
| `ai_summary` | No | Nothing. Every score and every safety flag is computed without AI; the physician reads them directly. |
| `research` | No | Nothing. Their data is used only for their own care. |

That `ai_summary` is genuinely optional is a property of the architecture, not
a promise: the deterministic engine has never depended on the model.

**Asked once, asked again when the wording changes.** Every row stores
`text_version`, the stamp from `CONSENT_TEXT_VERSION` in `src/lib/consent.ts`.
A consent given against an older version is treated as *stale* — which the code
handles as "must ask again", not as "still consented". A consent recorded
against wording nobody can reproduce proves nothing.

The text lives in code rather than in a database row so that changing it goes
through the same review as anything else that ships: visible in a diff,
attributable to a commit.

**Withdrawal stops future use; it does not delete.** The right to withdraw
consent and the right to erasure are separate rights with separate answers, and
medical records carry retention obligations of their own. Erasure is a request
to the hospital's data protection officer — a decision made by a person, not a
button that quietly destroys a clinical record. The interface says this in
plain Thai next to the controls rather than burying it in a policy page.

## Append-only, like the audit log

Withdrawing consent inserts a new row with `granted = false`. It never edits
the row that granted it. Triggers refuse `UPDATE` and `DELETE`, service role
included.

The reason is the same one behind `audit_log`: you have to be able to show what
the patient had agreed to **on the day the data was collected**, and a record
that can be overwritten shows only what is true now.

`current_consents` is a view — the newest row per (patient, purpose) — rather
than a stored "current" column, so there is one source of truth instead of two
that can disagree. It is declared `security_invoker = true`; without that it
would run with its owner's privileges and hand every patient's answer to every
caller.

## One difference from the audit log, and why

`consents.patient_id` is a foreign key that cascades on delete. `audit_log`
deliberately has no foreign keys.

An audit row records that an action happened and must outlive the account that
performed it. A consent is meaningless without the person who gave it — so if a
patient's account is erased, their consent records go with it rather than
lingering as a claim about someone the database can no longer name.

The honest tension: audit rows then hold a `patient_id` pointing at a person the
system can no longer identify. That is pseudonymous rather than identifying, and
it is the price of keeping an accountability trail at all. It is worth raising
with the hospital's DPO rather than settling here.

## Where the gates are

Both sit at the boundary they protect, not in a page:

- `createIntakeSession` calls `assertRequiredConsent` before inserting. A check
  in the interface can be bypassed by calling the API; this one cannot be
  bypassed by any caller the application has.
- `generateSummaryForSession` refuses with `AiConsentMissingError` unless the
  patient granted `ai_summary`. This function is the only thing in the codebase
  that sends patient-derived data to a third party, so the check belongs in it.
  The route answers **409**, not 500 — nothing is broken, the patient made a
  choice.

The dashboard also skips listing a patient's sessions when consent is missing,
because listing them is itself reading health data.

## Audit

`consent_granted` and `consent_withdrawn` were added to `audit_log`, with
`consentPurpose` and `consentTextVersion` added to the detail allowlist. "When
did they withdraw?" is among the first questions a data protection enquiry asks.

Migration `0011` widened the existing check constraint in a single transactional
statement — which is the payoff for 0009 choosing `text` + `check` over an enum.

## Still missing

- **Caregivers.** `recorded_by` is a separate column from `patient_id` so that
  "the daughter consented on her mother's behalf" will be recordable, but the
  relationship and the authority to do it do not exist yet.
- **Staff-entered consent.** `source` allows `'staff_entry'` for a paper form
  transcribed at the desk. No interface writes it.
- **The wording itself has not been reviewed by anyone but its author.** It must
  go to the hospital's DPO before a real patient sees it. Appendix A question 3
  of the implementation plan asks for exactly that.
