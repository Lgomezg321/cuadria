import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  ArrowLeftRight,
  ScanLine,
  LockKeyhole,
  CircleCheck,
} from "lucide-react";
import { Shell, PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { supabaseConfig } from "@/lib/env";
export default function Home() {
  const configured = !!supabaseConfig();
  return (
    <Shell>
      <PageHeader
        eyebrow="CONTROL FINANCIERO INTELIGENTE"
        title="Cada peso, en su lugar."
        description="Una visión clara del dinero que administra tu equipo. Empresas, fondos y revisiones en un mismo espacio."
      />
      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <section className="relative overflow-hidden rounded-2xl bg-[#163e34] p-8 text-white md:p-10">
          <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-emerald-100">
            CUADRIA · Espacio empresarial
          </span>
          <h2 className="mt-9 max-w-md text-3xl leading-tight font-medium md:text-4xl">
            El control comienza
            <br />
            con información confiable.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-emerald-100/75">
            Registra la operación diaria, conserva su historial y revisa cada
            movimiento con el contexto que necesitas.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-8 border-white bg-white text-emerald-950"
          >
            <Link href={configured ? "/login" : "/configuracion"}>
              {configured ? "Ingresar a mi espacio" : "Configurar mi espacio"}
              <ArrowUpRight size={17} />
            </Link>
          </Button>
          <div className="mt-12 flex flex-wrap gap-5 border-t border-white/15 pt-5 text-xs text-emerald-100/80">
            <span>Colombia · COP</span>
            <span>America/Bogota</span>
            <span>Multiempresa</span>
          </div>
        </section>
        <section className="card flex flex-col">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Puesta en marcha</h2>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
              {configured ? "Validación pendiente" : "Conexión pendiente"}
            </span>
          </div>
          {[
            [
              "01",
              "Conectar Supabase",
              "Autenticación y persistencia de datos.",
            ],
            ["02", "Configurar tu empresa", "Propietario, miembros y fondos."],
            [
              "03",
              "Validar la operación",
              "Prueba el circuito antes del piloto.",
            ],
          ].map(([n, title, description]) => (
            <div key={n} className="flex gap-4 border-b border-stone-100 py-5">
              <span className="pt-1 font-mono text-xs text-stone-400">{n}</span>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {description}
                </p>
              </div>
            </div>
          ))}
          <p className="mt-auto pt-6 text-xs leading-6 text-stone-500">
            {configured
              ? "Hay variables de conexión configuradas. La disponibilidad del servicio se comprobará al iniciar sesión."
              : "No hay una base de datos conectada en este entorno. Los saldos aparecerán después de configurar el servicio y registrar fondos reales."}
          </p>
        </section>
      </div>
      <h2 className="mt-10 mb-5 text-lg font-semibold">
        Una operación con trazabilidad
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          [
            Building2,
            "Empresas y fondos",
            "Acceso delimitado por membresías y responsabilidades.",
          ],
          [
            ArrowLeftRight,
            "Movimientos exactos",
            "Ingresos, egresos y transferencias con registro financiero.",
          ],
          [
            ScanLine,
            "Revisión con contexto",
            "Decisiones, arqueos e historial de supervisión.",
          ],
        ].map(([Icon, title, description]) => {
          const I = Icon as typeof Building2;
          return (
            <div className="card" key={String(title)}>
              <I className="mb-5 text-emerald-800" size={22} />
              <h3 className="text-sm font-semibold">{String(title)}</h3>
              <p className="mt-2 text-xs leading-6 text-stone-500">
                {String(description)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
        <span className="flex items-center gap-2">
          <LockKeyhole size={14} />
          Acceso reservado a usuarios autorizados
        </span>
        <span className="flex items-center gap-2">
          <CircleCheck size={14} />
          Los datos de tu operación permanecen separados por empresa
        </span>
      </div>
    </Shell>
  );
}
