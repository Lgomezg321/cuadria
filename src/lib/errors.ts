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
  FUND_INACTIVE:
    "Uno de los fondos afectados está inactivo. Reactívalo antes de registrar la reversión.",
  HISTORICAL_OVERDRAFT:
    "Con esa fecha el fondo quedaría con saldo negativo en algún día posterior. Usa una fecha más reciente o registra antes los ingresos que lo cubren.",
  DATE_BEFORE_FUND_OPENING:
    "La fecha de operación es anterior a la apertura del fondo.",
  NEGATIVE_CLOSING_BALANCE:
    "El saldo del período sería negativo. Corrige los movimientos antes de cerrarlo.",
  REVIEW_REASON_REQUIRED:
    "Indica el motivo para observar un movimiento que ya estaba aprobado.",
  INVALID_STATUS_TRANSITION:
    "El estado actual del movimiento no admite ese cambio.",
  INVALID_REQUEST: "La solicitud está incompleta. Recarga el formulario.",
  cop_check:
    "El importe o el saldo resultante supera el máximo permitido (18 dígitos en COP).",
  "violates check constraint":
    "Los datos no cumplen las reglas de validación. Revisa importes, fechas y textos.",
};
export function publicError(error: { message: string; code?: string }): string {
  for (const [code, message] of Object.entries(messages))
    if (error.message.includes(code)) return message;
  if (error.code === "23505") return "Ya existe un registro con estos datos.";
  if (error.code === "23503")
    return "El registro relacionado no existe o no pertenece a esta empresa.";
  return "No fue posible guardar la operación. Revisa los datos y vuelve a intentarlo.";
}
