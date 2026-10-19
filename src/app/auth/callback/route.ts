import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/env";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const supabase = await createClient();
  let valid = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    valid = !error;
  } else if (token && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type,
    });
    valid = !error;
  }
  if (valid) {
    await supabase.rpc("accept_invitations");
    const next =
      type === "invite" ||
      type === "recovery" ||
      request.nextUrl.searchParams.get("next") === "/auth/password"
        ? "/auth/password"
        : "/panel";
    return NextResponse.redirect(new URL(next, appOrigin()), {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return NextResponse.redirect(new URL("/login?error=callback", appOrigin()), {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
