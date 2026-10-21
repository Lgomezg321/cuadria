"use client";
import "./globals.css";
import { ErrorView } from "@/components/error-view";

// Replaces the root layout when it fails, so it defines <html> and <body>.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="es-CO">
      <body>
        <main id="main" className="mx-auto max-w-xl p-10">
          <ErrorView error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
