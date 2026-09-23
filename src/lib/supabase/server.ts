import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** User-scoped Supabase client: every query is authorized by RLS as the signed-in user. */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; the proxy refreshes sessions.
          }
        },
      },
    },
  );
}

export type Viewer = {
  userId: string;
  email: string | null;
  isGuest: boolean;
};

/** Verified identity from the JWT (getClaims validates the token signature). */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims as { sub: string; email?: string; app_metadata?: { cp_guest?: boolean } };
  return {
    userId: claims.sub,
    email: claims.email ?? null,
    isGuest: claims.app_metadata?.cp_guest === true,
  };
}
