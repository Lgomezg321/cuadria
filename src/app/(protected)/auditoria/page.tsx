import { Receipts } from "@/components/receipts";
import { randomUUID } from "node:crypto";
import { getSnapshot } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select, kindLabels, reviewLabels } from "@/components/business";
import { formatCOP } from "@/lib/domain/money";
export default async function Audit() {
  const data = await getSnapshot();
  const { user } = await requireUser();
  const items = data.movements.filter(
    (m) =>
      data.memberships.some(
        (x) => x.company_id === m.company_id && x.role === "admin",
      ) &&
      m.created_by !== user.id &&
      m.financial_status === "posted",
  );
  return (
    <>
      <PageHeader
        eyebrow="SUPERVISIÓN"
        title="Auditoría de movimientos"
        description="Revisa operaciones de otros usuarios y conserva la trazabilidad de cada decisión. Rechazar exige una reversión compensatoria."
      />
      {items.length === 0 ? (
        <Empty
          title="Sin movimientos disponibles para revisar"
          description="Solo los administradores pueden revisar movimientos de otros usuarios dentro de sus empresas autorizadas."
        />
      ) : (
        <div className="space-y-6">
          {items.map((m) => (
            <section key={m.id} className="card grid gap-8 md:grid-cols-2">
              <div>
                <p className="text-xs text-stone-500">
                  {m.operation_date} · {kindLabels[m.kind]} ·{" "}
                  {reviewLabels[m.review_status]}
                </p>
                <h2 className="mt-3 text-xl font-semibold">{m.concept}</h2>
                <p className="mt-4 text-3xl font-semibold">
                  {formatCOP(m.amount)}
                </p>
                <p className="mt-4 text-sm text-stone-500">
                  {data.funds.find((f) => f.id === m.fund_id)?.name}
                </p>
                <div className="mt-5">
                  <Receipts movement={m.id} />
                </div>
                <details className="mt-8 text-sm">
                  <summary className="cursor-pointer text-red-800">
                    Rechazar y reversar
                  </summary>
                  <div className="mt-4">
                    <ActionForm
                      operation="reversal"
                      submit="Registrar reversión"
                    >
                      <input type="hidden" name="movement" value={m.id} />
                      <input type="hidden" name="key" value={randomUUID()} />
                      <Field
                        name="reason"
                        label="Motivo de reversión"
                        minLength={3}
                      />
                      <p className="text-xs leading-5 text-stone-500">
                        Se conservará el movimiento original y se registrará un
                        asiento compensatorio.
                      </p>
                    </ActionForm>
                  </div>
                </details>
              </div>
              <ActionForm operation="review" submit="Guardar revisión">
                <input type="hidden" name="movement" value={m.id} />
                <Select
                  name="decision"
                  label="Decisión"
                  options={[
                    { id: "approved", name: "Aprobar" },
                    { id: "observed", name: "Observar" },
                  ]}
                />
                <Field name="comment" label="Comentario" required={false} />
              </ActionForm>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
