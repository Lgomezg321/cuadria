import { inviteEmployee, acceptInvitations } from "@/app/invitation-actions";
import { requireUser } from "@/lib/auth";
import { getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
export default async function Companies() {
  const data = await getSnapshot();
  const admin = data.companies.filter((c) =>
    data.memberships.some((m) => m.company_id === c.id && m.role === "admin"),
  );
  const { supabase } = await requireUser();
  const { data: invitations } = await supabase
    .from("invitations")
    .select("id,email,role,accepted_at,revoked_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .limit(100);
  return (
    <>
      <PageHeader
        eyebrow="ORGANIZACIÓN"
        title="Empresas"
        description="Cada empresa conserva sus propios fondos, miembros y registros."
      />
      <form action={acceptInvitations} className="mb-6">
        <button className="text-sm font-semibold text-emerald-800 underline">
          Aceptar invitaciones para mi correo verificado
        </button>
      </form>
      {admin.length > 0 && (
        <section className="card mb-8">
          <h2 className="mb-5 font-semibold">Invitar a una persona</h2>
          <ActionForm action={inviteEmployee} submit="Enviar invitación">
            <Select name="company" label="Empresa" options={admin} />
            <Field name="email" type="email" label="Correo electrónico" />
            <Select
              name="role"
              label="Rol"
              options={[
                { id: "employee", name: "Empleado" },
                { id: "auditor", name: "Auditor" },
                { id: "admin", name: "Administrador" },
              ]}
            />
          </ActionForm>
          {invitations?.map((i) => (
            <div className="mt-6 border-t pt-4" key={i.id}>
              <p className="mb-3 text-sm">{i.email} · Invitación pendiente</p>
              <ActionForm
                operation="revokeInvitation"
                submit="Revocar invitación"
              >
                <input type="hidden" name="id" value={i.id} />
              </ActionForm>
            </div>
          ))}
        </section>
      )}
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
              Para asignar una cuenta que ya existe, utiliza el identificador de
              un usuario creado en Supabase Auth por el responsable de la
              instalación.
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
