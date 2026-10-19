<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CUADRIA — reglas del proyecto

Leer `docs/PROGRESS.md` y comprobar `git status` antes de cambiar código. Repositorio único: `Lgomezg321/cuadria`. La especificación original está en `docs/REQUIREMENTS.md`. Conservar el bloque de Next.js anterior y estas reglas del proyecto.

## Arquitectura y convenciones

Next.js App Router, TypeScript estricto, Tailwind, componentes shadcn/ui y Lucide. Server Actions para mutaciones, Supabase Auth con cookies y PostgreSQL/RLS como autoridad de permisos. Dominio separado de componentes. UI y documentación en español, moneda COP, fechas America/Bogota. Sin datos simulados en producción, microservicios ni sincronización financiera offline.

## Reglas financieras

- Intercambiar dinero como cadenas decimales; usar bigint en TypeScript y numeric exacto validado en PostgreSQL. Nunca convertir importes a Number.
- Contabilización y revisión son independientes. Aprobar nunca agrega asientos.
- Asientos inmutables y correcciones mediante reversión compensatoria con actor/motivo.
- Operaciones atómicas, bloqueo de fondos en orden UUID, idempotencia por usuario/clave con comparación de contenido y prevención de sobregiros.
- Arqueos capturan saldo teórico bajo bloqueo y nunca ajustan automáticamente el saldo.
- Una apertura cero produce auditoría, sin inventar asientos de valor cero.

## Seguridad

- Membresías por empresa y asignaciones por fondo; no roles derivados de metadata controlable por cliente.
- Propietario de instalación no tiene acceso implícito a empresas sin membresía.
- RLS, permisos mínimos y SECURITY DEFINER con search_path fijo y autorización explícita.
- Comprobantes privados. Nada de claves privilegiadas en navegador, logs o Git.
- No afirmar conexiones, despliegues o pruebas que no estén verificados.
- El rol administrador de la aplicación nunca recibe acceso directo de escritura sobre asientos o permisos.

## Calidad y continuidad

Ejecutar `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Ejecutar `npm run test:e2e` y `npm run test:concurrency` cuando el entorno lo permita. Las pruebas PGlite no sustituyen Auth/Storage reales ni concurrencia entre conexiones. Concurrencia requiere una base PostgreSQL vacía y desechable: nunca producción.

Actualizar PROGRESS con evidencia, limitaciones y siguiente tarea. No declarar el MVP terminado sin circuito autenticado de aceptación, ni el piloto aprobado sin pruebas de seguridad, restauración y validación humana. Preservar el estado existente; no reconstruir módulos sin motivo.
