"use client";

import Link from "next/link";
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
import { Input } from "@/components/ui/input";
import type { IntakeStatus } from "@/types/database.types";

interface IntakeSession {
  id: string;
  status: IntakeStatus;
  chief_complaint: string | null;
  created_at: string;
}

const statusVariant: Record<IntakeStatus, "secondary" | "default" | "outline"> = {
  not_started: "outline",
  in_progress: "secondary",
  completed: "default",
  abandoned: "outline",
};

// Only sessions in these statuses can be edited/deleted (must match the
// RLS policies in 0001_init.sql / 0002_intake_session_delete_policy.sql).
const EDITABLE_STATUSES: IntakeStatus[] = ["not_started", "in_progress"];

/**
 * Patient-facing panel: lists the signed-in patient's intake sessions,
 * lets them start a new one (Create), edit the chief complaint on an
 * open one (Update), and delete an open one (Delete) — full CRUD against
 * /api/intake-sessions.
 */
export function IntakeSessionsPanel({ initialSessions }: { initialSessions: IntakeSession[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftComplaint, setDraftComplaint] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleStartSession() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/intake-sessions", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Failed to start a new session");
        return;
      }

      setSessions((prev) => [json.session, ...prev]);
    });
  }

  function startEditing(session: IntakeSession) {
    setEditingId(session.id);
    setDraftComplaint(session.chief_complaint ?? "");
  }

  function handleSaveComplaint(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chiefComplaint: draftComplaint }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Failed to save changes");
        return;
      }

      setSessions((prev) => prev.map((s) => (s.id === id ? json.session : s)));
      setEditingId(null);
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/intake-sessions/${id}`, { method: "DELETE" });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Failed to delete session");
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== id));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your intake sessions</CardTitle>
        <CardDescription>
          Each session collects your answers, then a clinician reviews an
          AI-drafted summary before it becomes part of your record.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button onClick={handleStartSession} disabled={isPending} className="w-fit">
          Start new intake session
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-col gap-3">
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No intake sessions yet. Click &ldquo;Start new intake session&rdquo; to
              begin.
            </p>
          )}
          {sessions.map((session) => {
            const canEdit = EDITABLE_STATUSES.includes(session.status);
            const isEditing = editingId === session.id;

            return (
              <Card key={session.id} className="bg-muted/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm">
                      {isEditing ? (
                        <Input
                          value={draftComplaint}
                          onChange={(e) => setDraftComplaint(e.target.value)}
                          placeholder="Chief complaint"
                          disabled={isPending}
                        />
                      ) : (
                        session.chief_complaint ?? "No chief complaint recorded yet"
                      )}
                    </CardTitle>
                    <Badge variant={statusVariant[session.status]}>
                      {session.status.replace("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Started {new Date(session.created_at).toLocaleString()}
                </CardContent>
                {canEdit && (
                  <CardFooter className="gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleSaveComplaint(session.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" asChild>
                          {/*
                            Named for the page, not for one questionnaire on
                            it. This used to read "ทำแบบสอบถาม STOP-BANG",
                            which became a lie the moment ESS was added to the
                            same page — a patient reading it would have no
                            reason to believe the sleepiness questionnaire was
                            behind this button, and would never scroll to find
                            it.
                          */}
                          <Link href={`/intake/${session.id}`}>
                            ทำแบบสอบถาม
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => startEditing(session)}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleDelete(session.id)}
                    >
                      Delete
                    </Button>
                  </CardFooter>
                )}
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
