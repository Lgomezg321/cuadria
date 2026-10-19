import { getControls, getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
import { formatCOP, bogotaDate } from "@/lib/domain/money";
export default async function Closures() {
  const [data, controls] = await Promise.all([getSnapshot(), getControls()]);
  const funds = data.funds.filter((f) =>
    data.memberships.some(
      (m) => m.company_id === f.company_id && m.role === "admin",
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="HISTORIAL VERIFICABLE"
        title="Cierres de períodos"
        description="Un cierre conserva los totales aprobados y bloquea nuevos movimientos con fecha dentro del período. Las correcciones posteriores requieren una operación compensatoria en un período abierto."
      />
      {funds.length > 0 && (
        <section className="card mb-8 max-w-2xl">
          <h2 className="mb-5 font-semibold">Cerrar un período</h2>
          <ActionForm operation="closure" submit="Aprobar cierre">
            <Select name="fund" label="Fondo" options={funds} />
            <Field
              name="cutoff"
              label="Fecha de corte (incluida)"
              type="date"
              defaultValue={bogotaDate()}
            />
            <Field name="note" label="Observaciones" required={false} />
            <p className="text-sm leading-6 text-amber-900">
              Revisa primero los movimientos pendientes. Si cierras el día
              actual, no podrás contabilizar más operaciones con esa fecha. El
              cierre no se puede editar ni eliminar desde la aplicación.
            </p>
          </ActionForm>
        </section>
      )}
      {!controls.closures.length ? (
        <Empty
          title="Sin períodos cerrados"
          description="Los cierres aprobados mostrarán sus totales y fecha de corte aquí."
        />
      ) : (
        <div className="space-y-4">
          {controls.closures.map((c) => (
            <section key={c.id} className="card">
              <h2 className="font-semibold">
                {data.funds.find((f) => f.id === c.fund_id)?.name} · Hasta{" "}
                {c.cutoff}
              </h2>
              <dl className="mt-6 grid gap-5 sm:grid-cols-3">
                {[
                  ["Saldo inicial", c.opening_balance],
                  ["Ingresos", c.income],
                  ["Egresos", c.expenses],
                  ["Transferencias netas", c.transfers_net],
                  ["Reversiones netas", c.reversals_net],
                  ["Saldo al cierre", c.closing_balance],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-stone-500">{label}</dt>
                    <dd className="mt-2 font-mono text-lg">
                      {formatCOP(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
