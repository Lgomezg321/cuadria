import Link from "next/link";
import { headers } from "next/headers";
import { Brand } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Turnstile } from "@/components/turnstile";
import { login, recoverPassword } from "@/app/actions";
import { supabaseConfig, turnstileSiteKey } from "@/lib/env";

const loginErrors: Record<string, string> = {
  callback:
    "El enlace de acceso no es válido, ya se utilizó o venció. Solicita uno nuevo o pide que te reenvíen la invitación.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  const notice = typeof error === "string" ? loginErrors[error] : undefined;
  const siteKey = turnstileSiteKey();
  const nonce = siteKey
    ? ((await headers()).get("x-nonce") ?? undefined)
    : undefined;
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <Brand />
      <h1 className="mt-12 text-3xl font-semibold">Bienvenido a CUADRIA</h1>
      <p className="mt-3 mb-8 text-sm text-stone-500">
        Ingresa con el correo autorizado por tu empresa.
      </p>
      {notice && (
        <p
          role="alert"
          className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          {notice}
        </p>
      )}
      {!supabaseConfig() ? (
        <div className="card">
          <p className="mb-4 text-sm">
            Este entorno necesita una conexión con Supabase antes de iniciar
            sesión.
          </p>
          <Link className="text-emerald-800 underline" href="/configuracion">
            Ver configuración
          </Link>
        </div>
      ) : (
        <>
          <ActionForm action={login} submit="Ingresar">
            <Field
              label="Correo electrónico"
              name="email"
              type="email"
              autoComplete="username"
            />
            <Field
              label="Contraseña"
              name="password"
              type="password"
              autoComplete="current-password"
            />
            {siteKey && <Turnstile siteKey={siteKey} nonce={nonce} />}
          </ActionForm>
          <details className="mt-8 text-sm">
            <summary className="cursor-pointer text-stone-500">
              ¿Olvidaste tu contraseña?
            </summary>
            <div className="mt-4">
              <ActionForm action={recoverPassword} submit="Recuperar acceso">
                <Field
                  label="Correo electrónico"
                  name="email"
                  type="email"
                  autoComplete="email"
                />
                {siteKey && <Turnstile siteKey={siteKey} nonce={nonce} />}
              </ActionForm>
            </div>
          </details>
        </>
      )}
    </main>
  );
}
