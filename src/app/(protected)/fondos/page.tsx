import { randomUUID } from "node:crypto";
import { getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
import { formatCOP } from "@/lib/domain/money";
export default async function Funds() {
  const data = await getSnapshot();
  const admin = data.companies.filter((c) =>
    data.memberships.some((m) => m.company_id === c.id && m.role === "admin"),
  );
  const adminFunds = data.funds.filter((f) =>
    admin.some((c) => c.id === f.company_id),
  );
  const writable = data.funds.filter((f) =>
    data.memberships.some(
      (m) => m.company_id === f.company_id && m.role !== "auditor",
    ),
  );
  return (
    <>
      <PageHeader
        eyebrow="DINERO ADMINISTRADO"
        title="Fondos"
        description="Cajas de efectivo y cuentas operativas. Un arqueo conserva el saldo declarado sin ajustar automáticamente el saldo contable."
      />
      <div className="mb-8 grid gap-4 md:grid-cols-2">
        {data.funds.map((f) => (
          <div key={f.id} className="card">
            <p className="text-xs text-stone-500">
              {data.companies.find((c) => c.id === f.company_id)?.name} ·{" "}
              {f.kind === "cash" ? "Caja de efectivo" : "Cuenta bancaria"}
            </p>
            <h2 className="mt-3 font-semibold">{f.name}</h2>
            <p className="mt-4 text-2xl font-semibold">
              {formatCOP(f.balance)}
            </p>
            <p className="mt-3 text-xs text-stone-500">
              Saldo teórico · {f.active ? "Activo" : "Inactivo"}
            </p>
          </div>
        ))}
      </div>
      {!data.funds.length && (
        <Empty
          title="Sin fondos disponibles"
          description="Un administrador puede crear el primer fondo y asignarlo a un empleado."
        />
      )}
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        {admin.length > 0 && (
          <section className="card">
            <h2 className="mb-6 font-semibold">Abrir un fondo</h2>
            <ActionForm
              operation="fund"
              submit="Crear fondo y registrar apertura"
            >
              <input type="hidden" name="key" value={randomUUID()} />
              <Select name="company" label="Empresa" options={admin} />
              <Field name="name" label="Nombre del fondo" />
              <Select
                name="kind"
                label="Tipo"
                options={[
                  { id: "cash", name: "Caja de efectivo" },
                  { id: "bank", name: "Cuenta bancaria operativa" },
                ]}
              />
              <Field
                name="opening"
                label="Saldo de apertura en COP"
                placeholder="100000"
              />
            </ActionForm>
          </section>
        )}
        {writable.length > 0 && (
          <section className="card">
            <h2 className="mb-6 font-semibold">Declarar saldo real</h2>
            <ActionForm operation="check" submit="Registrar verificación">
              <input type="hidden" name="key" value={randomUUID()} />
              <Select name="fund" label="Fondo" options={writable} />
              <Field name="declared" label="Saldo real en COP" />
              <Field name="note" label="Observaciones" required={false} />
              <p className="text-xs leading-6 text-stone-500">
                Para efectivo se registra un arqueo; para cuentas bancarias, una
                conciliación manual al momento actual. Esta operación no cambia
                el saldo.
              </p>
            </ActionForm>
          </section>
        )}
        {adminFunds.length > 0 && (
          <section className="card">
            <h2 className="mb-6 font-semibold">Responsables del fondo</h2>
            <ActionForm operation="assignment" submit="Guardar asignación">
              <Select name="fund" label="Fondo" options={adminFunds} />
              <Field name="user" label="Identificador del empleado (UUID)" />
              <Select
                name="end"
                label="Acción"
                options={[
                  { id: "false", name: "Autorizar responsable" },
                  { id: "true", name: "Finalizar responsabilidad" },
                ]}
              />
            </ActionForm>
          </section>
        )}
      </div>
      {admin.length > 0 && (
        <section className="card mt-8">
          <h2 className="mb-5 font-semibold">Crear categoría</h2>
          <ActionForm operation="category" submit="Crear categoría">
            <Select name="company" label="Empresa" options={admin} />
            <Field name="name" label="Nombre de categoría" />
          </ActionForm>
        </section>
      )}
      {adminFunds.length > 0 && (
        <section className="card mt-8">
          <h2 className="mb-5 font-semibold">Estado del fondo</h2>
          <ActionForm operation="fundStatus" submit="Actualizar estado">
            <Select name="fund" label="Fondo" options={adminFunds} />
            <Select
              name="active"
              label="Estado"
              options={[
                { id: "true", name: "Activo" },
                { id: "false", name: "Inactivo (requiere saldo cero)" },
              ]}
            />
          </ActionForm>
        </section>
      )}
      {data.checks.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full">
            <caption>Arqueos y conciliaciones registrados</caption>
            <thead>
              <tr>
                <th>Fondo</th>
                <th>Teórico</th>
                <th>Declarado</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((c) => (
                <tr key={c.id}>
                  <td>{data.funds.find((f) => f.id === c.fund_id)?.name}</td>
                  <td>{formatCOP(c.theoretical)}</td>
                  <td>{formatCOP(c.declared)}</td>
                  <td>{formatCOP(c.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
