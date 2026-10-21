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
  MEMBER_NOT_FOUND:
    "La persona no es miembro de la empresa. Las altas se hacen únicamente por invitación.",
  MEMBER_INACTIVE:
    "La membresía está desactivada. Reactívala antes de cambiar su rol.",
  PROTECTED_MEMBER:
    "La membresía del propietario o del creador de la empresa no se puede modificar.",
  ADMIN_CHANGE_RESTRICTED:
    "Solo el creador de la empresa o el propietario de la instalación pueden otorgar, cambiar o desactivar el rol de administrador.",
  LAST_ACTIVE_ADMIN:
    "La empresa debe conservar al menos un administrador activo.",
  INVALID_ROLE: "Selecciona un rol válido.",
  INVALID_STATUS: "Selecciona un estado válido.",
  MEMBERSHIP_EXISTS:
    "Esa persona ya es miembro de la empresa. Cambia su rol o reactívala desde la lista de miembros.",
  INVITATION_ACTOR_DAILY_LIMIT:
    "Alcanzaste el límite de 20 invitaciones en 24 horas. Inténtalo más tarde.",
  INVITATION_COMPANY_DAILY_LIMIT:
    "La empresa alcanzó el límite de 50 invitaciones en 24 horas. Inténtalo más tarde.",
  ASSIGNMENT_NOT_FOUND:
    "La persona no tiene una responsabilidad vigente en este fondo.",
  ALREADY_ASSIGNED: "La persona ya es responsable vigente de este fondo.",
  INVALID_RECEIPT:
    "El comprobante debe ser JPG, PNG o PDF, tener nombre y pesar como máximo 10 MB.",
  RECEIPT_LIMIT:
    "Este movimiento alcanzó el límite de comprobantes o de cargas pendientes. Espera a que venzan las cargas pendientes o revisa los adjuntos.",
  RECEIPT_NOT_UPLOADED:
    "El archivo todavía no aparece en el almacenamiento privado. Vuelve a intentarlo en unos segundos.",
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
