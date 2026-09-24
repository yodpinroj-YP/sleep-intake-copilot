# Screenshots

Each image answers one question. The caption is what the image proves — not a
description of what is on screen, which anyone can see.

All captures were taken from the running system. Nothing here is a mock-up.

## The set

| File | Answers the question |
| --- | --- |
| `00-landing-page.png` | What is this, in one screen? The four principles the system holds itself to. |
| `01-clinician-dashboard.png` | What does a doctor see? One case with both scores, an urgent flag, and the button that asks for an AI draft. |
| `02-clinician-review-queue.png` | What does an AI draft look like before anyone accepts it? Full text, four sections, approve and reject. |
| `03-patient-dashboard.png` | What does a patient see? |
| `04-patient-form-step1.png` | How does intake start? Note the line explaining that there are two questionnaires. |
| `05-patient-form-step2.png` | How are the STOP-BANG questions asked? |
| `06-tests-passing.png` | Is the scoring actually tested? `pass 82`. |
| `07-scores-table.png` | Who computed the scores? Two instruments, separate rows, `computed_by = deterministic_engine`. |
| `08-rls-policies.png` | Is access control real, or asserted? |
| `09-ess-patient-form.png` | How is daytime sleepiness measured? The 0–3 scale explained once, then the items. |
| `09b-ess-driving-item.png` | Item 8 answered at maximum — the input that produces the urgent flag in `11`. |
| `10-clinician-two-scores.png` | What does a doctor take in within three seconds? Letters for STOP-BANG, numbers for ESS. |
| `11-urgent-driving-flag.png` | **The key image.** Both totals unremarkable, yet flagged urgent, because of one item. |
| `12a-ai-processing-log-left.png` | What is recorded about an AI call — part one. |
| `12b-ai-processing-log-right.png` | Part two. The point is the **absence** of any column holding prompt or reply text. One row is a real failure, kept deliberately. |
| `13a-summary-pending-review.png` | Does AI output enter the record automatically? `status = pending_review`, `reviewed_by = NULL`. |
| `13b-summary-prompt-version.png` | Can an approved summary be traced to the instructions that produced it? `prompt_version = summary-v1`. |
| `14-public-demo-ai.png` | Can an evaluator see the AI without an account? |
| `15-ai-draft-example-2.png` | Was the first output cherry-picked? A second case, different shape. |
| `16-demo-incomplete-floor.png` | What happens when a questionnaire is unfinished? The score is reported as a floor with its ceiling. |

## The two that carry the most weight

`11` is the strongest image here. A patient whose totals are unremarkable on
both questionnaires, flagged urgent because one item about dozing in traffic
was answered at maximum. Pair it with `09b`, which shows that answer being
given — the cause and the effect, on two slides.

`12b` is the one to have ready for the privacy question. It is evidence of a
negative, and a negative is hard to argue in words and easy to show.

## How to capture

`Win + Shift + S`, drag around the region, paste into Paint, save as PNG.
Keep the browser at one width throughout so the set reads as one system.

For database views, prefer the **SQL Editor** over the Table Editor when the
table has long `jsonb` columns: selecting only the columns that matter gives a
narrow, complete result with nothing truncated. `07` was taken that way.

The no-truncation rule applies strictly to `12a`/`12b`, where the claim is
that a column does not exist. Elsewhere a clipped `jsonb` blob is harmless —
nobody is being asked to read it.
