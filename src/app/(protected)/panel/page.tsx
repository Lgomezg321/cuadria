import { requireUser } from "@/lib/auth";
import Link from "next/link";
import { Plus, ArrowUpRight } from "lucide-react";
import { PageHeader, Empty } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { getSnapshot } from "@/lib/data";
import { sumCOP, formatCOP } from "@/lib/domain/money";
import { MovementTable } from "@/components/business";
export default async function Dashboard() {
  const data = await getSnapshot();
  const { supabase } = await requireUser();
  const { data: alerts, error: alertError } =
    await supabase.rpc("alerts_snapshot");

  return (
    <>
      <PageHeader
        eyebrow="TU OPERACIÓN AL DÍA"
        title="Vista general"
        description="Saldos de los fondos a los que tienes acceso. La información se consulta directamente en la base de datos."
      >
        <Button asChild>
          <Link href="/movimientos">
            <Plus size={16} />
            Registrar movimiento
          </Link>
        </Button>
      </PageHeader>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[
          [
            "Saldo administrado",
            formatCOP(sumCOP(data.funds.map((f) => f.balance))),
          ],
          ["Empresas autorizadas", data.companies.length],
          ["Fondos disponibles", data.funds.length],
        ].map(([label, value]) => (
          <div key={label} className="card">
            <p className="text-xs text-stone-500">{label}</p>
            <p className="mt-5 break-all text-3xl font-semibold tracking-tight">
              {value}
            </p>
            <p className="mt-4 text-[11px] text-stone-400">
              Según tus permisos actuales
            </p>
          </div>
        ))}
      </div>
      {!alertError && alerts && (
        <section className="card mb-8">
          <h2 className="mb-5 font-semibold">Requieren atención</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Movimientos pendientes", alerts.pending],
              ["Movimientos observados", alerts.observed],
              ["Egresos sin comprobante cargado", alerts.missing_receipts],
              [
                "Fondos con diferencia en última declaración",
                alerts.funds_with_difference,
              ],
              ["Sin verificación aprobada en 7 días", alerts.unverified_funds],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-xs text-stone-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{String(value)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {alertError && (
        <p role="alert" className="mb-6 text-sm text-red-800">
          No fue posible consultar las alertas.
        </p>
      )}
      {data.funds.length === 0 ? (
        <Empty
          title="Tu operación comienza aquí"
          description="Crea una empresa y su primer fondo, o solicita al administrador una asignación. No tienes fondos disponibles todavía."
        />
      ) : (
        <section className="mb-8">
          <div className="mb-4 flex justify-between">
            <h2 className="font-semibold">Tus fondos</h2>
            <Link
              href="/fondos"
              className="flex items-center gap-1 text-xs text-emerald-800"
            >
              Ver fondos
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.funds.map((f) => (
              <Link href="/fondos" className="card" key={f.id}>
                <p className="text-xs text-stone-500">
                  {data.companies.find((c) => c.id === f.company_id)?.name} ·{" "}
                  {f.kind === "cash" ? "Efectivo" : "Cuenta bancaria"}
                </p>
                <h3 className="mt-3 font-semibold">{f.name}</h3>
                <p className="mt-5 font-mono text-2xl">
                  {formatCOP(f.balance)}
                </p>
                <p className="mt-4 text-xs text-stone-500">
                  Saldo teórico · requiere verificación mediante arqueo o
                  conciliación
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
      {data.movements.length > 0 && <MovementTable data={data} />}
    </>
  );
}
