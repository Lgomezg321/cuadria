import type { Metadata } from "next";
import { headers } from "next/headers";
import { inRecoveryMode, requireUser } from "@/lib/auth";
import { ActionForm, Field } from "@/components/action-form";
import { Turnstile } from "@/components/turnstile";
import { changePassword } from "@/app/actions";
import { turnstileSiteKey } from "@/lib/env";

export const metadata: Metadata = {
  title: "Actualizar contraseña",
  referrer: "no-referrer",
};

export default async function Password() {
  const { supabase, user } = await requireUser();
  const recovery = await inRecoveryMode(supabase);
  const siteKey = turnstileSiteKey();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold">Actualizar contraseña</h1>
      <p className="mb-8 text-sm text-stone-600">
        {recovery
          ? "Define la contraseña de tu cuenta. Al guardarla se cerrarán las demás sesiones abiertas."
          : "Por seguridad, confirma tu contraseña actual. Al guardar se cerrarán las demás sesiones abiertas."}
      </p>
      <ActionForm action={changePassword} submit="Actualizar">
        {/* Lets password managers associate the new password with the account. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={user.email ?? ""}
          readOnly
          hidden
        />
        {!recovery && (
          <Field
            label="Contraseña actual"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
          />
        )}
        <Field
          label="Nueva contraseña (mínimo 12 caracteres)"
          name="password"
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
        <Field
          label="Repite la nueva contraseña"
          name="confirmPassword"
          type="password"
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
        />
        {!recovery && siteKey && <Turnstile siteKey={siteKey} nonce={nonce} />}
      </ActionForm>
    </main>
  );
}
