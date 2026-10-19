import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "CUADRIA · Control financiero", template: "%s · CUADRIA" },
  description: "Administración y supervisión de fondos empresariales.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
