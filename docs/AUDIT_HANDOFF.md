# CUADRIA — entrega para auditoría independiente

Fecha de corte: **20 de octubre de 2026, America/Bogota**. Este documento describe la implementación y la evidencia disponible; **no es un dictamen de auditoría ni una aprobación para operar con dinero real**. La revisión independiente todavía debe ejecutarse. No contiene credenciales ni datos de operación de clientes.

## 1. Alcance y versión exacta

| Referencia                                        | Valor                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Repositorio                                       | [Lgomezg321/cuadria](https://github.com/Lgomezg321/cuadria)                                   |
| Rama de trabajo                                   | `codex/cuadria-foundation`                                                                    |
| Commit objeto de auditoría (código y migraciones) | `53555289b92090de0867d9d60f15d5db5f983037`                                                    |
| Commit documental local anterior a esta entrega   | `e06c5ca4e8fdb18f1769c2dae6a2cfd35190e1e8`                                                    |
| Commit de la Preview verificada                   | `86b03b2296b26d760a9c0e8cd2486b4cb0bc9900`                                                    |
| Último despliegue comprobado                      | `7TCzn1HRfgWzEfYUGgSnJbykc7XA`, proyecto Vercel `cuadria`, Preview, estado Ready              |
| `main` comprobado al preparar esta entrega        | `81928fb5625d6b9daf77c37fae4f09d786fdd8c8` (commit inicial; no contiene la aplicación actual) |

Los commits posteriores al objetivo, hasta el estado descrito en esta entrega, solo cambian documentación. Se comprobó con `git diff --stat 5355528 HEAD`. Esta entrega también modifica únicamente documentación. El SHA del commit que publica este archivo se obtiene con `git log -1 --format=%H -- docs/AUDIT_HANDOFF.md`; no debe confundirse con el commit de código probado.

Auditar el repositorio completo: interfaz, Server Actions, SQL, permisos, sesiones, Storage, reportes, dependencias y despliegue. La configuración de los servicios externos puede cambiar sin un commit: las observaciones remotas siguientes son una fotografía de la fecha indicada, no una garantía del estado futuro.

### Lectura inicial

1. [AGENTS.md](../AGENTS.md): reglas técnicas y financieras del proyecto.
2. [REQUIREMENTS.md](REQUIREMENTS.md): especificación solicitada, no evidencia de implementación.
3. [ARCHITECTURE.md](ARCHITECTURE.md) y [DATABASE.md](DATABASE.md): diseño y esquema.
4. [PROGRESS.md](PROGRESS.md): bitácora de avances, pruebas e incidentes.
5. [DEPLOYMENT.md](DEPLOYMENT.md): instalación y configuración.
6. [ACCEPTANCE.md](ACCEPTANCE.md): circuito real de 20 pasos y casos adicionales; aún sin acta completa de ejecución.

Algunas secciones anteriores de esos documentos describen estados históricos. En particular, DATABASE enumera seis migraciones, pero el directorio contiene siete; DEPLOYMENT conserva párrafos anteriores a la configuración de empresa y SMTP. Contrastar siempre con archivos ejecutables, evidencia fechada y las secciones recientes de PROGRESS. No asumir que una descripción de diseño demuestra que el sistema la cumple.

## 2. Arquitectura y mapa del código

Aplicación modular Next.js App Router, sin microservicios. `package.json` declara Next.js 16.4.2, React 19.3.0 y Node.js 24; `package-lock.json` fija las dependencias reproducibles. TypeScript estricto, Tailwind 4, Lucide y Button con Radix Slot/CVA siguiendo el patrón shadcn/ui. UI en español, importes COP y fechas operativas America/Bogota.

| Capa                       | Archivos o directorios que revisar                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Rutas y mutaciones         | `src/app/`, especialmente `actions.ts`, `invitation-actions.ts` y las demás Server Actions   |
| Formularios y presentación | `src/components/`, especialmente `action-form.tsx`                                           |
| Dominio puro               | `src/lib/domain/money.ts`, `receipt.ts`, `reports.ts`                                        |
| Identidad y acceso         | `src/lib/auth.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts`                              |
| Consultas y reportes       | `src/lib/data.ts`, `src/lib/reports.ts`, rutas CSV/PDF en `src/app/`                         |
| Configuración y errores    | `src/lib/env.ts`, `src/lib/errors.ts`, `src/app/error.tsx`                                   |
| Entrada por correo         | `src/app/auth/callback/route.ts`, `src/app/auth/password/`                                   |
| Autoridad de datos         | `supabase/migrations/`, `supabase/bootstrap-owner.sql`                                       |
| Verificación automática    | `tests/`, `scripts/test-concurrency.mjs`, `playwright.config.ts`, `.github/workflows/ci.yml` |

Flujo normal: navegador → Server Action con sesión → cliente Supabase del usuario → RPC/PostgreSQL con autorización y transacción. Las lecturas usan RLS. Auth SSR utiliza cookies y el Proxy renueva la sesión; `requireUser` valida al usuario en el servidor. Comprobar tanto rutas como mutaciones y peticiones directas a PostgREST: ocultar un botón no es un control de acceso.

Las invitaciones son una excepción acotada: primero se autoriza y persiste el rol con `create_invitation` usando la sesión del usuario; después un cliente administrativo llama a Auth Admin para enviar el correo. La clave administrativa no debe intervenir en lecturas ni movimientos financieros.

### Migraciones, en orden

1. `202610190001_core.sql`: dinero, empresas, miembros, fondos, asignaciones, movimientos, asientos, revisión, arqueos, auditoría, RLS y RPCs.
2. `202610190002_receipts.sql`: comprobantes privados y políticas de Storage.
3. `202610190003_drafts_closures.sql`: borradores, revisión de arqueos y cierres.
4. `202610190004_reports.sql`: totales y detalle paginado de reportes.
5. `202610190005_administration.sql`: invitaciones, categorías, estado de fondos, directorio y alertas.
6. `202610190006_audit_conversation.sql`: comentarios y detalle histórico de movimientos.
7. `202610200001_private_requests_rls.sql`: protección RLS de idempotencia privada.

Las migraciones reales requieren los componentes Auth y Storage de Supabase. Los sustitutos creados por las pruebas no deben ejecutarse sobre el proyecto existente.

## 3. Implementado frente a verificado

“Implementado” indica presencia de código. “Automático” indica cobertura del conjunto de pruebas, sin afirmar exhaustividad. “Remoto” describe observaciones de la instalación realizadas durante su configuración.

| Área                   | Implementado                                                                   | Evidencia disponible                                                                                    | Falta verificar                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Identidad y empresas   | Login, propietario, creación de empresa, membresías                            | Remoto: sesión del propietario persistió al recargar; empresa creada por el usuario visible en Empresas | Ciclo completo con varias cuentas, vencimiento y retirada de acceso                                    |
| Invitaciones           | Rol por empresa, aceptación con correo confirmado, expiración y revocación SQL | Automático: casos SQL; remoto: secreto de servidor, SMTP y plantillas guardados                         | Entrega, apertura y aceptación por destinatario; cuenta existente, expiración y reintentos HTTP reales |
| Fondos y movimientos   | Apertura, ingresos, egresos, transferencias, reversiones                       | SQL/dominio y cuatro escenarios concurrentes en PostgreSQL                                              | Circuito real autenticado completo y concurrencia por HTTP                                             |
| Revisión y auditoría   | Aprobar/observar, historial y conversación inmutables                          | Casos SQL                                                                                               | Flujo autor → revisor → respuesta en sesiones reales                                                   |
| Borradores y cierres   | Versionado, envío, cierre por fecha y bloqueo de períodos                      | Casos SQL y carrera cierre/registro                                                                     | Circuito completo remoto y manejo visual de conflictos                                                 |
| Comprobantes           | Reserva, carga JPG/PNG/PDF, URLs firmadas y visor                              | Pruebas de validación/SQL; bucket privado remoto comprobado                                             | Carga/lectura/rechazo con JWT reales, expiración de enlaces, visor y fallos de carga                   |
| Reportes               | Totales, filtros, detalle paginado, CSV y PDF                                  | Pruebas de dominio/SQL; protección E2E sin configuración                                                | Conciliación con registros reales de prueba y exportaciones de gran tamaño                             |
| Interfaz móvil         | Diseño adaptable                                                               | Tres escenarios Playwright en dos perfiles: escritorio y móvil                                          | Operación móvil autenticada completa, accesibilidad y usabilidad                                       |
| Recuperación operativa | Documentación del ensayo                                                       | Ninguna restauración demostrada                                                                         | Backup de base y Storage, restauración, objetivos de recuperación y aprobación del piloto              |

El usuario indicó que la app quedó lista. Esa confirmación no sustituye resultados por caso ni acredita recepción de correo, aceptación de un invitado o restauración.

## 4. Invariantes financieros que debe desafiar el auditor

- **Exactitud:** COP enteros; JSON monetario en cadenas, TypeScript `bigint`, dominio PostgreSQL `cop` sobre `numeric` con validación de integridad. Máximo absoluto declarado: `999999999999999999`. Probar negativos, fracciones, límites, overflow y formatos inesperados; no introducir `Number` para importes.
- **Asientos y saldo:** asientos inmutables, saldo como proyección actualizada en la misma transacción. Comparar la suma de asientos con el saldo persistido tras éxito, error y carrera concurrente.
- **No sobregiro:** bloquear los fondos antes de comprobar saldo. En transferencias, bloquear por UUID ascendente para reducir interbloqueos. Un fallo debe deshacer toda la operación.
- **Idempotencia:** actor/clave y comparación del contenido; reintento idéntico devuelve el resultado anterior, contenido distinto debe rechazarse. Probar aperturas cero y no cero, movimientos, borradores y comentarios según cada RPC.
- **Transferencia:** dos asientos opuestos en la misma empresa y transacción; no cambia el total conjunto. Revisar los permisos sobre origen y destino.
- **Contabilización y revisión separadas:** aprobar u observar no crea asientos ni vuelve a descontar dinero. El revisor de movimientos y arqueos debe ser distinto del autor.
- **Reversión:** operación compensatoria única con motivo y actor; conserva el original. No modifica cierres históricos ni permite sobregiro. Aperturas y reversiones no admiten reversión ordinaria.
- **Apertura cero:** evento de auditoría sin asiento monetario ficticio.
- **Arqueos:** capturan saldo teórico bajo bloqueo; diferencia declarada no ajusta automáticamente el saldo. Conciliación bancaria actual es una declaración al momento, no una conciliación histórica automatizada.
- **Cierres:** fecha inclusive, totales e IDs congelados; rechazar registros tardíos y cambios de revisión en períodos cerrados. Una corrección se contabiliza en un período abierto.
- **Reportes:** saldo inicial + aperturas + ingresos − egresos + transferencias netas + reversiones netas = saldo final. Los filtros del detalle no deben alterar el saldo completo del fondo.

## 5. Seguridad y límites de confianza

Roles: propietario de instalación, `admin`, `employee`, `auditor`. El propietario crea empresas y obtiene membresía explícita en ellas; no tiene lectura global implícita. Administrador de aplicación no equivale a administrador PostgreSQL. Empleado depende de membresía activa y asignación vigente al fondo; auditor tiene lectura dentro de su empresa. No derivar privilegios de metadata modificable por el cliente.

Revisar RLS, grants, claves compuestas entre empresa/fondo/categoría, funciones `SECURITY DEFINER` con `search_path` fijo y controles de actor. Los clientes no deben escribir directamente asientos o permisos. Inspeccionar también `EXECUTE`, acceso anónimo, esquemas privados y políticas de `storage.objects`. RLS habilitada por sí sola no demuestra aislamiento correcto.

Comprobantes: bucket privado `receipts`, máximo 10 MiB, JPG/PNG/PDF. Validación de MIME, tamaño y firma inicial; **no hay antivirus ni interpretación completa del archivo**. URL firmada de 60 segundos después de autorizar; mientras vive actúa como credencial temporal. Revisar rutas, reservas huérfanas, cargas fallidas, caducidad, sobrescritura y borrado.

Invitaciones: duran siete días en el dominio de empresa; el token Auth tiene su propia vigencia. Aceptación basada en correo confirmado de Auth, sin reemplazar una membresía existente. Persistencia y envío no son una transacción distribuida: si el envío falla, puede quedar una invitación pendiente. Revisar tasa de reintentos, doble aceptación, revocación, correo normalizado y fallos de red.

Variables (solo nombres; obtener valores por un canal seguro para un entorno de prueba):

| Variable/configuración                 | Uso                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL del proyecto de prueba                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable, cuyo acceso depende de RLS                                          |
| `NEXT_PUBLIC_APP_URL`                  | Origen exacto permitido para retornos de Auth                                         |
| `SUPABASE_SERVICE_ROLE_KEY`            | Secreto exclusivo del servidor para invitaciones; nunca prefijarlo con `NEXT_PUBLIC_` |
| SMTP                                   | Configurado en Supabase Auth; contraseña fuera de Git, chat y evidencias              |
| `CUADRIA_TEST_DATABASE_URL`            | Exclusivamente PostgreSQL vacío y desechable para concurrencia                        |

No publicar `.env.local`, cookies, JWT, enlaces de recuperación/invitación reales, URLs firmadas, volcados, claves administrativas ni contraseñas SMTP. El repositorio es público al corte de esta entrega. Usar identidades y documentos sintéticos en evidencias. Este documento no concede autorización para enviar correos, cambiar permisos, desactivar protecciones, operar sobre datos reales o contratar servicios.

## 6. Estado remoto observado y asuntos de despliegue

- Supabase existente `cuadria`: siete migraciones registradas, 17 tablas públicas con RLS, protección de idempotencia privada, bucket privado y registro público deshabilitado. Comprobaciones remotas previas: lectura anónima de empresas rechazada con 401/42501 y listado de buckets vacío para anónimos. Falta una matriz completa con JWT de múltiples usuarios.
- Vercel canónico `cuadria`: Next.js, Node 24 y Preview de la rama de trabajo. `main` sigue en el commit inicial. La Preview no es una publicación de producción validada.
- Secreto administrativo guardado como Secret únicamente para `codex/cuadria-foundation`. Las tres variables públicas están en Preview. El despliegue `7TCzn1HRfgWzEfYUGgSnJbykc7XA` se verificó Ready después del cambio.
- SMTP Gmail temporal guardado por el propietario; Supabase mostró contraseña almacenada oculta. Plantillas de invitación y recuperación en español con `token_hash`, tipos `invite`/`recovery` y destino `/auth/password`; se comprobó su vista previa. No hay prueba documentada de entrega. El propietario rechazó enviar el correo de recuperación de prueba y eligió probar la invitación personalmente; no repetirlo sin autorización.
- Site URL corresponde a la Preview. Hay cuatro callbacks exactos para Preview/local, con y sin `next=/auth/password`. Verificar nuevamente al cambiar dominio o entorno.
- La Preview conserva Vercel Authentication y puede impedir el acceso de destinatarios externos. Resolver el acceso o publicar un entorno apropiado con autorización; no quitar esa protección durante una auditoría por iniciativa propia.
- Existen cuatro proyectos Vercel conectados al repositorio. Revisar duplicación y aislamiento antes del piloto; reutilizar el canónico. No hay evidencia de una separación completa de datos entre Preview y producción.

**Incidente conocido:** después de un redespliegue, una pestaña antigua envió una Server Action cuyo identificador ya no existía. Los logs mostraron HTTP 409 `Failed to find Server Action` en `/empresas` a las 14:12:15 y 14:12:42 de Bogotá del 20 de octubre. El rechazo ocurrió antes de ejecutar la invitación. Una recarga completa recuperó el formulario. No se desplegó una corrección de código. La pantalla genérica lo presentó como fallo de consulta; revisar recuperación de formularios abiertos durante despliegues y claridad del error. No atribuir este incidente a SMTP ni usarlo como evidencia de correo enviado.

## 7. Evidencia automática y sus límites

[Quality 39417194748](https://github.com/Lgomezg321/cuadria/actions/runs/39417194748), commit `53555289b92090de0867d9d60f15d5db5f983037`, job `118608975500`: estado `completed/success` y pasos de instalación, lint, tipos, tests, concurrencia, build, Playwright y auditoría de dependencias reconfirmados mediante GitHub al preparar esta entrega.

La bitácora de esa ejecución registra **70 pruebas SQL/unitarias**, **4 escenarios concurrentes** y **6 E2E**, además de auditoría de producción sin vulnerabilidades reportadas en ese momento. Una consulta nueva de advisories puede dar resultados distintos.

- SQL local usa PGlite con sustitutos mínimos de Auth/Storage. No prueba JWT reales, servicio Auth, correo ni HTTP Storage.
- Concurrencia usa PostgreSQL 17 y conexiones separadas: sobregiro, ocho reintentos idempotentes, transferencias opuestas y cierre contra contabilización tardía. Comprueba espera real de locks; sigue usando sustitutos de Auth/Storage.
- Playwright ejecuta tres escenarios en escritorio y móvil: portada/configuración, protección de rutas sin configuración y login sin conectar. **No son seis recorridos financieros autenticados.**
- Restricciones observadas en el equipo local: Chromium CLI no inició por permisos de macOS; PostgreSQL nativo falló con `shmget`; Turbopack local encontró restricción al abrir un puerto para CSS. CI Linux sí completó sus pasos. `npm run build -- --webpack` compiló localmente como alternativa documentada, no como sustituto del resultado Turbopack en CI.
- Esta entrega es documental: no se presenta como una nueva ejecución de todas las pruebas ni como una auditoría independiente ya completada.

## 8. Reproducir las comprobaciones

### 8.1 Checkout aislado

Requisitos: Git, Node.js 24, npm, y un entorno Linux/CI o máquina que permita Chromium y PostgreSQL. Usar un directorio nuevo sin `.env.local` de la instalación ni variables de producción heredadas.

```sh
git clone --branch codex/cuadria-foundation https://github.com/Lgomezg321/cuadria.git cuadria-audit
cd cuadria-audit
# Leer/guardar esta guía antes de cambiar al commit objetivo, donde todavía no existía.
git switch --detach 53555289b92090de0867d9d60f15d5db5f983037
git rev-parse HEAD
npm ci
npm run lint
npm run typecheck
npm test
```

Para revisar la rama actual en lugar del objetivo histórico, registrar su SHA completo y el diff respecto de `5355528`; no trasladar automáticamente el resultado histórico de CI a código diferente.

### 8.2 Concurrencia en base desechable

Usar una instancia nueva PostgreSQL 17 con usuario capaz de crear los roles/esquemas del harness. El script rechaza bases con tablas en `public`, `auth` o `storage`; no limpia ni restaura datos. Una repetición necesita otra base vacía.

Ejemplo con Docker, puerto local 55432 disponible y nombre de contenedor no utilizado. La contraseña siguiente es un valor público exclusivo de esta instancia desechable:

```sh
docker run --name cuadria-audit-pg --rm -d \
  -e POSTGRES_PASSWORD=cuadria-test-only \
  -e POSTGRES_DB=cuadria_test \
  -p 127.0.0.1:55432:5432 postgres:17
docker exec cuadria-audit-pg pg_isready -U postgres -d cuadria_test
# Continuar cuando pg_isready indique que acepta conexiones.
CUADRIA_TEST_DATABASE_URL='postgresql://postgres:cuadria-test-only@127.0.0.1:55432/cuadria_test' npm run test:concurrency
# Detiene y elimina únicamente este contenedor desechable creado arriba.
docker stop cuadria-audit-pg
```

Nunca sustituir la URL del ejemplo por la base Supabase existente. No ejecutar este harness contra ninguna base con datos de operación.

### 8.3 Build, navegador y dependencias

La configuración E2E necesita la aplicación **sin conexión Supabase**, también durante el build. En el checkout aislado, sin `.env.local`, ejecutar:

```sh
NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='' npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --omit=dev
git diff --check
```

El puerto `127.0.0.1:3100` debe estar libre: Playwright inicia su propio `npm run start`, con `reuseExistingServer: false`. No apuntar esta suite a la Preview autenticada ni reutilizar una compilación realizada con variables reales. Si el entorno bloquea Chromium o el build, registrar el bloqueo y repetir en CI; no marcarlo aprobado. Para reproducir exactamente las comprobaciones del proyecto, seguir [.github/workflows/ci.yml](../.github/workflows/ci.yml).

### 8.4 Integración real en Supabase de prueba

Provisionar o recibir un entorno de prueba autorizado, separado de datos reales. Usar [DEPLOYMENT.md](DEPLOYMENT.md), aplicar las siete migraciones una vez y configurar variables a partir de `.env.example` mediante un canal seguro. No reinicializar la instalación existente. Preparar propietario, administrador, empleado, auditor y usuario ajeno, con al menos dos empresas y varios fondos.

Ejecutar [ACCEPTANCE.md](ACCEPTANCE.md) completo. Añadir la matriz por roles sobre peticiones directas PostgREST/Storage, revocación/asignación finalizada, sesión caducada, invitación expirada y recuperación. Probar envío solo a destinatarios autorizados. Comparar asientos, saldos, reportes y cierres antes/después. Probar carga fallida, acceso ajeno y enlace firmado expirado. Ensayar restauración de base y archivos en un entorno separado y registrar duración y consistencia recuperada.

## 9. Pendientes y prioridades de auditoría

1. **Prioridad alta:** aislamiento entre empresas y fondos con JWT reales; escalación de privilegios; atomicidad, exactitud e idempotencia de dinero; restauración; ausencia de secretos en bundles y logs. Cualquier fallo confirmado bloquea el piloto.
2. **Antes del uso externo:** circuito real de invitación y recuperación, acceso fuera de la sesión Vercel del propietario, separación de entornos, publicación de producción y gestión de SMTP apropiada para operación habitual.
3. **Integración y fallos parciales:** reservas de comprobantes huérfanas, envío de invitación después de persistirla, reintentos y estados visibles. No se implementó una transacción distribuida ni reconciliación completa de cargas.
4. **Límites funcionales:** perfiles/nombres legibles y directorio en formularios; retirada de membresías y administración completa; conciliación bancaria histórica con partidas pendientes; evidencias de arqueo; alertas configurables y notificaciones; PWA. No hay sincronización financiera offline.
5. **Escala y exportación:** snapshot de últimos 100 registros en las colecciones limitadas; detalle de reportes de 200 en 200; CSV de página actual con totales completos; PDF solo resumen y limitaciones de alfabeto de Helvetica; visor hasta 20 comprobantes. Exportación masiva y rendimiento a escala pendientes.
6. **Experiencia y operación:** accesibilidad/móvil autenticado, mensajes ante fallos reales, pestañas abiertas durante despliegues, observabilidad sin datos sensibles y revisión de dependencias de desarrollo además de producción. La ausencia de vulnerabilidades reportadas por npm no acredita seguridad de negocio.

## 10. Entregable esperado del auditor

Crear un informe separado, por ejemplo `docs/AUDIT_REPORT.md`, con SHA completo, fecha, alcance, entorno y comandos realmente ejecutados. Por hallazgo: identificador, severidad, confianza, archivo/línea, condición necesaria, pasos de reproducción, resultado esperado/observado, impacto, evidencia saneada y corrección propuesta. Diferenciar vulnerabilidad reproducida, sospecha pendiente, limitación conocida y mejora funcional. Priorizar pérdida/duplicación de dinero, exposición entre empresas y escalación de acceso.

Registrar también pruebas aprobadas, fallidas y no ejecutadas con motivo. No convertir falta de evidencia en aprobación. No modificar producción ni enviar comunicaciones por el solo hecho de recibir esta guía. La aprobación de piloto requiere circuito real, seguridad, restauración y validación humana del responsable de la operación.
