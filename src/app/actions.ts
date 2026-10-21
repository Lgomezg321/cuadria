"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig, appOrigin } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { publicError } from "@/lib/errors";
import { moneySchema, positiveMoneySchema } from "@/lib/domain/money";
export type ActionState = { error?: string; success?: string };
const uuid = z.uuid();
const schemas = {
  company: z.object({
    name: z.string().trim().min(2).max(120),
    nit: z.string().trim().min(5).max(20),
  }),
  fund: z.object({
    company: uuid,
    name: z.string().trim().min(2).max(120),
    kind: z.enum(["cash", "bank"]),
    opening: moneySchema,
    key: uuid,
  }),
  movement: z.object({
    fund: uuid,
    destination: z.union([uuid, z.literal("")]),
    category: z.union([uuid, z.literal("")]),
    kind: z.enum(["income", "expense", "transfer"]),
    amount: positiveMoneySchema,
    concept: z.string().trim().min(3).max(500),
    date: z.iso.date(),
    key: uuid,
  }),
  check: z.object({
    fund: uuid,
    declared: moneySchema,
    note: z.string().max(2000),
  }),
  review: z.object({
    movement: uuid,
    decision: z.enum(["approved", "observed"]),
    comment: z.string().max(2000),
  }),
  reversal: z.object({
    movement: uuid,
    reason: z.string().trim().min(3).max(500),
    key: uuid,
  }),
  assignment: z.object({
    fund: uuid,
    user: uuid,
    end: z.enum(["true", "false"]),
  }),
  member: z.object({
    company: uuid,
    user: uuid,
    role: z.enum(["employee", "admin", "auditor"]),
  }),
  memberStatus: z.object({
    company: uuid,
    user: uuid,
    active: z.enum(["true", "false"]),
  }),
};
export async function mutate(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const op = String(form.get("operation"));
  const raw = Object.fromEntries(form);
  let name: string;
  let args: Record<string, unknown>;
  try {
    switch (op) {
      case "movementComment": {
        const v = z
          .object({
            id: uuid,
            movement: uuid,
            body: z.string().trim().min(3).max(2000),
          })
          .parse(raw);
        name = "comment_movement";
        args = { p_id: v.id, p_movement: v.movement, p_body: v.body };
        break;
      }
      case "draft": {
        const v = schemas.movement
          .omit({ key: true })
          .extend({ id: uuid, version: z.coerce.number().int().min(0) })
          .parse(raw);
        name = "save_draft";
        args = {
          p_id: v.id,
          p_version: v.version,
          p_fund: v.fund,
          p_destination: v.kind === "transfer" ? v.destination || null : null,
          p_category: v.category || null,
          p_kind: v.kind,
          p_amount: v.amount,
          p_concept: v.concept,
          p_date: v.date,
        };
        break;
      }
      case "submitDraft": {
        const v = z
          .object({ id: uuid, version: z.coerce.number().int().positive() })
          .parse(raw);
        name = "submit_draft";
        args = { p_id: v.id, p_version: v.version };
        break;
      }
      case "closure": {
        const v = z
          .object({
            fund: uuid,
            cutoff: z.iso.date(),
            note: z.string().max(2000),
          })
          .parse(raw);
        name = "close_period";
        args = { p_fund: v.fund, p_cutoff: v.cutoff, p_note: v.note };
        break;
      }
      case "checkReview": {
        const v = z
          .object({
            check: uuid,
            decision: z.enum(["approved", "observed"]),
            comment: z.string().max(2000),
          })
          .parse(raw);
        name = "review_check";
        args = {
          p_check: v.check,
          p_decision: v.decision,
          p_comment: v.comment,
        };
        break;
      }
      case "category": {
        const v = z
          .object({ company: uuid, name: z.string().trim().min(2).max(100) })
          .parse(raw);
        name = "create_category";
        args = { p_company: v.company, p_name: v.name };
        break;
      }
      case "fundStatus": {
        const v = z
          .object({ fund: uuid, active: z.enum(["true", "false"]) })
          .parse(raw);
        name = "set_fund_active";
        args = { p_fund: v.fund, p_active: v.active === "true" };
        break;
      }
      case "revokeInvitation": {
        const v = z.object({ id: uuid }).parse(raw);
        name = "revoke_invitation";
        args = { p_id: v.id };
        break;
      }
      case "company": {
        const v = schemas.company.parse(raw);
        name = "create_company";
        args = { p_name: v.name, p_nit: v.nit };
        break;
      }
      case "fund": {
        const v = schemas.fund.parse(raw);
        name = "create_fund";
        args = {
          p_company: v.company,
          p_name: v.name,
          p_kind: v.kind,
          p_opening: v.opening,
          p_key: v.key,
        };
        break;
      }
      case "movement": {
        const v = schemas.movement.parse(raw);
        if (v.kind === "transfer" && !v.destination)
          return { error: "Selecciona el fondo de destino." };
        name = "post_movement";
        args = {
          p_fund: v.fund,
          p_destination: v.kind === "transfer" ? v.destination : null,
          p_category: v.category || null,
          p_kind: v.kind,
          p_amount: v.amount,
          p_concept: v.concept,
          p_date: v.date,
          p_key: v.key,
        };
        break;
      }
      case "check": {
        const v = schemas.check.parse(raw);
        name = "record_check";
        args = { p_fund: v.fund, p_declared: v.declared, p_note: v.note };
        break;
      }
      case "review": {
        const v = schemas.review.parse(raw);
        name = "review_movement";
        args = {
          p_movement: v.movement,
          p_decision: v.decision,
          p_comment: v.comment,
        };
        break;
      }
      case "reversal": {
        const v = schemas.reversal.parse(raw);
        name = "reverse_movement";
        args = { p_movement: v.movement, p_reason: v.reason, p_key: v.key };
        break;
      }
      case "assignment": {
        const v = schemas.assignment.parse(raw);
        name = "assign_fund";
        args = { p_fund: v.fund, p_user: v.user, p_end: v.end === "true" };
        break;
      }
      case "member": {
        const v = schemas.member.parse(raw);
        name = "assign_member";
        args = { p_company: v.company, p_user: v.user, p_role: v.role };
        break;
      }
      case "memberStatus": {
        const v = schemas.memberStatus.parse(raw);
        name = "set_member_active";
        args = {
          p_company: v.company,
          p_user: v.user,
          p_active: v.active === "true",
        };
        break;
      }
      default:
        return { error: "Operación desconocida." };
    }
  } catch (error) {
    return {
      error:
        error instanceof z.ZodError
          ? error.issues[0].message
          : "Revisa los datos del formulario.",
    };
  }
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: publicError(error) };
  revalidatePath("/", "layout");
  return { success: "Operación guardada correctamente." };
}
export async function login(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!supabaseConfig())
    return { error: "Primero conecta el proyecto Supabase." };
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1).max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ingresa tu correo y contraseña." };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error)
    return {
      error:
        "No fue posible iniciar sesión. Comprueba tus credenciales e inténtalo de nuevo.",
    };
  await client.rpc("accept_invitations");
  redirect("/panel");
}
export async function logout() {
  const client = await createClient();
  const { error } = await client.auth.signOut();
  if (error) throw new Error("No fue posible cerrar la sesión.");
  redirect("/login");
}
export async function recoverPassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!supabaseConfig())
    return { error: "Primero conecta el proyecto Supabase." };
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Ingresa un correo válido." };
  const client = await createClient();
  const { error } = await client.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${appOrigin()}/auth/callback?next=/auth/password`,
  });
  if (error)
    return {
      error: "No fue posible solicitar la recuperación. Inténtalo más tarde.",
    };
  return {
    success:
      "Si el correo está registrado, recibirás instrucciones para recuperar tu acceso.",
  };
}
export async function changePassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const password = z.string().min(12).max(128).safeParse(form.get("password"));
  if (!password.success)
    return { error: "Utiliza una contraseña de al menos 12 caracteres." };
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: "No fue posible actualizar tu contraseña." };
  redirect("/panel");
}
