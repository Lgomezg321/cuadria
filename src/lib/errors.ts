import { describeError, logServer } from "./log";
const messages: Record<string, string> = {
  INVITATION_RATE_LIMIT:
    "Espera un minuto antes de volver a invitar al mismo correo.",
  FUND_HAS_BALANCE:
    "Transfiere o registra movimientos autorizados para vaciar el saldo antes de desactivar el fondo.",

  DRAFT_CONFLICT:
    "El borrador cambió en otra sesión. Recarga antes de continuar.",
  UNREVIEWED_MOVEMENTS:
    "Debes revisar todos los movimientos contabilizados del período antes de cerrarlo.",
  INVALID_CUTOFF:
    "La fecha de corte no es válida o ya pertenece a un período cerrado.",
  CHECK_ALREADY_APPROVED:
    "Este arqueo o conciliación ya fue aprobado; su historial permanece cerrado.",

  FORBIDDEN: "No tienes permiso para realizar esta operación.",
  INVALID_MEMBER:
    "El usuario debe pertenecer a la empresa con rol de empleado.",
  INSUFFICIENT_FUNDS: "El fondo no tiene saldo suficiente.",
  IDEMPOTENCY_CONFLICT:
    "La solicitud ya fue utilizada con otros datos. Recarga el formulario.",
  PERIOD_CLOSED: "La fecha pertenece a un período cerrado.",
  INVALID_REVERSAL: "Este movimiento ya fue reversado o no admite reversión.",
  INVALID_REVIEW: "La revisión no es válida para este movimiento.",
  INVALID_DESTINATION: "Selecciona otro fondo autorizado de la misma empresa.",
  INVALID_DATE: "La fecha de operación no puede estar en el futuro.",
};
export function publicError(error: { message: string; code?: string }): string {
  for (const [code, message] of Object.entries(messages))
    if (error.message.includes(code)) return message;
  if (error.code === "23505") return "Ya existe un registro con estos datos.";
  if (error.code === "23503")
    return "El registro relacionado no existe o no pertenece a esta empresa.";
  logServer("warn", "rpc.unmapped_error", describeError(error));
  return "No fue posible guardar la operación. Revisa los datos y vuelve a intentarlo.";
}

export const CAPTCHA_REQUIRED_MESSAGE =
  "Completa la verificación de seguridad antes de continuar.";
export const CAPTCHA_FAILED_MESSAGE =
  "No pudimos validar la verificación de seguridad. Inténtalo de nuevo.";
export const RATE_LIMIT_MESSAGE =
  "Demasiados intentos en poco tiempo. Espera unos minutos y vuelve a intentarlo.";
export const AUTH_UNAVAILABLE_MESSAGE =
  "El servicio de autenticación no respondió. Es un fallo temporal: vuelve a intentarlo en unos minutos.";

/** Spanish message for Supabase Auth errors raised while changing a password. */
export function passwordUpdateError(error: {
  code?: string;
  status?: number;
}): string {
  switch (error.code) {
    case "same_password":
      return "La nueva contraseña debe ser distinta de la actual.";
    case "weak_password":
      return "La contraseña no cumple la política de seguridad: usa al menos 12 caracteres y evita contraseñas comunes o filtradas.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return "Por seguridad debes confirmar tu identidad de nuevo. Cierra sesión, vuelve a ingresar e inténtalo otra vez.";
    case "over_request_rate_limit":
      return RATE_LIMIT_MESSAGE;
    case "captcha_failed":
      return CAPTCHA_FAILED_MESSAGE;
  }
  if (error.status === 429) return RATE_LIMIT_MESSAGE;
  return "No fue posible actualizar tu contraseña. Inténtalo de nuevo.";
}
