"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  confirmReceiptUpload,
  reserveReceiptUpload,
} from "@/app/receipt-actions";
import {
  detectReceiptMime,
  isReceiptMime,
  validateDeclaredReceipt,
  type ReceiptMime,
} from "@/lib/domain/receipt";

type Phase =
  "idle" | "checking" | "reserving" | "uploading" | "verifying" | "done";
const phaseLabels: Record<Exclude<Phase, "idle" | "done">, string> = {
  checking: "Revisando el archivo…",
  reserving: "Preparando la carga privada…",
  uploading: "Subiendo al almacenamiento privado…",
  verifying: "Verificando el comprobante…",
};
const CONNECTION_ERROR =
  "No fue posible comunicarse con el servidor. Recarga la página y vuelve a intentarlo; el movimiento sigue registrado.";
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

// Direct browser → Storage upload with the signed token. The Server Action never
// receives the file. XMLHttpRequest is used because fetch has no upload progress.
function uploadToStorage(
  url: string,
  file: File,
  mime: ReceiptMime,
  onProgress: (percent: number) => void,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("content-type", mime);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) xhr.setRequestHeader("apikey", key);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => resolve({ status: 0, body: "" });
    xhr.ontimeout = () => resolve({ status: 0, body: "" });
    xhr.send(file);
  });
}

async function sniff(file: File): Promise<ReceiptMime | null> {
  try {
    return detectReceiptMime(
      new Uint8Array(await file.slice(0, 16).arrayBuffer()),
    );
  } catch {
    return null;
  }
}

export function ReceiptUpload({
  movements,
}: {
  movements: { id: string; name: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  // One idempotency key per (movement, file) so a retry reuses the reservation.
  const keys = useRef(new Map<string, string>());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const busy = phase !== "idle" && phase !== "done";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setSuccess(null);
    setProgress(0);
    const data = new FormData(event.currentTarget);
    const movement = String(data.get("movement") ?? "");
    const file = data.get("receipt");
    if (!movement || !(file instanceof File) || file.size === 0) {
      setError("Selecciona el movimiento y un comprobante.");
      return;
    }
    setPhase("checking");
    const detected = await sniff(file);
    const declaredMime = isReceiptMime(file.type) ? file.type : detected;
    const declared = validateDeclaredReceipt({
      name: file.name,
      mime: declaredMime ?? file.type,
      size: file.size,
    });
    if (!declared.ok) return fail(declared.error);
    if (detected !== declared.value.mime)
      return fail(
        "El contenido del archivo no corresponde a una imagen JPG, PNG o un PDF válido.",
      );
    const identity = [movement, file.name, file.size, file.lastModified].join(
      "|",
    );
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    try {
      setPhase("reserving");
      const reserved = await reserveReceiptUpload({
        movement,
        key,
        ...declared.value,
      });
      if ("error" in reserved) {
        if (reserved.renewKey) keys.current.delete(identity);
        return fail(reserved.error);
      }
      if (reserved.state === "upload") {
        setPhase("uploading");
        const result = await uploadToStorage(
          reserved.signedUrl,
          file,
          reserved.mime,
          setProgress,
        );
        const duplicate =
          (result.status === 400 || result.status === 409) &&
          /duplicate|already exists/i.test(result.body);
        if ((result.status < 200 || result.status >= 300) && !duplicate)
          return fail(
            result.status === 413
              ? "El archivo supera el tamaño permitido por el almacenamiento (10 MB)."
              : result.status === 0
                ? "Se interrumpió la conexión durante la carga. Vuelve a intentarlo; el movimiento sigue registrado."
                : `El almacenamiento rechazó la carga (código ${result.status}). Vuelve a intentarlo; el movimiento sigue registrado.`,
          );
        setProgress(100);
      }
      if (reserved.state !== "verified") {
        setPhase("verifying");
        const confirmed = await confirmReceiptUpload(reserved.receiptId);
        if ("error" in confirmed) {
          if (!confirmed.retry) keys.current.delete(identity);
          return fail(confirmed.error);
        }
      }
      keys.current.delete(identity);
      setPhase("done");
      setSuccess(
        "Comprobante verificado y guardado en almacenamiento privado.",
      );
      form.current?.reset();
      router.refresh();
    } catch {
      fail(CONNECTION_ERROR);
    }
  }

  function fail(message: string) {
    setPhase("idle");
    setError(message);
  }

  return (
    <form ref={form} onSubmit={submit} className="space-y-4" noValidate>
      <label className="field">
        Movimiento
        <select name="movement" required defaultValue="" disabled={busy}>
          <option value="">Selecciona una opción</option>
          {movements.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Comprobante JPG, PNG o PDF · máximo 10 MB
        <input
          type="file"
          name="receipt"
          accept="image/jpeg,image/png,application/pdf"
          required
          disabled={busy}
        />
      </label>
      {busy && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p className="text-stone-700">
            {phaseLabels[phase as keyof typeof phaseLabels]}
          </p>
          {phase === "uploading" && (
            <progress
              className="h-2 w-full"
              max={100}
              value={progress}
              aria-label={`Carga del comprobante: ${progress}%`}
            />
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {success}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? "Procesando…" : "Cargar comprobante"}
      </Button>
      <p className="text-xs leading-5 text-stone-500">
        El archivo se envía directamente al almacenamiento privado y solo cuenta
        como comprobante después de verificar su contenido.
      </p>
    </form>
  );
}
