import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Next.js + Supabase + AI starter</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Auth via Supabase, Postgres with RLS, an AI service kept server-side,
        and a reviewable output workflow — see the README for the full
        architecture.
      </p>
      <Button asChild>
        <Link href={user ? "/dashboard" : "/login"}>
          {user ? "Go to dashboard" : "Sign in"}
        </Link>
      </Button>
    </div>
  );
}
