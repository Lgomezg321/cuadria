import { randomUUID } from "node:crypto";
import { getControls, getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
import { bogotaDate, formatCOP } from "@/lib/domain/money";
export default async function Drafts() {
  const [data, controls] = await Promise.all([getSnapshot(), getControls()]);
  const funds = data.funds.filter(
    (f) =>
      f.active &&
      data.memberships.some(
        (m) => m.company_id === f.company_id && m.role !== "auditor",
      ),
  );
  const fields = (d?: (typeof controls.drafts)[number]) => (
    <>
      <input type="hidden" name="id" value={d?.id || randomUUID()} />
      <input type="hidden" name="version" value={d?.version || 0} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          name="fund"
          label="Fondo"
          options={funds}
          defaultValue={d?.fund_id}
        />
        <Select
          name="kind"
          label="Tipo"
          options={[
            { id: "income", name: "Ingreso" },
            { id: "expense", name: "Egreso" },
            { id: "transfer", name: "Transferencia" },
          ]}
          defaultValue={d?.kind}
        />
        <Field name="amount" label="Valor en COP" defaultValue={d?.amount} />
        <Field
          name="date"
          label="Fecha de operación"
          type="date"
          defaultValue={d?.operation_date || bogotaDate()}
        />
        <Select
          name="destination"
          label="Destino (transferencias)"
          options={funds}
          optional
          defaultValue={d?.destination_id || ""}
        />
        <Select
          name="category"
          label="Categoría"
          options={data.categories}
          optional
          defaultValue={d?.category_id || ""}
        />
      </div>
      <Field name="concept" label="Concepto" defaultValue={d?.concept} />
    </>
  );
  return (
    <>
      <PageHeader
        eyebrow="ANTES DE CONTABILIZAR"
        title="Borradores"
        description="Prepara tus movimientos y revísalos antes de enviarlos. Guardar un borrador no cambia ningún saldo."
      />
      {funds.length > 0 && (
        <section className="card mb-8">
          <h2 className="mb-5 font-semibold">Nuevo borrador</h2>
          <ActionForm operation="draft" submit="Guardar borrador">
            {fields()}
          </ActionForm>
        </section>
      )}
      {!controls.drafts.length ? (
        <Empty
          title="Sin borradores pendientes"
          description="Tus movimientos en preparación aparecerán aquí. Solo tú puedes editarlos y enviarlos."
        />
      ) : (
        <div className="space-y-4">
          {controls.drafts.map((d) => (
            <section className="card" key={d.id}>
              <div className="mb-5 flex flex-wrap justify-between gap-3">
                <h2 className="font-semibold">{d.concept}</h2>
                <span className="font-mono">{formatCOP(d.amount)}</span>
              </div>
              <ActionForm
                operation="submitDraft"
                submit="Enviar y contabilizar"
              >
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="version" value={d.version} />
                <p className="text-xs text-stone-500">
                  {d.operation_date} ·{" "}
                  {data.funds.find((f) => f.id === d.fund_id)?.name}. Al enviar,
                  el movimiento afecta el saldo y deja de ser editable.
                </p>
              </ActionForm>
              <details className="mt-5">
                <summary className="cursor-pointer text-sm text-emerald-800">
                  Editar borrador
                </summary>
                <div className="mt-5">
                  <ActionForm operation="draft" submit="Guardar cambios">
                    {fields(d)}
                  </ActionForm>
                </div>
              </details>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
