import { uploadReceipt } from "@/app/receipt-actions";
import { requireUser } from "@/lib/auth";
import { Receipts } from "@/components/receipts";
import { randomUUID } from "node:crypto";
import { getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select, MovementTable } from "@/components/business";
import { bogotaDate } from "@/lib/domain/money";
export default async function Movements() {
  const data = await getSnapshot();
  const { user } = await requireUser();
  const own = data.movements.filter(
    (m) =>
      m.created_by === user.id &&
      m.financial_status === "posted" &&
      m.review_status !== "approved",
  );
  const writable = data.funds.filter((f) =>
    data.memberships.some(
      (m) => m.company_id === f.company_id && m.role !== "auditor",
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="REGISTRO FINANCIERO"
        title="Movimientos"
        description="Cada envío se contabiliza una sola vez. La revisión posterior no modifica nuevamente el saldo."
      />
      {writable.length > 0 ? (
        <section className="card mb-8 max-w-3xl">
          <h2 className="mb-6 font-semibold">Registrar movimiento</h2>
          <ActionForm operation="movement" submit="Contabilizar movimiento">
            <input type="hidden" name="key" value={randomUUID()} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Select name="fund" label="Fondo de origen" options={writable} />
              <Select
                name="kind"
                label="Tipo de movimiento"
                options={[
                  { id: "expense", name: "Egreso" },
                  { id: "income", name: "Ingreso" },
                  { id: "transfer", name: "Transferencia" },
                ]}
              />
              <Field name="amount" label="Valor en COP" placeholder="25000" />
              <Field
                name="date"
                type="date"
                label="Fecha de operación"
                defaultValue={bogotaDate()}
              />
              <Select
                name="destination"
                label="Destino (solo transferencias)"
                options={writable}
                optional
              />
              <Select
                name="category"
                label="Categoría de la empresa"
                options={data.categories}
                optional
              />
            </div>
            <Field name="concept" label="Concepto" minLength={3} />
            <p className="text-xs text-stone-500">
              Usa valores enteros, sin puntos ni comas. El registro
              contabilizado se corrige mediante reversión.
            </p>
          </ActionForm>
        </section>
      ) : (
        <Empty
          title="Sin fondos para registrar movimientos"
          description="Necesitas un fondo asignado y permiso de operación."
        />
      )}
      {data.movements.length > 0 && <MovementTable data={data} />}
      {own.length > 0 && (
        <section className="card mt-8 max-w-3xl">
          <h2 className="mb-5 font-semibold">Adjuntar comprobante</h2>
          <ActionForm action={uploadReceipt} submit="Cargar comprobante">
            <Select
              name="movement"
              label="Movimiento"
              options={own.map((m) => ({
                id: m.id,
                name: m.concept + " · " + m.operation_date,
              }))}
            />
            <label className="field">
              Comprobante JPG, PNG o PDF · máximo 10 MB
              <input
                type="file"
                name="receipt"
                accept="image/jpeg,image/png,application/pdf"
                required
              />
            </label>
          </ActionForm>
          <div className="mt-6 space-y-5">
            {own.slice(0, 10).map((m) => (
              <div key={m.id}>
                <h3 className="mb-2 text-sm font-medium">{m.concept}</h3>
                <Receipts movement={m.id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
