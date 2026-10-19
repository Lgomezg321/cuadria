"use server";
import { createClient as adminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { appOrigin, supabaseConfig } from "@/lib/env";
import { publicError } from "@/lib/errors";
import type { ActionState } from "@/app/actions";
export async function inviteEmployee(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const config = supabaseConfig();
  if (!secret || !config)
    return {
      error:
        "El envío de invitaciones requiere configurar el servicio de correo y la clave de administración exclusivamente en el servidor.",
    };
  const parsed = z
    .object({
      company: z.uuid(),
      email: z.email().max(254),
      role: z.enum(["employee", "auditor", "admin"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Revisa la empresa, el correo y el rol." };
  const v = parsed.data;
  // Authorize and persist the intended role with the caller's session before using the admin API.
  const { error } = await supabase.rpc("create_invitation", {
    p_company: v.company,
    p_email: v.email,
    p_role: v.role,
  });
  if (error) return { error: publicError(error) };
  const privileged = adminClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: sendError } = await privileged.auth.admin.inviteUserByEmail(
    v.email,
    { redirectTo: `${appOrigin()}/auth/callback?next=/auth/password` },
  );
  revalidatePath("/empresas");
  if (sendError)
    return {
      error:
        "La invitación quedó registrada, pero el correo no se pudo enviar. Si la persona ya tiene cuenta, puede iniciar sesión y aceptar sus invitaciones. Comprueba el servicio de correo antes de reintentar.",
    };
  return {
    success:
      "Invitación enviada. La membresía se activa al verificar el correo e iniciar sesión.",
  };
}
export async function acceptInvitations(): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("accept_invitations");
  if (error)
    throw new Error(
      "No fue posible aceptar las invitaciones. Verifica tu correo.",
    );
  revalidatePath("/", "layout");
}
