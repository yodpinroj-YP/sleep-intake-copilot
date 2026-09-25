import "server-only";

/**
 * The only place in this codebase that talks to a language model.
 *
 * WHY IT IS ONE SMALL FILE
 *
 * The provider is a decision we expect to revisit. Today it is Google's free
 * tier, chosen because it needs no credit card; the day this system sees real
 * patients that tier has to go, because its terms allow prompts to be used for
 * product improvement. Keeping every provider detail — the URL, the request
 * shape, the response shape, the error handling — behind one function means
 * that migration is an afternoon's work on one file rather than an audit of
 * the whole application.
 *
 * It calls the REST endpoint with `fetch` rather than installing a vendor SDK.
 * An SDK would be one more dependency to keep current, one more thing that can
 * break a build the night before a deadline, and it would spread provider
 * concepts through the code the moment anyone imported its types.
 *
 * Nothing here knows what a patient is. It takes text and returns text; the
 * caller is responsible for making sure the text it hands over carries no
 * identifiers (see summary-input.ts).
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Both names are overridable by environment variable, but sensible defaults
 * live here on purpose: a deployment that forgets to set them still works,
 * which removes one of the two ways this project has broken in production
 * before (the other being a missing key).
 *
 * WHY THESE TWO, AND NOT THE NEWEST
 *
 * The newest model is the busiest. gemini-2.5-flash turned out to be closed to
 * new accounts, and gemini-3.6-flash answered HTTP 503 "experiencing high
 * demand" on every attempt across a whole evening. A demo happens at a fixed
 * time that cannot be moved to when a popular model is free.
 *
 * So the primary is a full `flash` model three releases behind the current
 * one — old enough that the crowd has moved on, capable enough to follow a
 * strict JSON structure, which smaller "lite" variants get wrong more often.
 *
 * The fallback is deliberately from a different generation rather than the
 * lite sibling of the primary: two models from one family tend to fail
 * together, and a fallback that fails with the primary is not a fallback.
 */
const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";

/**
 * Models to try after the first two, in order.
 *
 * One fallback turned out not to be enough: on a busy afternoon the primary
 * and its fallback both answered 503 within seconds of each other. Spreading
 * the attempts across generations and sizes makes it far less likely that a
 * single provider-side spike takes all of them out at once.
 *
 * Order matters — better model first, so a lighter one is used only when the
 * better ones are unavailable, never as the default.
 */
const EXTRA_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest"];

/**
 * Time budgets.
 *
 * THE MISTAKE THIS REPLACES, BECAUSE IT IS AN EASY ONE TO MAKE AGAIN
 *
 * The first version set a 60-second ceiling on ONE call, to match the 60
 * seconds the hosting platform allows a server function to run for. That
 * looked right and was wrong: this function can make up to three calls — the
 * first attempt, one retry, then the fallback model — so the real worst case
 * was three minutes against a sixty-second limit. When the primary model was
 * busy and hung, the platform killed the request before any of our own error
 * handling ran, and the browser got a bare 504 with no message in it.
 *
 * What has to fit inside the platform's limit is the TOTAL, not one attempt.
 * So a single deadline is set once, every attempt draws from what is left of
 * it, and an attempt that cannot fit is skipped rather than started.
 *
 * TOTAL_BUDGET_MS sits well under the platform ceiling to leave room for
 * reading the database, parsing the reply and writing the row afterwards.
 */
const TOTAL_BUDGET_MS = 42_000;

/** No single attempt may hold the whole budget; a hung call must not starve the rest. */
const ATTEMPT_TIMEOUT_MS = 15_000;

/** Below this much remaining, starting another attempt only wastes the wait. */
const MIN_ATTEMPT_MS = 4_000;

export class MissingAiKeyError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY is not set. Add it to .env.local (from aistudio.google.com) and restart the dev server."
    );
    this.name = "MissingAiKeyError";
  }
}

export class AiRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiRequestError";
    this.status = status;
  }
}

export interface GenerateTextOptions {
  /** Instructions about the model's role and constraints. */
  system: string;
  /** The data the model is asked to work from. */
  user: string;
  /**
   * Low by default. This task is summarising numbers that are already
   * correct, not writing prose — variation between runs is a liability here,
   * not a feature, because two clinicians reading the same case should see the
   * same summary.
   */
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Ask the provider to constrain the reply to JSON.
   *
   * This is a hint enforced by the provider, not a guarantee we rely on — the
   * caller still parses defensively (see summary-prompt.ts). It simply removes
   * the most common failure, which is a model that answers correctly and then
   * wraps it in a sentence of explanation.
   */
  json?: boolean;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  /** Token counts when the provider reports them — recorded for cost tracking. */
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Which failures are worth trying another model for. */
function shouldTryAnotherModel(status: number): boolean {
  // 429 = rate limited and 5xx = the provider's problem, not ours; a free tier
  // hits both exactly when several people demo at once, which is the worst
  // possible moment for either to be fatal.
  //
  // 404 is included for a different reason: it means this account cannot use
  // that model at all — a name the provider has retired or closed to new
  // users, which has already happened twice here. Retrying it is pointless,
  // but the next model in the chain may well work, so the chain continues
  // rather than stopping.
  return status === 404 || status === 429 || status >= 500;
}

/** A message a clinician can act on, instead of the provider's raw JSON. */
function describeFailure(status: number, body: string): string {
  if (status === 503 || status === 429) {
    return "ขณะนี้บริการ AI มีผู้ใช้งานหนาแน่นทุกรุ่นที่ระบบมี กรุณารอสักครู่แล้วกดใหม่อีกครั้ง — คะแนนและสัญญาณเตือนทั้งหมดคำนวณเสร็จแล้วและไม่ได้รับผลกระทบ";
  }

  // Anything else is a developer's problem, so it keeps the detail. The body
  // is truncated: a provider error can be long and occasionally echoes the
  // request back.
  return `บริการ AI ตอบกลับด้วยสถานะ ${status}: ${body.slice(0, 200)}`;
}

function extractText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";

