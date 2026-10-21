import { z } from "zod";

/** Spanish names for form fields, used to prefix the summary error. */
export const fieldLabels: Record<string, string> = {
  name: "Nombre",
  nit: "NIT",
  company: "Empresa",
  fund: "Fondo",
  destination: "Fondo de destino",
  category: "Categoría",
  kind: "Tipo de movimiento",
  amount: "Valor",
  opening: "Saldo inicial",
  concept: "Concepto",
  date: "Fecha",
  cutoff: "Fecha de corte",
  declared: "Saldo real",
  note: "Observaciones",
  movement: "Movimiento",
  check: "Arqueo",
  decision: "Decisión",
  comment: "Comentario",
  body: "Comentario",
  reason: "Motivo",
  user: "Usuario",
  role: "Rol",
  end: "Acción",
  active: "Estado",
  email: "Correo electrónico",
  password: "Contraseña",
  currentPassword: "Contraseña actual",
  confirmPassword: "Confirmación de contraseña",
  key: "Clave de la solicitud",
  id: "Identificador",
  version: "Versión",
};

const formatMessages: Record<string, string> = {
  uuid: "Selecciona una opción válida.",
  guid: "Selecciona una opción válida.",
  email: "Ingresa un correo electrónico válido.",
  date: "Ingresa una fecha válida.",
  datetime: "Ingresa una fecha y hora válidas.",
  regex: "El formato no es válido.",
};

/**
 * Spanish zod error map. Schema-level messages (for example the money
 * schema) keep precedence over this map.
 */
export const spanishError: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null
        ? "Este campo es obligatorio."
        : "El valor no tiene el formato esperado.";
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string")
        return min <= 1
          ? "Este campo es obligatorio."
          : `Debe tener al menos ${min} caracteres.`;
      if (issue.origin === "number")
        return `Debe ser mayor o igual que ${min}.`;
      return "El valor es demasiado pequeño.";
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string")
        return `Debe tener como máximo ${max} caracteres.`;
      if (issue.origin === "number")
        return `Debe ser menor o igual que ${max}.`;
      return "El valor es demasiado grande.";
    }
    case "invalid_format":
      return formatMessages[issue.format] ?? "El formato no es válido.";
    case "invalid_value":
    case "invalid_union":
      return "Selecciona una opción válida.";
    case "not_multiple_of":
      return "El valor no es válido.";
    default:
      return "El valor no es válido.";
  }
};

z.config({ customError: spanishError });

export type ValidationState = {
  error: string;
  fieldErrors: Record<string, string>;
};

/** Converts a ZodError into a summary message plus one message per field. */
export function validationState(error: z.ZodError): ValidationState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  const first = error.issues[0];
  const field = String(first?.path[0] ?? "");
  const label = fieldLabels[field];
  const message = first?.message ?? "Revisa los datos del formulario.";
  const others = Object.keys(fieldErrors).length - 1;
  return {
    error:
      (label ? `${label}: ${message}` : message) +
      (others > 0
        ? ` Revisa también ${others === 1 ? "otro campo" : `otros ${others} campos`}.`
        : ""),
    fieldErrors,
  };
}
