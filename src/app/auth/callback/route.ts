import { type NextRequest, NextResponse } from "next/server";
import { appOrigin, secureCookies } from "@/lib/env";
import {
  AUTH_COOKIE_PATH,
  parseCallback,
  PENDING_COOKIE,
  PENDING_MAX_AGE,
  serializePending,
} from "@/lib/auth-flow";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

/**
 * Compatible with the e-mail templates that point here
 * (`/auth/callback?token_hash=…&type=invite|recovery&next=/auth/password`)
 * and with PKCE `?code=…`. A GET never consumes the token: e-mail link
 * scanners only reach the confirmation page, and the user confirms there
 * with a POST.
 */
export async function GET(request: NextRequest) {
  const pending = parseCallback(request.nextUrl.searchParams);
  if (!pending)
    return NextResponse.redirect(
      new URL("/login?error=callback", appOrigin()),
      {
        headers,
      },
    );
  const response = NextResponse.redirect(
    new URL("/auth/confirm", appOrigin()),
    {
      status: 303,
      headers,
    },
  );
  response.cookies.set(PENDING_COOKIE, serializePending(pending), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: AUTH_COOKIE_PATH,
    maxAge: PENDING_MAX_AGE,
  });
  return response;
}
