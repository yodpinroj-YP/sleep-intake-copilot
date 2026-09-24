/**
 * Lists the models this API key can actually use.
 *
 * Run with:  npm run check:ai:models
 *
 * Written the day the primary model answered HTTP 503 "experiencing high
 * demand". A free tier that can refuse service is fine while building and
 * unacceptable during a five-minute demo in front of judges, so the system
 * needs a second model to fall back to — and picking one by guessing names
 * from documentation is how you end up with the 404 we already hit once.
 *
 * This asks the provider directly, and prints only the models that support
 * the call this application makes.
 */

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("✗ GEMINI_API_KEY ไม่พบใน .env.local");
  process.exit(1);
}

const response = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
  { headers: { "x-goog-api-key": apiKey } }
).catch((err) => {
  console.error("✗ ติดต่อเซิร์ฟเวอร์ไม่ได้:", err.message);
  process.exit(1);
});

if (!response.ok) {
  console.error(`✗ เซิร์ฟเวอร์ปฏิเสธ (HTTP ${response.status})`);
  console.error((await response.text().catch(() => "")).slice(0, 500));
  process.exit(1);
}

const payload = await response.json();
const models = Array.isArray(payload?.models) ? payload.models : [];

const usable = models.filter((m) =>
  Array.isArray(m.supportedGenerationMethods)
    ? m.supportedGenerationMethods.includes("generateContent")
    : true
);

if (usable.length === 0) {
  console.error("✗ ไม่พบ model ที่ใช้กับ generateContent ได้เลย");
  process.exit(1);
}

/**
 * Models that answer with text, which is the only thing this application asks
 * for. The account also has speech, image, robotics and computer-use models;
 * printing all of them buries the three or four names that matter under a list
 * nobody reads to the end — which is exactly what happened the first time.
 */
const NOT_TEXT = /tts|image|imagen|veo|embedding|aqa|robotics|computer-use|audio|live|native-audio/i;

const names = usable
  .map((m) => String(m.name ?? "").replace(/^models\//, ""))
  .filter((name) => name.length > 0);

const textModels = names.filter((name) => !NOT_TEXT.test(name)).sort();

console.log(`พบ ${names.length} model ทั้งหมด — เป็นรุ่นที่ตอบเป็นข้อความ ${textModels.length} รุ่น\n`);

console.log("=== รุ่นที่ใช้กับงานนี้ได้ (คัดมาแล้ว) ===");
for (const name of textModels) {
  console.log(`  ${name}`);
}

console.log("\n=== รุ่นอื่นทั้งหมด (เสียง ภาพ หุ่นยนต์ ฯลฯ — ไม่เกี่ยวกับงานนี้) ===");
for (const name of names.filter((n) => NOT_TEXT.test(n)).sort()) {
  console.log(`  ${name}`);
}

console.log(
  "\nถ้าจะเปลี่ยนรุ่นหลัก ให้ใส่ชื่อจากรายการแรกในไฟล์ .env.local เป็น GEMINI_MODEL=..."
);
console.log("ถ้าจะตั้งรุ่นสำรอง ให้ใส่ GEMINI_FALLBACK_MODEL=... (คนละรุ่นกับรุ่นหลัก)");
