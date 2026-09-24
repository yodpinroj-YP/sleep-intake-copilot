/**
 * One-off credential and latency check.
 *
 * Run with:  npm run check:ai
 * Or with the real summary prompt:  npm run check:ai -- --full
 *
 * Proves three things before any application code depends on them: the key in
 * .env.local is real, the model name is one this account can actually use, and
 * the network path out of your machine to the provider is open. Each of those
 * fails differently, and finding out which one is broken from inside a Next.js
 * route — behind a form, a database write and a React error boundary — is far
 * harder than finding out here.
 *
 * `--full` exists because the short check answers "can we reach the model?"
 * but not "how long does OUR prompt take?", and those turned out to be very
 * different questions: the first live attempt was cancelled by a 20-second
 * timeout that the one-word test had sailed through.
 *
 * It repeats the request shape from services/ai/gemini.ts rather than
 * importing it, because that file starts with `import "server-only"` — the
 * guard that stops a stray client component from pulling the API key into the
 * browser bundle. The prompt itself IS imported, since it is pure.
 */

import { SYSTEM_PROMPT, buildUserPrompt } from "../src/services/ai/summary-prompt.ts";

const full = process.argv.includes("--full");

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

if (!apiKey) {
  console.error("✗ GEMINI_API_KEY ไม่พบ");
  console.error("  ตรวจว่าไฟล์ .env.local มีบรรทัด GEMINI_API_KEY=... อยู่จริง");
  process.exit(1);
}

/** A de-identified case, shaped exactly like what the real service sends. */
const SAMPLE_INPUT = {
  ageBand: "50_59",
  sex: "male",
  bmi: 36.2,
  neckCircumferenceCm: 43.2,
  stopBang: {
    score: 6,
    maxPossibleScore: 6,
    incomplete: false,
    answeredCount: 8,
    riskCategory: "high",
    items: [
      { letter: "S", label: "Snoring", scored: true, answered: true },
      { letter: "T", label: "Tired", scored: true, answered: true },
      { letter: "O", label: "Observed apnea", scored: true, answered: true },
      { letter: "P", label: "High blood pressure", scored: true, answered: true },
      { letter: "B", label: "BMI > 35", scored: true, answered: true },
      { letter: "A", label: "Age > 50", scored: true, answered: true },
      { letter: "N", label: "Neck > 40 cm", scored: false, answered: true },
      { letter: "G", label: "Male", scored: false, answered: true },
    ],
  },
  ess: {
    score: 14,
    maxPossibleScore: 20,
    incomplete: true,
    answeredCount: 6,
    severity: "moderate",
    items: [
      { position: 1, label: "Sitting and reading", score: 3, answered: true },
      { position: 8, label: "Stopped in traffic", score: 2, answered: true },
    ],
  },
  flags: [
    {
      type: "high_osa_risk",
      severity: "standard",
      reason: "STOP-BANG score 6/8 (cut-off 5)",
    },
  ],
};

/**
 * The configurations to try, in order, stopping at the first that produces
 * text.
 *
 * An empty reply from a reasoning model usually means the output budget was
 * spent on thinking before the answer began, so each attempt loosens one
 * constraint at a time. Trying them here rather than editing the application
 * between runs means one command tells us which settings the service should
 * actually use, instead of a sequence of guesses.
 */
const ATTEMPTS = full
  ? [
      { label: "ตั้งค่าปัจจุบันของระบบ (JSON, 8192 token)", maxOutputTokens: 8192, json: true },
      { label: "เพิ่มโควต้าเป็น 16384 token", maxOutputTokens: 16384, json: true },
      { label: "เพิ่มโควต้า และไม่บังคับ JSON", maxOutputTokens: 16384, json: false },
    ]
  : [{ label: "ทดสอบสั้น", maxOutputTokens: 40, json: false, short: true }];

function buildBody(attempt) {
  if (attempt.short) {
    return {
      contents: [
        { role: "user", parts: [{ text: "ตอบกลับสั้น ๆ คำเดียวว่า: พร้อม" }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: attempt.maxOutputTokens },
    };
  }

  return {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(SAMPLE_INPUT) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: attempt.maxOutputTokens,
      ...(attempt.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

console.log(`กำลังทดสอบ model: ${model}`);
console.log(`ความยาว key ที่อ่านได้: ${apiKey.length} ตัวอักษร`);
console.log(full ? "โหมด: prompt จริงของระบบ" : "โหมด: ทดสอบสั้น (ใช้ npm run check:ai:full เพื่อทดสอบ prompt จริง)");

let succeeded = false;

for (const attempt of ATTEMPTS) {
  console.log(`\n▶ ลอง: ${attempt.label}`);

  const startedAt = Date.now();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildBody(attempt)),
    }
  ).catch((err) => {
    console.error("✗ ติดต่อเซิร์ฟเวอร์ไม่ได้เลย:", err.message);
    console.error("  แปลว่าปัญหาอยู่ที่เครือข่าย ไม่ใช่ที่ key");
    process.exit(1);
  });

  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`✗ เซิร์ฟเวอร์ปฏิเสธ (HTTP ${response.status}) หลัง ${elapsedMs} ms`);
    console.error(errorText.slice(0, 500));

    if (response.status === 400 || response.status === 403) {
      console.error("  สถานะนี้มักแปลว่า key ไม่ถูกต้อง หรือยังไม่ได้เปิดใช้ Generative Language API");
    }
    if (response.status === 404) {
      console.error(`  ไม่มี model ชื่อ "${model}" สำหรับบัญชีนี้ — กำหนด GEMINI_MODEL ใน .env.local`);
    }
    if (response.status === 429) {
      console.error("  ใช้เกินโควต้าชั้นฟรีชั่วคราว รอสักครู่แล้วลองใหม่");
    }
    continue;
  }

  const payload = await response.json();
  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage = payload?.usageMetadata ?? {};

  console.log(`  เวลา ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(1)} วินาที)`);
  console.log(
    `  token — prompt ${usage.promptTokenCount ?? "?"} / คิด ${
      usage.thoughtsTokenCount ?? 0
    } / คำตอบ ${usage.candidatesTokenCount ?? "?"} / รวม ${usage.totalTokenCount ?? "?"}`
  );
  console.log(`  เหตุผลที่หยุด: ${candidate?.finishReason ?? "ไม่ระบุ"}`);

  // MAX_TOKENS means the reply was cut off mid-sentence. It is not a success
  // just because some text came back — a half-written clinical summary is the
  // most dangerous of the three possible outcomes, because it looks fine.
  if (candidate?.finishReason === "MAX_TOKENS") {
    console.warn("  ✗ คำตอบถูกตัดกลางคัน (โควต้าหมด) — ลองการตั้งค่าถัดไป");
    continue;
  }

  if (!text.trim()) {
    console.warn("  ✗ คำตอบว่าง");
    continue;
  }

  if (elapsedMs > 45_000) {
    console.warn("  ⚠ ช้ากว่า 45 วินาที ใกล้เพดานเวลาที่ระบบตั้งไว้ (60 วินาที)");
  }

  console.log("\n✓ ได้คำตอบแล้วด้วยการตั้งค่านี้");
  console.log("--- คำตอบจากโมเดล ---");
  console.log(text.trim());

  succeeded = true;
  break;
}

if (!succeeded) {
  console.error("\n✗ ไม่มีการตั้งค่าใดที่ได้คำตอบกลับมา — ส่งผลทั้งหมดนี้ให้ผู้ช่วยดู");
  process.exit(1);
}
