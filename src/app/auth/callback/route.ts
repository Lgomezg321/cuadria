import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/env";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const next =
        request.nextUrl.searchParams.get("next") === "/auth/password"
          ? "/auth/password"
          : "/panel";
      return NextResponse.redirect(new URL(next, appOrigin()));
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", appOrigin()));
}
