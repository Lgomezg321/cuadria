"use client";
import { Button } from "@/components/ui/button";

export function reloadPage() {
  window.location.reload();
}

function digestOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    return typeof digest === "string" ? digest : undefined;
  }
  return undefined;
}

/**
 * Neutral error screen: it never blames the user's connection or claims that
 * an operation was or was not saved, and always offers a full reload (which
 * also fixes a client left on an older deployment).
 */
export function ErrorView({
  error,
  retry,
  headingLevel = "h1",
}: {
  error: unknown;
  retry?: () => void;
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  const digest = digestOf(error);
  return (
    <div role="alert" className="max-w-xl">
      <Heading className="text-2xl font-semibold">
        No pudimos mostrar esta pantalla
      </Heading>
      <p className="my-5 text-stone-600">
        Puede ser un fallo temporal del servicio o que CUADRIA se haya
        actualizado mientras la tenías abierta. No se muestran saldos mientras
        no sea posible consultarlos. Si estabas registrando una operación,
        revisa el historial antes de repetirla.
      </p>
      <div className="flex flex-wrap gap-3">
        {retry && <Button onClick={() => retry()}>Volver a intentar</Button>}
        <Button variant="outline" onClick={reloadPage}>
          Recargar la página
        </Button>
      </div>
      {digest && (
        <p className="mt-5 text-xs text-stone-500">
          Código de referencia: <code>{digest}</code>
        </p>
      )}
    </div>
  );
}
