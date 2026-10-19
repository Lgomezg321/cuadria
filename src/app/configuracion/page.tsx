import Link from "next/link";
import { Shell, PageHeader } from "@/components/shell";
import { supabaseConfig } from "@/lib/env";
export default function Setup() {
  return (
    <Shell>
      <PageHeader
        eyebrow="PUESTA EN MARCHA"
        title="Conecta tu espacio de trabajo"
        description="La configuración inicial permite guardar la información de tu empresa y habilitar el acceso de tu equipo."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-4 font-semibold">Estado del entorno</h2>
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            {supabaseConfig()
              ? "Variables de conexión presentes. Falta verificar el servicio y las migraciones."
              : "Supabase todavía no está configurado."}
          </p>
          <p className="mt-5 text-sm leading-7 text-stone-500">
            El responsable de la instalación debe conectar el servicio y
            habilitar al primer administrador. Después podrás crear empresas y
            fondos desde CUADRIA.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block font-medium text-emerald-800 underline"
          >
            Ir al inicio de sesión
          </Link>
        </section>
        <section className="card">
          <h2 className="font-semibold">Antes de comenzar</h2>
          <ol className="mt-5 list-decimal space-y-4 pl-5 text-sm leading-6 text-stone-600">
            <li>Conectar el proyecto de datos de CUADRIA.</li>
            <li>Configurar al propietario y los usuarios autorizados.</li>
            <li>Comprobar los permisos y realizar una operación de prueba.</li>
            <li>Validar el piloto con el administrador.</li>
          </ol>
          <p className="mt-6 text-xs leading-6 text-stone-500">
            No compartas contraseñas ni claves privadas por chat. Las
            instrucciones técnicas están en la documentación de despliegue del
            repositorio.
          </p>
        </section>
      </div>
    </Shell>
  );
}
