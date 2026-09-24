"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Asks the AI service for a draft summary of one session.
 *
 * A clinician presses this; nothing generates automatically. That is a
 * deliberate choice rather than a missing feature — generating on submission
 * would fill the review queue with drafts nobody asked for, spend quota on
 * cases no clinician will open today, and quietly make the AI a step in the
 * pipeline rather than a tool someone chose to use.
 *
 * The draft that comes back is not shown here. It lands in the review queue
 * below, where approving it is a separate, recorded decision — so the person
 * who asks for a summary and the person who accepts it into the record are
 * doing two visibly different things, even when they are the same person.
 */
export function GenerateSummaryButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);

    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${sessionId}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "สร้างร่างสรุปไม่สำเร็จ");
        return;
      }

      setDone(true);
      // Pulls the new draft into the review queue further down the page.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={isPending || done}
        >
          {isPending
            ? "กำลังให้ AI ร่าง..."
            : done
              ? "ร่างแล้ว — ดูในคิวรอตรวจด้านล่าง"
              : "ให้ AI ร่างสรุป"}
        </Button>

        {/* A reasoning model can take most of a minute. Without this, a user
            who sees nothing happen for 30 seconds assumes it is broken and
            clicks again — which the server then has to refuse. */}
        {isPending && (
          <span className="text-xs text-muted-foreground">
            อาจใช้เวลาถึงหนึ่งนาที กรุณารอ
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
