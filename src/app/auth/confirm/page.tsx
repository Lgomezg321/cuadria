import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Brand } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { currentUserEmail } from "@/lib/auth";
import { parsePending, PENDING_COOKIE } from "@/lib/auth-flow";
import { confirmAuthLink } from "./actions";

export const metadata: Metadata = {
  title: "Confirmar acceso",
  referrer: "no-referrer",
};

const copy = {
  invite: {
    title: "Aceptar invitación",
    text: "Confirma para activar tu acceso a CUADRIA. Después definirás tu contraseña.",
  },
  recovery: {
    title: "Recuperar acceso",
    text: "Confirma para continuar con la recuperación. Después definirás una contraseña nueva.",
  },
  code: {
    title: "Confirmar acceso",
    text: "Confirma para continuar con el enlace que recibiste por correo.",
  },
};

export default async function ConfirmPage() {
  const pending = parsePending((await cookies()).get(PENDING_COOKIE)?.value);
  if (!pending)
    return (
      <main id="main" className="mx-auto max-w-md px-6 py-16">
        <Brand />
        <h1 className="mt-12 text-2xl font-semibold">Enlace no disponible</h1>
        <p className="mt-3 mb-8 text-sm text-stone-600">
          El enlace no es válido, ya se utilizó o venció. Solicita uno nuevo
          desde la pantalla de ingreso o pide una nueva invitación.
        </p>
        <Link className="text-emerald-800 underline" href="/login">
          Ir al ingreso
        </Link>
      </main>
    );
  const { title, text } = copy[pending.kind === "otp" ? pending.type : "code"];
  const signedInAs = await currentUserEmail();
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <Brand />
      <h1 className="mt-12 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 mb-6 text-sm text-stone-600">{text}</p>
      {signedInAs && (
        <p
          role="note"
          className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          Hay una sesión abierta como <strong>{signedInAs}</strong>. Si el
          enlace pertenece a otra cuenta, al continuar se cerrará esa sesión y
          se abrirá la cuenta del enlace. Si no esperabas este correo, no
          continúes.
        </p>
      )}
      <ActionForm
        action={confirmAuthLink}
        submit={
          signedInAs ? "Cerrar la sesión actual y continuar" : "Continuar"
        }
      >
        <p className="text-xs text-stone-500">
          El enlace solo se utiliza cuando pulsas el botón.
        </p>
      </ActionForm>
    </main>
  );
}
