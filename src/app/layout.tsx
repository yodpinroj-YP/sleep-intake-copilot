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
      {/*
        suppressHydrationWarning is on <body> and nowhere else, on purpose.

        Browser extensions — Grammarly is the usual culprit, adding
        data-gr-ext-installed and data-new-gr-c-s-check-loaded — modify <body>
        before React hydrates, so the markup React finds no longer matches what
        the server sent. React reports that as a hydration error even though
        nothing in this codebase is wrong, and the noise trains you to ignore
        the console, which is where the real bugs appear.

        This suppresses the warning for THIS element's own attributes only. It
        does not extend to children, so a genuine hydration mismatch anywhere
        inside the app still surfaces normally.
      */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
