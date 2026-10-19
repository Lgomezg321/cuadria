import { getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
export default async function Companies() {
  const data = await getSnapshot();
  const admin = data.companies.filter((c) =>
    data.memberships.some((m) => m.company_id === c.id && m.role === "admin"),
  );
  return (
    <>
      <PageHeader
        eyebrow="ORGANIZACIÓN"
        title="Empresas"
        description="Cada empresa conserva sus propios fondos, miembros y registros."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4">
          {data.companies.length ? (
            data.companies.map((c) => (
              <div key={c.id} className="card">
                <h2 className="font-semibold">{c.name}</h2>
                <p className="mt-2 text-sm text-stone-500">NIT {c.nit}</p>
                <p className="mt-3 text-xs text-stone-400">
                  {data.memberships.find((m) => m.company_id === c.id)?.role ===
                  "admin"
                    ? "Administrador"
                    : "Miembro autorizado"}
                </p>
              </div>
            ))
          ) : (
            <Empty
              title="Sin empresas asignadas"
              description="El propietario puede crear la primera empresa. Los demás usuarios necesitan una membresía."
            />
          )}
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Crear empresa</h2>
          <p className="mb-6 text-xs leading-6 text-stone-500">
            Disponible únicamente para el propietario configurado por el
            responsable de la instalación.
          </p>
          <ActionForm operation="company" submit="Crear empresa">
            <Field name="name" label="Nombre de la empresa" />
            <Field name="nit" label="NIT" />
          </ActionForm>
        </section>
        {admin.length > 0 && (
          <section className="card">
            <h2 className="mb-3 font-semibold">Asignar usuario existente</h2>
            <p className="mb-5 text-xs leading-6 text-stone-500">
              La invitación por correo todavía no está habilitada. Utiliza el
              identificador de un usuario creado en Supabase Auth por el
              responsable de la instalación.
            </p>
            <ActionForm operation="member" submit="Asignar membresía">
              <Select name="company" label="Empresa" options={admin} />
              <Field name="user" label="Identificador del usuario (UUID)" />
              <Select
                name="role"
                label="Rol"
                options={[
                  { id: "employee", name: "Empleado" },
                  { id: "admin", name: "Administrador" },
                  { id: "auditor", name: "Auditor" },
                ]}
              />
            </ActionForm>
          </section>
        )}
      </div>
    </>
  );
}
