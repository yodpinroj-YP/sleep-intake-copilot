# Getting from a working prototype to a hospital

Status: **plan, not implementation.** Written to answer the question every
evaluator asks — "how would this actually be used?" — with something more
specific than optimism.

## The obstacle is not technical

A hospital information system sits on a closed network. It does not accept
connections from the internet, and its administrators are right to keep it
that way. Asking for database credentials to a live HIS is a request that ends
the conversation, and it should.

So the plan does not start with integration. It starts with the stage that
needs no permission from anyone's IT department, and earns the next one.

## Stage 1 — Alongside the HIS, connected to nothing

The patient receives a link, answers from home, and the clinician opens the
result on this system's own screen before the consultation. No data flows into
or out of the hospital's systems.

What this needs: ethics committee approval for a pilot, PDPA consent, and the
two tables this project has deliberately not built yet — `consents` and
`audit_log`.

What it is worth: the clinical value is already real at this stage. A doctor
walks into the room knowing the screening scores, which questions were left
unanswered, and whether anything urgent was flagged. That is the whole benefit
of pre-visit intake, available before a single line of integration code.

This is also the only stage that can be reached without asking a hospital to
change anything, which is why it is first.

## Stage 2 — One-way out

The system produces a summary document — PDF or a structured export — that
staff attach to the patient's record by the same route they already use for
outside documents.

Still no inbound connection, so the hospital's risk is unchanged. But the
result now lives where clinicians already look, which is the difference
between a pilot people remember to use and one they forget.

## Stage 3 — Patient demographics in

So a patient does not retype what the hospital already knows, and so results
can be matched to the right record reliably.

This happens through the interface layer the hospital's IT team already
operates — HL7 v2 messages through an engine such as Mirth Connect, or FHIR
where the hospital supports it — **never a direct database connection**. At
this stage the application itself very likely has to move inside the hospital
network or onto infrastructure their IT accepts.

## Stage 4 — Inside the perimeter

Running where clinical systems run. Here the question that decides everything
is: *does patient data leave the network to reach a language model?*

Two answers are acceptable, and no third one is:

- An enterprise endpoint with a contract, a chosen region, and terms that
  forbid training on submitted data — Claude via Amazon Bedrock, Gemini via
  Google Cloud Vertex AI, or equivalent.
- A model running on hospital infrastructure.

## What this project already did to make that possible

**The prompt carries no identifiers.** Not a name, not a hospital number, not
a date of birth — only an age band — and not the free text a patient typed,
because free text is where identifiers hide. An allowlist builds the payload;
a runtime guard checks the assembled payload against that patient's real
identifiers and refuses to send if anything matches.

This was written on day one of the AI work, when it cost an afternoon. The
reason it could not wait: you can rewrite a prompt at any time, but you can
never demonstrate afterwards that nothing identifying was sent *before* you
rewrote it. An IT reviewer asking "what leaves your network?" gets a short
answer and a test suite that proves it.

**One file talks to the model.** `src/services/ai/gemini.ts` holds every
provider detail. Moving to an enterprise endpoint is a change to that file,
not an audit of the application.

**The deterministic layer does not depend on the AI at all.** If a hospital
refuses outbound AI entirely, the scoring, the safety flags and the clinician
view keep working. The system degrades to a very good structured intake tool
rather than stopping.

## The paperwork, which is the long pole

Ethics committee approval for the pilot. PDPA consent wording and a data
processing agreement. An IT security review, which will want a written data
flow diagram more than it wants a demo. And — separately — licences for the
STOP-BANG and ESS item wording, which the code currently substitutes with
plain-language placeholders and flags in three places.

None of that is fast, and none of it is optional. It is also the part that
starts moving the day someone in a hospital wants this, which is what stages 1
and 2 exist to bring about.
