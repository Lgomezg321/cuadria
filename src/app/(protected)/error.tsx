"use client";
import { ErrorView } from "@/components/error-view";

// Rendered inside the protected layout, so the navigation stays available.
export default function ProtectedError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <section className="py-6">
      <ErrorView error={error} retry={retry} headingLevel="h2" />
    </section>
  );
}
