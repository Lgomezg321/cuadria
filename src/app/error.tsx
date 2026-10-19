"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-semibold">
        No pudimos completar la consulta
      </h1>
      <p className="my-5 text-stone-500">
        Revisa la conexión y la configuración del servicio. No se mostrarán
        saldos mientras no sea posible consultar los datos.
      </p>
      <Button onClick={reset}>Volver a intentar</Button>
    </main>
  );
}
