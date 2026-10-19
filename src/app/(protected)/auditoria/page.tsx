import Link from "next/link";
import { ReceiptPreview } from "@/components/receipt-preview";
import { randomUUID } from "node:crypto";
import { getSnapshot, getControls, getMovementDetail } from "@/lib/data";
import { requireUser } from "@/lib/auth";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select, kindLabels, reviewLabels } from "@/components/business";
import { formatCOP } from "@/lib/domain/money";
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ movement?: string }>;
}) {
  const data = await getSnapshot();
  const controls = await getControls();
  const { user } = await requireUser();
  const items = data.movements;
  const selected =
    (await searchParams).movement ||
    items.find((m) => m.review_status === "pending" && m.kind !== "opening")
      ?.id ||
    items[0]?.id;
  const detail = selected ? await getMovementDetail(selected) : null;
  const m = detail?.movement;
  const admin =
    m &&
    data.memberships.some(
      (x) => x.company_id === m.company_id && x.role === "admin",
    );
  const closed =
    m &&
    data.funds.some(
      (f) =>
        (f.id === m.fund_id || f.id === m.destination_id) &&
        f.closed_through &&
        m.operation_date <= f.closed_through,
    );
  const reviewable =
    m &&
    admin &&
    m.created_by !== user.id &&
    m.financial_status === "posted" &&
    !["opening", "reversal"].includes(m.kind) &&
    !closed;
  const checks = data.checks.filter(
    (c) =>
      c.created_by !== user.id &&
      data.memberships.some(
        (x) => x.company_id === c.company_id && x.role === "admin",
      ) &&
      !controls.check_reviews.some(
        (r) => r.check_id === c.id && r.decision === "approved",
      ),
  );
  const index = items.findIndex((x) => x.id === m?.id);
  return (
    <>
      <PageHeader
        eyebrow="SUPERVISIÓN"
        title="Auditoría de movimientos"
        description="Consulta comprobantes, decisiones y respuestas. Aprobar o comentar no modifica los asientos."
      />
      <section className="card mb-6">
        <form
          action="/auditoria"
          className="grid items-end gap-4 sm:grid-cols-[1fr_auto]"
        >
          <Select
            name="movement"
            label="Movimientos recientes autorizados"
            defaultValue={selected}
            options={items.map((x) => ({
              id: x.id,
              name: `${x.operation_date} · ${x.concept} · ${reviewLabels[x.review_status]}`,
            }))}
          />
          <button className="rounded-lg bg-emerald-900 px-5 py-3 text-sm font-semibold text-white">
            Abrir movimiento
          </button>
        </form>
        <p className="mt-3 text-xs text-stone-500">
          Se muestran los últimos 100 movimientos. Para consultar períodos
          anteriores, abre el detalle desde Reportes.
        </p>
      </section>
      {!m || !detail ? (
        <Empty
          title="Sin movimiento disponible"
          description="Selecciona un movimiento que esté dentro de tus permisos actuales."
        />
      ) : (
        <>
          <nav
            aria-label="Navegación entre movimientos"
            className="mb-5 flex justify-between text-sm text-emerald-800"
          >
            {index > 0 ? (
              <Link href={`/auditoria?movement=${items[index - 1].id}`}>
                ← Anterior
              </Link>
            ) : (
              <span />
            )}
            {index >= 0 && index < items.length - 1 ? (
              <Link href={`/auditoria?movement=${items[index + 1].id}`}>
                Siguiente →
              </Link>
            ) : (
              <span />
            )}
          </nav>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <section className="card min-w-0">
              <p className="text-xs text-stone-500">
                {m.operation_date} · {kindLabels[m.kind]} ·{" "}
                {reviewLabels[m.review_status]}
              </p>
              <h2 className="mt-3 break-words text-xl font-semibold">
                {m.concept}
              </h2>
              <p className="mt-4 break-words text-3xl font-semibold">
                {formatCOP(m.amount)}
              </p>
              <p className="mt-3 text-sm text-stone-500">
                {data.funds.find((f) => f.id === m.fund_id)?.name ||
                  "Fondo de origen"}
                {m.destination_id
                  ? ` → ${data.funds.find((f) => f.id === m.destination_id)?.name || "Fondo de destino"}`
                  : ""}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                {m.financial_status === "reversed"
                  ? "Reversado: el original se conserva."
                  : "Contabilizado"}
                {closed ? " · Período cerrado: decisiones congeladas." : ""}
              </p>
              {reviewable && (
                <div className="mt-7">
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
                    <Field
                      name="comment"
                      label="Comentario de revisión"
                      required={false}
                    />
                  </ActionForm>
                </div>
              )}
              <div className="mt-8 border-t border-stone-200 pt-6">
                <h3 className="mb-4 font-semibold">Historial de decisiones</h3>
                {!detail.reviews.length && (
                  <p className="text-sm text-stone-500">
                    Sin decisiones registradas.
                  </p>
                )}
                <ol className="space-y-4">
                  {detail.reviews.map((r) => (
                    <li key={r.id} className="text-sm">
                      <p className="font-medium">
                        {reviewLabels[r.decision]} ·{" "}
                        {new Date(r.created_at).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                      </p>
                      <p className="break-words text-xs text-stone-500">
                        Revisor: {r.reviewer_id}
                      </p>
                      <p className="mt-1 break-words whitespace-pre-wrap">
                        {r.comment || "Sin comentario."}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="mt-8 border-t border-stone-200 pt-6">
                <h3 className="mb-4 font-semibold">
                  Respuestas y aclaraciones
                </h3>
                {!detail.comments.length && (
                  <p className="mb-4 text-sm text-stone-500">
                    Sin respuestas registradas.
                  </p>
                )}
                <ol className="mb-5 space-y-4">
                  {detail.comments.map((c) => (
                    <li key={c.id} className="text-sm">
                      <p className="break-words text-xs text-stone-500">
                        {c.author_id === user.id ? "Tú" : c.author_id} ·{" "}
                        {new Date(c.created_at).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                        })}
                      </p>
                      <p className="mt-1 break-words whitespace-pre-wrap">
                        {c.body}
                      </p>
                    </li>
                  ))}
                </ol>
                {(admin || m.created_by === user.id) && (
                  <ActionForm
                    operation="movementComment"
                    submit="Agregar respuesta"
                  >
                    <input type="hidden" name="id" value={randomUUID()} />
                    <input type="hidden" name="movement" value={m.id} />
                    <Field
                      name="body"
                      label="Respuesta permanente"
                      minLength={3}
                      maxLength={2000}
                    />
                    <p className="text-xs text-stone-500">
                      La respuesta queda en el historial y no puede editarse ni
                      borrarse.
                    </p>
                  </ActionForm>
                )}
              </div>
              {admin &&
                m.financial_status === "posted" &&
                !["opening", "reversal"].includes(m.kind) && (
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
                          Se conserva el original y se registra una compensación
                          con fecha de hoy. Requiere saldo suficiente y que hoy
                          esté fuera del período cerrado.
                        </p>
                      </ActionForm>
                    </div>
                  </details>
                )}
            </section>
            <section className="card min-w-0">
              <h2 className="mb-5 font-semibold">Comprobantes</h2>
              <ReceiptPreview movement={m.id} />
            </section>
          </div>
        </>
      )}
      <div className="mt-8">
        {checks.length > 0 && (
          <section className="card mb-8">
            <h2 className="mb-5 font-semibold">
              Revisar arqueo o conciliación
            </h2>
            <ActionForm
              operation="checkReview"
              submit="Guardar revisión de saldo"
            >
              <Select
                name="check"
                label="Declaración"
                options={checks.map((c) => ({
                  id: c.id,
                  name:
                    (data.funds.find((f) => f.id === c.fund_id)?.name ||
                      "Fondo") +
                    " · Diferencia " +
                    formatCOP(c.difference),
                }))}
              />
              <Select
                name="decision"
                label="Decisión"
                options={[
                  { id: "approved", name: "Aprobar" },
                  { id: "observed", name: "Observar" },
                ]}
              />
              <Field name="comment" label="Comentario" required={false} />
              <p className="text-xs text-stone-500">
                Aprobar documenta la revisión; no compensa faltantes o
                sobrantes.
              </p>
            </ActionForm>
          </section>
        )}
      </div>
    </>
  );
}
