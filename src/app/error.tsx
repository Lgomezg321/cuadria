"use client";
import { ErrorView } from "@/components/error-view";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main id="main" className="mx-auto max-w-xl p-10">
      <ErrorView error={error} retry={retry} />
    </main>
  );
}
