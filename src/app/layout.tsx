import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "CUADRIA · Control financiero", template: "%s · CUADRIA" },
  description: "Administración y supervisión de fondos empresariales.",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nonce-based CSP (src/proxy.ts) requires per-request rendering everywhere.
  await connection();
  return (
    <html lang="es-CO">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
