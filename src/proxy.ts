import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/env";
export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  let response = NextResponse.next({ request });
  if (!config) return response;
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/panel/:path*",
    "/comprobantes/:path*",
    "/reportes/:path*",
    "/borradores/:path*",
    "/cierres/:path*",
    "/empresas/:path*",
    "/fondos/:path*",
    "/movimientos/:path*",
    "/auditoria/:path*",
    "/login",
    "/auth/:path*",
  ],
};
