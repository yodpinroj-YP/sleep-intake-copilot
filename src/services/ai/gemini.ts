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
 * Hard ceiling on one request.
 *
 * This started at 20 seconds, which was wrong: the current generation of
 * "flash" models spends time reasoning before it emits anything, and a real
 * summary prompt is far longer than a test one. The first live attempt was
 * cancelled by this timer rather than by anything the provider did.
 *
 * 60 seconds is chosen to match the ceiling the hosting platform allows a
 * server function to run for — a timeout shorter than the platform's gives a
 * clear error message, while one longer than it would let the platform kill
 * the request first and leave the user staring at a blank failure.
 */
const REQUEST_TIMEOUT_MS = 60_000;

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

/** Which failures are worth one more attempt. */
function isTransient(status: number): boolean {
  // 429 = rate limited, 5xx = the provider's problem, not ours. A free tier
  // hits 429 exactly when several people demo at once, which is the worst
  // possible moment for it to be fatal.
  return status === 429 || status >= 500;
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
  options: GenerateTextOptions
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
  const candidates =
    fallback && fallback !== primary ? [primary, fallback] : [primary];

  let model = primary;
  let response: Response;

  try {
    response = await callOnce(model, apiKey, options);

    if (!response.ok && isTransient(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      response = await callOnce(model, apiKey, options);
    }

    // Still refusing after a retry — try the next model rather than give up.
    for (const next of candidates.slice(1)) {
      if (response.ok || !isTransient(response.status)) break;

      console.warn(
        `[ai] ${model} ตอบ ${response.status} — กำลังลองรุ่นสำรอง ${next}`
      );
      model = next;
      response = await callOnce(model, apiKey, options);
    }
  } catch (err) {
    // AbortError on timeout, or a network failure. Neither carries anything
    // useful for a clinician, so the message is about the system, not the case.
    const aborted = err instanceof Error && err.name === "AbortError";

    throw new AiRequestError(
      aborted
        ? `บริการ AI ใช้เวลานานเกิน ${REQUEST_TIMEOUT_MS / 1000} วินาที จึงยกเลิกคำขอ — ลองใหม่อีกครั้ง`
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
    throw new AiRequestError(
      `บริการ AI ตอบกลับด้วยสถานะ ${response.status}: ${body}`,
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
