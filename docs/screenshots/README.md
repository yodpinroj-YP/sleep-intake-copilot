# Screenshots

Each image here exists to answer one question. The caption is what that image
proves — not a description of what is on screen, which anyone can see.

Capture everything at the same browser width so the set reads as one system.
Save straight into this folder under these exact names; do not route them
through PowerPoint first, because an image pasted into a slide is no longer a
file anyone can re-use.

## The set

| File | Answers the question |
| --- | --- |
| `01-clinician-dashboard.png` | What does a doctor see when they open this? |
| `02-clinician-review-queue.png` | **Retake.** The review queue holding a real AI draft, in Thai, with the approve and reject buttons visible. |
| `03-patient-dashboard.png` | What does a patient see? |
| `04-patient-form-step1.png` | How are the measurements collected? |
| `05-patient-form-step2.png` | How are the STOP-BANG questions asked? |
| `06-tests-passing.png` | **Retake.** `npm test` showing `pass 82`. |
| `07-scores-table.png` | Where do the scores live, and who wrote them? |
| `08-rls-policies.png` | Is access control real, or asserted? |
| `09-ess-patient-form.png` | How is daytime sleepiness measured? Show the 0–3 scale explained at the top plus the first few items. |
| `10-clinician-two-scores.png` | What does a doctor take in within three seconds? One case card showing the STOP-BANG letter row and the ESS number row together. |
| `11-urgent-driving-flag.png` | Why is this better than reading a total? The ณิชา case on `/demo/clinician` — dark red border, the urgent badge, and the driving text in one frame. |
| `12-ai-processing-log.png` | What is kept about each AI call? The `ai_processing_logs` table with all columns visible — the point is the **absence** of any column holding prompt or reply text. |
| `13-summary-pending-review.png` | Does AI output enter the record automatically? The `clinician_summaries` table showing `status = pending_review` and `prompt_version = summary-v1`. |
| `14-public-demo-ai.png` | Can an evaluator see the AI without an account? The AI section of `/demo/clinician`, including the yellow "ต้องยืนยันกับผู้ป่วยก่อนเชื่อถือ" list. |
| `15-ai-draft-example-2.png` | Optional second example. A different real case, useful as a backup slide when someone asks whether the first output was cherry-picked. |

## The two that carry the most weight

`11` is the single strongest image in the set. It shows a patient whose totals
are unremarkable on both questionnaires and who is nonetheless flagged as
urgent, because one item about dozing in traffic was answered at maximum. No
sentence explains the value of this system as quickly as that card does.

`12` is the one to have ready for the privacy question. It is evidence of a
negative — that nothing identifying is stored about the AI calls — and a
negative is very hard to argue in words and very easy to show.

## How to capture

`Win + Shift + S`, drag around the region, then paste into Paint and save as
PNG under the name above. Keep the browser window at one width throughout.

For the Supabase tables, widen the columns so nothing is cut off mid-value —
a screenshot of a table with a truncated column invites the question of what
was hidden.
