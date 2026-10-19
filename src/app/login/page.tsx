import Link from "next/link";
import { Brand } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { login, recoverPassword } from "@/app/actions";
import { supabaseConfig } from "@/lib/env";
export default function Login() {
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <Brand />
      <h1 className="mt-12 text-3xl font-semibold">Bienvenido a CUADRIA</h1>
      <p className="mt-3 mb-8 text-sm text-stone-500">
        Ingresa con el correo autorizado por tu empresa.
      </p>
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
            <Field label="Correo electrónico" name="email" type="email" />
            <Field label="Contraseña" name="password" type="password" />
          </ActionForm>
          <details className="mt-8 text-sm">
            <summary className="cursor-pointer text-stone-500">
              ¿Olvidaste tu contraseña?
            </summary>
            <div className="mt-4">
              <ActionForm action={recoverPassword} submit="Recuperar acceso">
                <Field label="Correo electrónico" name="email" type="email" />
              </ActionForm>
            </div>
          </details>
        </>
      )}
    </main>
  );
}
