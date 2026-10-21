"use client";
import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { Button } from "@/components/ui/button";
import { mutate, type ActionState } from "@/app/actions";

export const STALE_DEPLOYMENT_MESSAGE =
  "CUADRIA se actualizó. Recarga la página; la operación no se registró.";

type FormState = ActionState & { stale?: boolean };
type FormContextValue = { state: FormState; formId: string };
const FormContext = createContext<FormContextValue | null>(null);

/** Current result of the enclosing ActionForm (null outside a form). */
export function useActionFormState(): FormContextValue | null {
  return useContext(FormContext);
}

export function fieldErrorId(formId: string, name: string): string {
  return `${formId}-${name}-error`;
}

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
  const formId = useId();
  const [state, formAction, pending] = useActionState(
    async (previous: FormState, data: FormData): Promise<FormState> => {
      try {
        return await action(previous, data);
      } catch (error) {
        // A client left on an older deployment calls an action id that no
        // longer exists: the server rejected it before running anything.
        if (unstable_isUnrecognizedActionError(error))
          return { error: STALE_DEPLOYMENT_MESSAGE, stale: true };
        throw error;
      }
    },
    {},
  );
  // Submitting through a transition (instead of the native form action)
  // keeps what the user typed when the server answers with an error.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }
  return (
    <FormContext.Provider value={{ state, formId }}>
      <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
        {operation && (
          <input type="hidden" name="operation" value={operation} />
        )}
        {children}
        {state.error && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{state.error}</p>
            {state.link &&
              state.link.href.startsWith("/") &&
              !state.link.href.startsWith("//") && (
                <a
                  className="mt-2 inline-block underline"
                  href={state.link.href}
                >
                  {state.link.label}
                </a>
              )}
            {state.stale && (
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => window.location.reload()}
              >
                Recargar la página
              </Button>
            )}
          </div>
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
                typeof window === "undefined"
                  ? "#"
                  : window.location.pathname + window.location.search
              }
            >
              Nueva operación
            </a>
          </p>
        )}
        <Button
          disabled={pending || !!state.success || !!state.stale}
          type="submit"
        >
          {pending ? "Guardando…" : submit}
        </Button>
      </form>
    </FormContext.Provider>
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
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
}) {
  const form = useActionFormState();
  const error = form?.state.fieldErrors?.[name];
  const errorId = form ? fieldErrorId(form.formId, name) : undefined;
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
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode={
          name === "amount" || name === "opening" || name === "declared"
            ? "numeric"
            : undefined
        }
      />
      {error && (
        <span id={errorId} className="text-xs font-normal text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}
