"use client";
import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { mutate, type ActionState } from "@/app/actions";
export function ActionForm({
  children,
  operation,
  submit = "Guardar",
  action = mutate,
}: {
  children: ReactNode;
  operation?: string;
  submit?: string;
  action?: (state: ActionState, data: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {operation && <input type="hidden" name="operation" value={operation} />}
      {children}
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {state.success}{" "}
          <a
            className="underline"
            href={
              typeof window === "undefined" ? "#" : window.location.pathname
            }
          >
            Nueva operación
          </a>
        </p>
      )}
      <Button disabled={pending || !!state.success} type="submit">
        {pending ? "Guardando…" : submit}
      </Button>
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  placeholder,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        minLength={minLength}
        maxLength={maxLength}
        inputMode={
          name === "amount" || name === "opening" || name === "declared"
            ? "numeric"
            : undefined
        }
      />
    </label>
  );
}
