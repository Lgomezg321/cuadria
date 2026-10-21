"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createEphemeralClient } from "@/lib/supabase/server";
import { supabaseConfig, appOrigin, turnstileSiteKey } from "@/lib/env";
import { inRecoveryMode, isTransientAuthError, requireUser } from "@/lib/auth";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_REQUIRED_MESSAGE,
  passwordUpdateError,
  publicError,
  RATE_LIMIT_MESSAGE,
} from "@/lib/errors";
import { describeError, logServer } from "@/lib/log";
import { validationState } from "@/lib/validation";
import {
  loginSchema,
  passwordChangeSchema,
  RECOVERY_REQUEST_MESSAGE,
  recoverySchema,
} from "@/lib/auth-schemas";
import { AUTH_COOKIE_PATH, RECOVERY_COOKIE } from "@/lib/auth-flow";
import { moneySchema, positiveMoneySchema } from "@/lib/domain/money";
export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
};
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
    key: uuid,
  }),
  review: z.object({
    movement: uuid,
    decision: z.enum(["approved", "observed"]),
    comment: z.string().max(2000),
    key: uuid,
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
            key: uuid,
          })
          .parse(raw);
        name = "review_check";
        args = {
          p_check: v.check,
          p_decision: v.decision,
          p_comment: v.comment,
          p_key: v.key,
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
        args = {
          p_fund: v.fund,
          p_declared: v.declared,
          p_note: v.note,
          p_key: v.key,
        };
        break;
      }
      case "review": {
        const v = schemas.review.parse(raw);
        name = "review_movement";
        args = {
          p_movement: v.movement,
          p_decision: v.decision,
          p_comment: v.comment,
          p_key: v.key,
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
    if (error instanceof z.ZodError) return validationState(error);
    logServer("warn", "action.validation_failed", describeError(error));
    return { error: "Revisa los datos del formulario." };
  }
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: publicError(error) };
  revalidatePath("/", "layout");
  return { success: "Operación guardada correctamente." };
}
/** Reads the optional Turnstile token; null means "required but missing". */
function captchaFrom(form: FormData): { captchaToken?: string } | null {
  if (!turnstileSiteKey()) return {};
  const token = form.get("captchaToken");
  return typeof token === "string" && token.length > 0 && token.length < 4096
    ? { captchaToken: token }
    : null;
}
async function acceptPendingInvitations(
  client: Awaited<ReturnType<typeof createClient>>,
) {
  const { error } = await client.rpc("accept_invitations");
  if (error)
    logServer("warn", "auth.accept_invitations_failed", describeError(error));
}
export async function login(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!supabaseConfig())
    return { error: "Primero conecta el proyecto Supabase." };
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return validationState(parsed.error);
  const captcha = captchaFrom(form);
  if (!captcha) return { error: CAPTCHA_REQUIRED_MESSAGE };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword({
    ...parsed.data,
    options: captcha,
  });
  if (error) {
    if (error.code === "captcha_failed")
      return { error: CAPTCHA_FAILED_MESSAGE };
    if (error.status === 429 || error.code === "over_request_rate_limit")
      return { error: RATE_LIMIT_MESSAGE };
    if (isTransientAuthError(error)) {
      logServer("error", "auth.login_unavailable", describeError(error));
      return { error: AUTH_UNAVAILABLE_MESSAGE };
    }
    if (error.code !== "invalid_credentials")
      logServer("warn", "auth.login_failed", describeError(error));
    return {
      error:
        "No fue posible iniciar sesión. Comprueba tus credenciales e inténtalo de nuevo.",
    };
  }
  await acceptPendingInvitations(client);
  redirect("/panel");
}
export async function logout() {
  const client = await createClient();
  const { error } = await client.auth.signOut();
  if (error) {
    logServer("error", "auth.logout_failed", describeError(error));
    throw new Error("No fue posible cerrar la sesión.");
  }
  redirect("/login");
}
export async function recoverPassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!supabaseConfig())
    return { error: "Primero conecta el proyecto Supabase." };
  const email = recoverySchema.safeParse(Object.fromEntries(form));
  if (!email.success) return validationState(email.error);
  const captcha = captchaFrom(form);
  if (!captcha) return { error: CAPTCHA_REQUIRED_MESSAGE };
  const client = await createClient();
  const { error } = await client.auth.resetPasswordForEmail(email.data.email, {
    redirectTo: `${appOrigin()}/auth/callback?next=/auth/password`,
    ...captcha,
  });
  if (error) {
    // CAPTCHA failures do not depend on the account, so they can be shown.
    if (error.code === "captcha_failed")
      return { error: CAPTCHA_FAILED_MESSAGE };
    // Anything else (unknown e-mail, rate limit, SMTP) gets the same answer
    // to avoid account enumeration; the cause is only logged.
    logServer("warn", "auth.recovery_failed", describeError(error));
  }
  return { success: RECOVERY_REQUEST_MESSAGE };
}
export async function changePassword(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const recovery = await inRecoveryMode(supabase);
  const parsed = passwordChangeSchema(recovery).safeParse(
    Object.fromEntries(form),
  );
  if (!parsed.success) return validationState(parsed.error);
  const { password, currentPassword } = parsed.data;
  if (recovery) {
    // Session opened minutes ago from a verified e-mail link.
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      logServer("warn", "auth.password_update_failed", describeError(error));
      return { error: passwordUpdateError(error) };
    }
  } else {
    if (!user.email || !currentPassword)
      return { error: "No fue posible verificar tu identidad." };
    const captcha = captchaFrom(form);
    if (!captcha) return { error: CAPTCHA_REQUIRED_MESSAGE };
    // Verify the current password on an isolated client and update with
    // that fresh session, which also satisfies Supabase "secure password
    // change" without depending on e-mail delivery of a nonce.
    const verifier = createEphemeralClient();
    try {
      const { data, error } = await verifier.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
        options: captcha,
      });
      if (error || data.user?.id !== user.id) {
        if (error?.code === "captcha_failed")
          return { error: CAPTCHA_FAILED_MESSAGE };
        if (error?.status === 429) return { error: RATE_LIMIT_MESSAGE };
        if (error && isTransientAuthError(error)) {
          logServer("error", "auth.reauth_unavailable", describeError(error));
          return { error: AUTH_UNAVAILABLE_MESSAGE };
        }
        if (error?.code !== "invalid_credentials")
          logServer("warn", "auth.reauth_failed", describeError(error));
        const message = "La contraseña actual no es correcta.";
        return { error: message, fieldErrors: { currentPassword: message } };
      }
      const { error: updateError } = await verifier.auth.updateUser({
        password,
      });
      if (updateError) {
        logServer(
          "warn",
          "auth.password_update_failed",
          describeError(updateError),
        );
        return { error: passwordUpdateError(updateError) };
      }
    } finally {
      const { error } = await verifier.auth.signOut({ scope: "local" });
      if (error)
        logServer("warn", "auth.reauth_signout_failed", describeError(error));
    }
  }
  // Close every other session (stolen or forgotten devices included).
  const { error: othersError } = await supabase.auth.signOut({
    scope: "others",
  });
  if (othersError)
    logServer(
      "error",
      "auth.signout_others_failed",
      describeError(othersError),
    );
  (await cookies()).delete({ name: RECOVERY_COOKIE, path: AUTH_COOKIE_PATH });
  redirect("/panel");
}
