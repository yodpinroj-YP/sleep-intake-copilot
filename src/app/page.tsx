import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing page.
 *
 * This is the first thing anyone evaluating the project sees, so it names what
 * the system actually is rather than what it was scaffolded from, and offers a
 * way into the clinician view without an account — see /demo/clinician for why
 * that route exists.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Sleep Intake Copilot
        </h1>
        <p className="text-muted-foreground">
          ระบบซักประวัติการนอนหลับก่อนพบแพทย์ — ผู้ป่วยตอบแบบคัดกรองมาตรฐานจากที่บ้าน
          ระบบคำนวณคะแนนความเสี่ยงด้วยกฎตายตัวที่ตรวจสอบได้
          และส่งผลพร้อมสัญญาณเตือนให้แพทย์อ่านก่อนถึงเวลาตรวจ
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-5 text-sm">
        <p className="font-medium">หลักการที่ระบบนี้ยึด</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>
            คะแนนความเสี่ยงคำนวณด้วยกฎตายตัวฝั่งเซิร์ฟเวอร์ที่มีชุดทดสอบอัตโนมัติกำกับ —
            ไม่ใช่ AI และผู้ป่วยแก้คะแนนของตัวเองไม่ได้
          </li>
          <li>
            ข้อมูลที่ AI ร่างจะถูกเก็บแยกและอยู่ในสถานะรอตรวจสอบเสมอ
            จนกว่าแพทย์จะอนุมัติจึงจะเป็นส่วนหนึ่งของเวชระเบียน
          </li>
          <li>
            เมื่อข้อมูลไม่ครบ ระบบรายงานว่าคะแนนที่ได้เป็นค่าต่ำสุด ไม่ใช่ข้อสรุป
          </li>
          <li>
            ทุกตารางในฐานข้อมูลเปิด Row Level Security ไม่มีข้อยกเว้น
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={user ? "/dashboard" : "/login"}>
            {user ? "ไปหน้าหลัก" : "เข้าสู่ระบบ"}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/demo/clinician">ดูตัวอย่างหน้าจอแพทย์</Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        หน้าตัวอย่างเปิดดูได้โดยไม่ต้องมีบัญชี ใช้ข้อมูลสมมุติทั้งหมด ·
        รายละเอียดสถาปัตยกรรมอยู่ใน README ของโปรเจกต์
      </p>
    </div>
  );
}
