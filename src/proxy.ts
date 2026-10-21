import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  hstsEnabled,
  secureCookies,
  supabaseConfig,
  turnstileSiteKey,
} from "@/lib/env";
import {
  buildContentSecurityPolicy,
  generateNonce,
  HSTS_VALUE,
} from "@/lib/security-headers";

const SESSION_PREFIXES = [
  "/panel",
  "/comprobantes",
  "/reportes",
  "/borradores",
  "/cierres",
  "/empresas",
  "/fondos",
  "/movimientos",
  "/auditoria",
  "/login",
  "/auth",
];

function needsSession(pathname: string): boolean {
  return SESSION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  const nonce = generateNonce();
  const secure = secureCookies();
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: config?.url,
    turnstile: !!turnstileSiteKey(),
    development: process.env.NODE_ENV === "development",
    upgradeInsecureRequests: secure,
  });
  // Rebuilt after every cookie refresh so rendering sees the new cookies,
  // the nonce and the CSP (Next.js reads the nonce from this request header).
  const forwardedHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };
  let response = NextResponse.next({
    request: { headers: forwardedHeaders() },
  });
  if (config && needsSession(request.nextUrl.pathname)) {
    const hardened = {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax" as const,
    };
    const supabase = createServerClient(config.url, config.key, {
      cookieOptions: hardened,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(items) {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request: { headers: forwardedHeaders() },
          });
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...hardened }),
          );
        },
      },
    });
    await supabase.auth.getClaims();
    response.headers.set("Cache-Control", "private, no-store");
  }
  response.headers.set("Content-Security-Policy", csp);
  if (hstsEnabled())
    response.headers.set("Strict-Transport-Security", HSTS_VALUE);
  return response;
}

export const config = {
  matcher: [
    // Every page and route handler gets a fresh nonce/CSP; static assets skip the proxy.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
  ],
};
