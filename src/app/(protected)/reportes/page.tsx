import Link from "next/link";
import { PageHeader } from "@/components/shell";
import { Select, kindLabels, reviewLabels } from "@/components/business";
import { Field } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { getSnapshot } from "@/lib/data";
import { getReport } from "@/lib/reports";
import { detailRange } from "@/lib/domain/reports";
import { bogotaDate, formatCOP } from "@/lib/domain/money";
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const today = bogotaDate();
  const filters: Record<string, string | undefined> & {
    from: string;
    to: string;
  } = {
    ...raw,
    from: raw.from || today.slice(0, 7) + "-01",
    to: raw.to || today,
  };
  const data = await getSnapshot();
  const report = await getReport(filters);
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== undefined) as [
      string,
      string,
    ][],
  );
  const nextQuery = new URLSearchParams(query);
  nextQuery.set("offset", String(report.offset + 200));
  return (
    <>
      <PageHeader
        eyebrow="INFORMACIÓN FINANCIERA"
        title="Reportes"
        description="Totales completos de los fondos autorizados en el período. Las transferencias internas se presentan por separado de los ingresos."
      />
      <form className="card mb-8 space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            name="company"
            label="Empresa"
            options={data.companies}
            optional
            defaultValue={filters.company}
          />
          <Select
            name="fund"
            label="Fondo"
            options={data.funds}
            optional
            defaultValue={filters.fund}
          />
          <Field
            name="from"
            label="Desde"
            type="date"
            defaultValue={filters.from}
          />
          <Field
            name="to"
            label="Hasta (máximo 366 días)"
            type="date"
            defaultValue={filters.to}
          />
          <Select
            name="kind"
            label="Tipo en el detalle"
            options={Object.entries(kindLabels).map(([id, name]) => ({
              id,
              name,
            }))}
            optional
            defaultValue={filters.kind}
          />
          <Select
            name="review"
            label="Revisión en el detalle"
            options={Object.entries(reviewLabels).map(([id, name]) => ({
              id,
              name,
            }))}
            optional
            defaultValue={filters.review}
          />
          <Select
            name="category"
            label="Categoría en el detalle"
            options={data.categories}
            optional
            defaultValue={filters.category}
          />
          <Field
            name="author"
            label="Empleado en el detalle (UUID)"
            required={false}
            defaultValue={filters.author}
          />
        </div>
        <Button type="submit">Consultar</Button>
      </form>
      <div className="mb-6 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <a href={"/reportes/csv?" + query}>Exportar CSV</a>
        </Button>
        <Button asChild variant="outline">
          <a href={"/reportes/pdf?" + query}>Descargar resumen PDF</a>
        </Button>
      </div>
      <p className="mb-5 text-xs leading-6 text-stone-500">
        Los filtros de tipo, revisión, categoría y empleado afectan el detalle.
        Los saldos y totales siempre incluyen todos los asientos de los fondos
        seleccionados en el período, incluidas las correcciones por reversión.
      </p>
      <div className="space-y-4">
        {report.totals.map((f) => (
          <section key={f.id} className="card">
            <h2 className="font-semibold">
              {f.company_name} · {f.name}
            </h2>
            <dl className="mt-6 grid gap-4 sm:grid-cols-4">
              {[
                ["Saldo inicial", f.opening_balance],
                ["Aperturas del período", f.opening_funding],
                ["Ingresos", f.income],
                ["Egresos", f.expenses],
                ["Transferencias netas", f.transfers_net],
                ["Reversiones netas", f.reversals_net],
                ["Saldo final", f.closing_balance],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-stone-500">{label}</dt>
                  <dd className="mt-2 font-mono">{formatCOP(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="mt-8 overflow-x-auto rounded-xl border bg-white">
        <table className="w-full">
          <caption>
            Detalle de asientos ·{" "}
            {detailRange(
              report.offset,
              report.entries.length,
              report.total_entries,
            )}
          </caption>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Fondo</th>
              <th>Concepto</th>
              <th>Tipo</th>
              <th>Valor neto</th>
              <th>Estado</th>
              <th>Revisión</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.map((e) => (
              <tr key={e.entry_id}>
                <td>{e.operation_date}</td>
                <td>{e.fund_name}</td>
                <td>
                  <Link
                    className="text-emerald-800 underline"
                    href={`/auditoria?movement=${e.movement_id}`}
                  >
                    {e.concept}
                  </Link>
                </td>
                <td>{kindLabels[e.kind]}</td>
                <td>{formatCOP(e.signed_amount)}</td>
                <td>
                  {e.financial_status === "reversed"
                    ? "Reversado"
                    : "Contabilizado"}
                </td>
                <td>{reviewLabels[e.review_status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex gap-5 text-sm text-emerald-800">
        {report.offset > 0 && (
          <Link
            href={
              "/reportes?" +
              new URLSearchParams({
                ...Object.fromEntries(query),
                offset: String(Math.max(0, report.offset - 200)),
              })
            }
          >
            Anterior
          </Link>
        )}
        {report.offset + 200 < report.total_entries && (
          <Link href={"/reportes?" + nextQuery}>Siguiente</Link>
        )}
      </div>
      <p className="mt-5 text-xs text-stone-500">
        El CSV incluye los totales completos y la página de detalle actual
        (hasta 200 asientos); los importes de más de 15 dígitos se exportan como
        texto para conservar todos los dígitos en hojas de cálculo. El PDF
        contiene el resumen completo por fondo.
      </p>
    </>
  );
}
