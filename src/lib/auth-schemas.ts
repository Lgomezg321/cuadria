import { z } from "zod";
import "./validation";

export const RECOVERY_EXPIRED_MESSAGE =
  "El enlace de recuperación venció antes de guardar. Solicita uno nuevo desde la página de ingreso.";

export const RECOVERY_REQUEST_MESSAGE =
  "Si el correo está registrado, recibirás instrucciones para recuperar tu acceso.";

const email = z
  .email("Ingresa un correo electrónico válido.")
  .max(254, "El correo es demasiado largo.");

export const loginSchema = z.object({
  email,
  password: z
    .string("Ingresa tu contraseña.")
    .min(1, "Ingresa tu contraseña.")
    .max(200, "La contraseña es demasiado larga."),
});

export const recoverySchema = z.object({ email });

const newPassword = z
  .string("Ingresa la nueva contraseña.")
  .min(12, "Utiliza una contraseña de al menos 12 caracteres.")
  .max(128, "Utiliza como máximo 128 caracteres.");

/**
 * In recovery/invitation mode the current password is not requested; in a
 * normal session it is mandatory. The confirmation must always match.
 */
export function passwordChangeSchema(recovery: boolean) {
  return z
    .object({
      currentPassword: recovery
        ? z.string().optional()
        : z
            .string("Ingresa tu contraseña actual.")
            .min(1, "Ingresa tu contraseña actual.")
            .max(200, "La contraseña es demasiado larga."),
      password: newPassword,
      confirmPassword: z.string("Repite la nueva contraseña."),
    })
    .refine((v) => v.password === v.confirmPassword, {
      path: ["confirmPassword"],
      message: "Las contraseñas no coinciden.",
    });
}
