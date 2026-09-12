"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ReviewStatus } from "@/types/database.types";

interface ClinicianSummary {
  id: string;
  session_id: string;
  version: number;
  summary_text: string;
  model: string;
  status: ReviewStatus;
  created_at: string;
}

/**
 * Clinician-facing panel: lists AI-generated summaries still waiting for
 * a human decision, and lets a clinician approve or reject each one.
 * A summary is never treated as final until this happens ("Keep AI
 * output reviewable").
 */
export function ClinicianReviewPanel({
  initialSummaries,
}: {
  initialSummaries: ClinicianSummary[];
}) {
  const [summaries, setSummaries] = useState(initialSummaries);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleReview(id: string, decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/clinician-summaries/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Review failed");
        return;
      }

      // Reviewed summaries drop off the pending list.
      setSummaries((prev) => prev.filter((s) => s.id !== id));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summaries pending your review</CardTitle>
        <CardDescription>
          These were drafted by the AI service and must be approved or
          rejected before they count as part of a patient&rsquo;s record.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {summaries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing waiting for review right now.
          </p>
        )}
        {summaries.map((summary) => (
          <Card key={summary.id} className="bg-muted/30">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  Session {summary.session_id.slice(0, 8)} · v{summary.version}
                </CardTitle>
                <Badge variant="secondary">{summary.status.replace("_", " ")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {summary.summary_text}
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => handleReview(summary.id, "approved")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => handleReview(summary.id, "rejected")}
              >
                Reject
              </Button>
            </CardFooter>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
