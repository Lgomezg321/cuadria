import { z } from "zod";
import { inviteEmployee, acceptInvitations } from "@/app/invitation-actions";
import { requireUser } from "@/lib/auth";
import { getSnapshot } from "@/lib/data";
import { PageHeader, Empty } from "@/components/shell";
import { ActionForm, Field } from "@/components/action-form";
import { Select } from "@/components/business";
const roleLabels: Record<string, string> = {
  admin: "Administrador",
  employee: "Empleado",
  auditor: "Auditor",
};
const roleOptions = [
  { id: "employee", name: "Empleado" },
  { id: "auditor", name: "Auditor" },
  { id: "admin", name: "Administrador" },
];
const directorySchema = z.array(
  z.object({
    id: z.uuid(),
    email: z.string().nullable(),
    role: z.enum(["admin", "employee", "auditor"]),
    active: z.boolean(),
    creator: z.boolean(),
  }),
);
const invitationSchema = z.array(
  z.object({
    id: z.uuid(),
    company_id: z.uuid(),
    email: z.string(),
    role: z.string(),
    expires_at: z.string(),
  }),
);
const bogotaDateTime = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});
function currentInstant() {
  return new Date().toISOString();
}
export default async function Companies() {
  const data = await getSnapshot();
  const admin = data.companies.filter((c) =>
    data.memberships.some((m) => m.company_id === c.id && m.role === "admin"),
  );
  const { supabase, user } = await requireUser();
  // Pending means: not accepted, revoked or rejected, and not yet expired.
  const { data: rawInvitations } = await supabase
    .from("invitations")
    .select("id,company_id,email,role,expires_at")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .is("rejected_at", null)
    .gt("expires_at", currentInstant())
    .order("expires_at", { ascending: true })
    .order("email", { ascending: true })
    .limit(100);
  const invitations = invitationSchema.safeParse(rawInvitations ?? []);
  const companyName = (id: string) =>
    data.companies.find((c) => c.id === id)?.name ?? "Empresa";
  const directories = await Promise.all(
    admin.map(async (company) => {
      const { data: members, error } = await supabase.rpc("member_directory", {
        p_company: company.id,
      });
      const parsed = directorySchema.safeParse(members);
      return {
        company,
        members: !error && parsed.success ? parsed.data : null,
      };
    }),
  );
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
          <h2 className="mb-2 font-semibold">Invitar a una persona</h2>
          <p className="mb-5 text-xs leading-6 text-stone-500">
            Las altas se hacen únicamente por invitación aceptada con correo
            verificado. Solo el creador de la empresa o el propietario de la
            instalación pueden invitar administradores.
          </p>
          <ActionForm action={inviteEmployee} submit="Enviar invitación">
            <Select name="company" label="Empresa" options={admin} />
            <Field name="email" type="email" label="Correo electrónico" />
            <Select name="role" label="Rol" options={roleOptions} />
          </ActionForm>
          <h3 className="mt-8 text-sm font-semibold">
            Invitaciones pendientes
          </h3>
          {!invitations.success ? (
            <p className="mt-3 text-sm text-red-800">
              No fue posible consultar las invitaciones pendientes.
            </p>
          ) : invitations.data.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              No hay invitaciones pendientes vigentes.
            </p>
          ) : (
            invitations.data.map((i) => (
              <div className="mt-4 border-t pt-4" key={i.id}>
                <p className="text-sm font-medium">{i.email}</p>
                <p className="mt-1 mb-3 text-xs text-stone-500">
                  {companyName(i.company_id)} · {roleLabels[i.role] ?? i.role} ·
                  Vence el {bogotaDateTime.format(new Date(i.expires_at))}
                </p>
                <ActionForm
                  operation="revokeInvitation"
                  submit="Revocar invitación"
                >
                  <input type="hidden" name="id" value={i.id} />
                </ActionForm>
              </div>
            ))
          )}
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
      </div>
      {directories.map(({ company, members }) => (
        <section className="card mt-8" key={company.id}>
          <h2 className="mb-2 font-semibold">Miembros de {company.name}</h2>
          <p className="mb-5 text-xs leading-6 text-stone-500">
            Cambiar el rol o desactivar a una persona cierra sus
            responsabilidades vigentes sobre fondos. Si deja de ser
            administradora, sus invitaciones pendientes se revocan. Solo el
            creador de la empresa o el propietario de la instalación gestionan
            administradores, y la empresa conserva al menos uno activo.
          </p>
          {!members ? (
            <p className="text-sm text-red-800">
              No fue posible consultar los miembros de esta empresa.
            </p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="py-4">
                  <p className="text-sm font-medium">
                    {m.email ?? "Correo no disponible"}
                    {m.id === user.id && " (tú)"}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {roleLabels[m.role]} · {m.active ? "Activo" : "Inactivo"}
                    {m.creator && " · Creador de la empresa"}
                  </p>
                  {m.id !== user.id && (
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      {m.active && (
                        <ActionForm operation="member" submit="Cambiar rol">
                          <input
                            type="hidden"
                            name="company"
                            value={company.id}
                          />
                          <input type="hidden" name="user" value={m.id} />
                          <Select
                            name="role"
                            label="Nuevo rol"
                            options={roleOptions}
                            defaultValue={m.role}
                          />
                        </ActionForm>
                      )}
                      <ActionForm
                        operation="memberStatus"
                        submit={
                          m.active
                            ? "Desactivar membresía"
                            : "Reactivar membresía"
                        }
                      >
                        <input
                          type="hidden"
                          name="company"
                          value={company.id}
                        />
                        <input type="hidden" name="user" value={m.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={m.active ? "false" : "true"}
                        />
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
