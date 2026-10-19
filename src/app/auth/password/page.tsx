import { requireUser } from "@/lib/auth";
import { ActionForm, Field } from "@/components/action-form";
import { changePassword } from "@/app/actions";
export default async function Password() {
  await requireUser();
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <h1 className="mb-8 text-2xl font-semibold">Actualizar contraseña</h1>
      <ActionForm action={changePassword} submit="Actualizar">
        <Field
          label="Nueva contraseña (mínimo 12 caracteres)"
          name="password"
          type="password"
          minLength={12}
        />
      </ActionForm>
    </main>
  );
}
