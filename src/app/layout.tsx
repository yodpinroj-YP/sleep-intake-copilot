import type { Metadata } from "next";
import "./globals.css";

/**
 * This metadata is what a browser tab shows, what a search engine indexes, and
 * what appears in the preview card when someone pastes the link into a chat or
 * an email — so it is the project's name in every context outside the page
 * itself, not just decoration.
 */
export const metadata: Metadata = {
  title: "Sleep Intake Copilot",
  description:
    "ระบบซักประวัติการนอนหลับก่อนพบแพทย์ — คัดกรองด้วยแบบประเมินมาตรฐาน คำนวณคะแนนความเสี่ยงด้วยกฎที่ตรวจสอบได้ และส่งผลให้แพทย์พิจารณาก่อนถึงเวลาตรวจ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // lang="th" — the patient-facing pages are in Thai, and this is what tells a
  // screen reader which language to pronounce and the browser how to hyphenate.
  return (
    <html lang="th" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
