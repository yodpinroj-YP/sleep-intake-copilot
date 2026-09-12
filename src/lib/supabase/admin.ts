import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Admin client using the SERVICE ROLE key. This bypasses Row Level
 * Security entirely, so it must only ever be imported from server-side
 * code (API routes, Server Actions) that itself enforces authorization.
 *
 * The `server-only` import above makes bundling this into a Client
 * Component a build-time error, so the service role key can never leak
 * to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