  const parts = (
    candidates[0] as { content?: { parts?: unknown } } | undefined
  )?.content?.parts;

  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) =>
      typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("")
    .trim();
}

/** Why the model stopped — "STOP" is normal, "MAX_TOKENS" means truncated. */
function extractFinishReason(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const reason = (candidates[0] as { finishReason?: unknown } | undefined)
    ?.finishReason;

  return typeof reason === "string" ? reason : null;
}

function extractUsage(payload: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const usage =
    typeof payload === "object" && payload !== null
      ? (payload as { usageMetadata?: Record<string, unknown> }).usageMetadata
      : undefined;

  const read = (key: string) =>
    typeof usage?.[key] === "number" ? (usage[key] as number) : null;

  return {
    inputTokens: read("promptTokenCount"),
    outputTokens: read("candidatesTokenCount"),
  };
}

async function callOnce(
  model: string,
  apiKey: string,
  options: GenerateTextOptions,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The key travels in a header, not the query string: query strings end
        // up in server logs and proxy logs in a way headers usually do not.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: options.system }] },
        contents: [{ role: "user", parts: [{ text: options.user }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          // Generous on purpose. On a reasoning model this budget is shared
          // with the thinking the model does before answering, so a ceiling
          // tight enough to fit only the visible answer can starve the reply
          // and come back empty.
          maxOutputTokens: options.maxOutputTokens ?? 2_048,
          ...(options.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one prompt and returns the text that comes back.
 *
 * Throws rather than returning an empty string on failure: a caller that gets
 * "" back would happily save an empty summary and nobody would notice. Every
 * failure here is meant to surface.
 */
export async function generateText(
  options: GenerateTextOptions
): Promise<GenerateTextResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingAiKeyError();

  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // Falling back to a less fashionable model produces a slightly different
  // summary, which is a far better outcome than producing none.
  const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  // Deduplicated, so an env override that repeats a default doesn't spend an
  // attempt asking the same busy model twice.
  const candidates = [...new Set([primary, fallback, ...EXTRA_FALLBACK_MODELS])];

  // One deadline for everything this function does, set before the first call.
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  /** Runs one attempt inside whatever is left of the budget. */
  const attempt = (name: string) =>
    callOnce(name, apiKey, options, Math.min(ATTEMPT_TIMEOUT_MS, remaining()));

  let model = candidates[0];
  let response: Response;

  try {
    response = await attempt(model);

    // Walk the chain while the refusal is the kind another model might not
    // share, and only while enough of the budget is left for the attempt to
    // finish. Starting a call the platform will kill mid-flight produces no
    // answer AND no error message, which is the worst of both.
    //
    // There is no second attempt at the same model: with three models to try
    // and room for about three attempts, asking a busy model twice spends an
    // attempt on the one endpoint already known to be refusing.
    for (const next of candidates.slice(1)) {
      if (response.ok || !shouldTryAnotherModel(response.status)) break;
      if (remaining() < MIN_ATTEMPT_MS) break;

      console.warn(
        `[ai] ${model} ตอบ ${response.status} — กำลังลองรุ่นถัดไป ${next}`
      );
      model = next;
      response = await attempt(model);
    }
  } catch (err) {
    // AbortError on timeout, or a network failure. Neither carries anything
    // useful for a clinician, so the message is about the system, not the case.
    const aborted = err instanceof Error && err.name === "AbortError";

    throw new AiRequestError(
      aborted
        ? `บริการ AI ใช้เวลานานเกิน ${TOTAL_BUDGET_MS / 1000} วินาที จึงยกเลิกคำขอ — ลองใหม่อีกครั้ง`
        : `ไม่สามารถติดต่อบริการ AI ได้: ${
            err instanceof Error ? err.message : "unknown error"
          }`
    );
  }

  if (!response.ok) {
    // The provider's error body can be long and occasionally echoes the
    // request, so only a short prefix is kept — enough to debug, not enough to
    // turn an error log into a copy of the prompt.
    const body = (await response.text().catch(() => "")).slice(0, 300);

    console.error(
      `[ai] ทุกรุ่นถูกปฏิเสธ รุ่นสุดท้ายคือ ${model} สถานะ ${response.status}`
    );

    throw new AiRequestError(
      describeFailure(response.status, body),
      response.status
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  const text = extractText(payload);
  const finishReason = extractFinishReason(payload);

  // A truncated reply is worse than no reply. It arrives looking like a
  // success, parses far enough to seem plausible, and would put half a
  // sentence about a patient into a clinician's review queue. Refuse it.
  if (finishReason === "MAX_TOKENS") {
    throw new AiRequestError(
      "คำตอบจาก AI ถูกตัดกลางคันเพราะเกินโควต้าที่ตั้งไว้ — ไม่บันทึกผลที่ไม่สมบูรณ์"
    );
  }

  if (!text) {
    // A 200 with no usable text usually means the model stopped for a safety
    // or length reason. Treating it as success would store a blank summary.
    throw new AiRequestError("บริการ AI ตอบกลับโดยไม่มีเนื้อหา");
  }

  return { text, model, ...extractUsage(payload) };
}
