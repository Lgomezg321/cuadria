# CUADRIA — Informe de auditoría independiente

| Campo        | Valor                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fecha        | 21 de octubre de 2026                                                                                                                                                                                                |
| Repositorio  | `Lgomezg321/cuadria`, rama `codex/cuadria-foundation`                                                                                                                                                                |
| SHA revisado | `47acdabd8cec92631ac0fe13642832a442181d46`                                                                                                                                                                           |
| Equivalencia | `git diff --stat 5355528 HEAD` solo toca `docs/AUDIT_HANDOFF.md`, `docs/DEPLOYMENT.md` y `docs/PROGRESS.md`. El código y las migraciones son idénticos al commit objetivo `53555289b92090de0867d9d60f15d5db5f983037` |
| Modalidad    | Solo lectura. Checkout aislado (worktree desacoplado en un directorio temporal); no se modificó ningún archivo versionado; sin commits, push ni conexiones a Supabase, Vercel, correo o la Preview                   |
| Equipo       | 4 líneas de revisión en paralelo: (1) autorización y aislamiento SQL, (2) integridad financiera, (3) capa de aplicación, (4) reproducción de pruebas, CI y despliegue                                                |
| Guía         | `docs/AUDIT_HANDOFF.md` (secciones 4, 5, 8, 9 y 10)                                                                                                                                                                  |

> Este informe **no aprueba el piloto**. Según el handoff §10, la aprobación requiere el circuito real con Supabase de prueba, la verificación de seguridad con JWT reales, una restauración probada y la validación humana del responsable de la operación. Nada de eso se pudo hacer en esta auditoría.

---

## 1. Resumen ejecutivo

**Lo esencial está bien diseñado.** No se encontró ningún hallazgo **Crítico**, nada que permita perder o duplicar dinero, ni fugas entre empresas.

- **Dinero:** en PostgreSQL real, el saldo coincidió siempre con la suma de los asientos (tras éxitos, errores y carreras). No hubo sobregiro del saldo actual ni ruptura de atomicidad, y el dominio `cop` rechazó todos los formatos inesperados. La idempotencia y la separación autor/revisor funcionan.
- **Aislamiento:** un administrador de otra empresa no pudo leer ni operar sobre la empresa A en ninguna RPC, tabla ni objeto de Storage. Ni empleados ni auditores pudieron escalar privilegios.
- **Aplicación:**
  - Cada mutación exige sesión (`getUser`) y la RPC vuelve a autorizar.
  - No hay `Number` aplicado a importes.
  - No hay redirección abierta en el callback.
  - El CSV neutraliza fórmulas.
  - La clave administrativa no aparece en el bundle.
- **Evidencia automática:** se reprodujeron 70/70 pruebas SQL y unitarias, lint, typecheck, build, 6/6 E2E (con un ajuste de navegador) y `npm audit --omit=dev` sin vulnerabilidades.

**Lo que bloquea el piloto o debe corregirse antes:**

1. **Riesgo operativo (Alta):**
   - La Preview funciona como producción y guarda el secreto `service_role` sin separación de entornos (H-01).
   - No hay backup ni restauración probados (H-02).
   - La capa de aplicación no tiene ninguna prueba automática (H-03).
2. **Gobierno de membresías (Media):** cualquier administrador de empresa puede dar de alta como admin a cualquier usuario de Auth, sin invitación. También puede degradar a otros administradores, propietario incluido, y quedarse con la empresa (H-04).
3. **Integridad histórica (Media):**
   - Se aceptan fechas retroactivas sin límite. Eso permite saldos históricos negativos, cierres congelados con saldo final negativo y movimientos anteriores a la creación del fondo (H-05).
   - Las reversiones mueven dinero en fondos inactivos (H-06).
4. **Fiabilidad en Vercel (Media):**
   - Los comprobantes de más de unos 4,5 MB fallarán, aunque la app promete 10 MB (H-07).
   - El error "Failed to find Server Action" tras un redespliegue se muestra con un mensaje engañoso (H-08).
5. **Autenticación (Media):** el cambio de contraseña no pide reautenticación (H-09), y el login y la recuperación no tienen límite de intentos ni CAPTCHA (H-10).

### Recuento consolidado (sin duplicados)

| Severidad | Nº  | IDs         |
| --------- | --- | ----------- |
| Crítica   | 0   | —           |
| Alta      | 3   | H-01 a H-03 |
| Media     | 14  | H-04 a H-17 |
| Baja      | 26  | H-18 a H-43 |
| Info      | 11  | H-44 a H-54 |

---

## 2. Comandos ejecutados y resultados

Entorno: Linux en contenedor y Node v24.22.0 (binario oficial con SHA-256 verificado) con npm 11.19.1. Chromium preinstalado (revisión 1194) y PostgreSQL 16.15 local; el handoff pide la versión 17.

| #   | Comando                                                                                      | Resultado           | Notas                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `npm ci`                                                                                     | ✅ 21,9 s           | 434 paquetes. Avisos: eslint 9 obsoleto; postinstall de `unrs-resolver`                                                                        |
| 2   | `npm run lint`                                                                               | ✅                  | Limpio                                                                                                                                         |
| 3   | `npm run typecheck`                                                                          | ✅                  | Limpio                                                                                                                                         |
| 4   | `npm test`                                                                                   | ✅ **70/70**        | database 57, money 9, receipt 2, reports 2                                                                                                     |
| 5   | `NEXT_PUBLIC_SUPABASE_URL='' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='' npm run build`          | ✅                  | Turbopack. No hay `service_role` en `.next/static`                                                                                             |
| 6   | `npm run test:e2e`, configuración original                                                   | ❌ 6/6              | Falla del entorno: Playwright 1.64.1 exige Chromium 1248 y está instalado 1194                                                                 |
| 6b  | Playwright con la misma configuración y `executablePath=/opt/pw-browsers/chromium`           | ✅ **6/6**          | 3 escenarios × 2 perfiles, todos sin Supabase                                                                                                  |
| 7   | `npm audit --omit=dev`                                                                       | ✅                  | 0 vulnerabilidades                                                                                                                             |
| 8   | `npm audit` completo                                                                         | ⚠️ 5 high           | Solo en desarrollo: `braces` (GHSA-vfj7-8cjw-p6xm), vía eslint-config-next                                                                     |
| 9   | `git diff --check`                                                                           | ✅                  | Limpio                                                                                                                                         |
| 10  | `npm outdated`                                                                               | Informativo         | react 19.3.1, lucide 1.60, eslint 10, typescript 7                                                                                             |
| 11  | `npm run format:check`                                                                       | ✅                  | CI no lo ejecuta                                                                                                                               |
| 12  | `npm audit signatures`                                                                       | ⛔                  | El proxy de red bloquea la descarga de firmas                                                                                                  |
| 13  | `npm run test:concurrency`                                                                   | ⛔ **No ejecutado** | PostgreSQL no arranca como root, y se denegó el cambio de permisos de directorio que hacía falta. No se insistió                               |
| 14  | Escenarios SQL propios (PostgreSQL 16 desechable, 7 migraciones, sustitutos de Auth/Storage) | ✅ ejecutados       | Más de 20 escenarios de autorización y finanzas; incluye una carrera real con 3 conexiones y espera de bloqueo observada en `pg_stat_activity` |

**Pruebas no ejecutadas y por qué:**

- Suite oficial de concurrencia: ver la fila 13. La única evidencia sigue siendo el CI 39417194748.
- `docs/ACCEPTANCE.md` con Supabase real: no hay un entorno de prueba autorizado.
- Peticiones HTTP a PostgREST, Storage y GoTrue con JWT reales: no hubo conexión remota.
- Restauración de backup: no hay entorno.
- Envío y recepción de correo: no autorizado.

---

## 3. Hallazgos

Campos de cada hallazgo:

- **Clasificación:** **VC-R**, confirmado y reproducido en PostgreSQL real; **VC-L**, confirmado leyendo el código; **SP**, sospecha pendiente; **LC**, limitación conocida declarada en el handoff; **M**, mejora.
- **Conf.:** confianza en el hallazgo.
- **Origen:** IDs de las revisiones parciales (SQL-, FIN-, APP-, CI-, TEST-, OPS-).

### 3.1 Severidad Alta

#### H-01 · La Preview funciona como producción y guarda el secreto administrativo

- **Alta.** Conf.: alta. LC. Origen: OPS-02, CI-06.
- **Evidencia:** handoff §6, `docs/PROGRESS.md:84-88`, `docs/DEPLOYMENT.md:47`.
- **Situación:**
  - Hay un único proyecto Supabase, con la cuenta real del propietario.
  - `SUPABASE_SERVICE_ROLE_KEY` está guardada en la Preview de `codex/cuadria-foundation`.
  - No existe producción ni separación entre desarrollo y producción.
  - Cada push a la rama se despliega sin PR, sin protección de rama y sin esperar a que CI esté en verde.
  - `main` sigue en el commit inicial.
  - Varios commits recientes llevan `[skip ci]`, y la Preview verificada (86b03b2) no tiene CI propio.
- **Impacto:** cualquier cambio en la rama se ejecuta con el secreto administrativo contra los datos reales, sin revisión.
- **Corrección:**
  - Crear `cuadria-dev` y `cuadria-prod` en Supabase.
  - Que la Preview no tenga la clave o use un proyecto de desarrollo.
  - Proteger `main` con el check Quality obligatorio y revisión.
  - Desplegar producción solo desde `main`, con Deployment Checks.
  - Rotar `service_role` después de separar los entornos.

#### H-02 · Sin backup ni restauración probados

- **Alta.** Conf.: alta. LC. Origen: OPS-05.
- **Evidencia:** `docs/DEPLOYMENT.md:58-62`, `docs/ACCEPTANCE.md:52`.
- **Situación:**
  - No están documentados el plan de Supabase ni su retención.
  - El bucket de Storage no entra en los backups de la base.
  - No hay RPO, RTO ni acta de ensayo.
- **Impacto:** bloquea el piloto (handoff §9.1).
- **Corrección:**
  - Definir RPO y RTO.
  - Ensayar la restauración de la base y del bucket `receipts` en un entorno separado.
  - Conciliar saldos contra asientos tras restaurar.
  - Dejar acta con la duración.

#### H-03 · La capa de aplicación no tiene ninguna prueba automática

- **Alta.** Conf.: alta. VC-L. Origen: TEST-01, TEST-02.
- **Evidencia:** `tests/*.ts` solo importa `src/lib/domain/{money,receipt,reports}`.
- **Sin cobertura:**
  - Las Server Actions: `src/app/actions.ts` (303 líneas), `receipt-actions.ts` e `invitation-actions.ts`.
  - Las rutas `reportes/csv`, `reportes/pdf`, `comprobantes/[id]` y `auth/callback`, más `src/lib/data.ts` y `src/proxy.ts`.
  - Los E2E (`tests/e2e/setup.spec.ts:19-35`) solo prueban el modo sin configuración. Su test de rutas protegidas espera `/configuracion`, que `requireUser` devuelve antes de mirar la sesión (`src/lib/auth.ts:7`). Si se rompiera la comprobación de sesión, los E2E seguirían en verde.
- **Impacto:** los "6 E2E" y las "70 pruebas" no cubren ningún recorrido autenticado. Un defecto de este tipo ya ocurrió y se detectó por casualidad (PROGRESS:35).
- **Corrección:**
  - Pruebas de integración con `supabase start` (Auth, Storage y PostgREST reales) en CI.
  - E2E autenticados con usuarios sintéticos: login, circuito mínimo y aislamiento entre dos empresas.
  - Un proyecto Playwright con WebKit.

### 3.2 Severidad Media

#### H-04 · `assign_member` sin límites: alta sin invitación y destitución del propietario

- **Media.** Conf.: alta. VC-R. Origen: SQL-01.
- **Ubicación:** `supabase/migrations/202610190001_core.sql:139-145` (línea 142); en la interfaz, `src/app/(protected)/empresas/page.tsx:101-113`.
- **Condición:** ser admin de la empresa y conocer el UUID del objetivo. Los UUID aparecen en `member_directory`, `memberships`, `created_by` y `reviewer_id`.
- **Reproducción:** `POST /rest/v1/rpc/assign_member {"p_company":"<A>","p_user":"<uuid>","p_role":"admin"}`.
- **Observado:**
  - Un usuario con `email_confirmed_at = NULL` queda como admin activo.
  - Una membresía desactivada se reactiva (`active=true`).
  - Un admin A2 degrada a A1 y al propietario de instalación, creador de la empresa, a `auditor`.
  - El propietario no puede recuperarse, porque `p_user = auth.uid()` está prohibido.
- **Esperado:**
  - Las altas solo llegan por invitación con correo verificado.
  - Un admin no puede destituir al propietario ni a sus pares.
  - Siempre queda al menos un admin.
- **Impacto:**
  - Toma exclusiva de la empresa por un solo admin.
  - Creación de admins alias para aprobar sus propios movimientos, lo que anula en la práctica la separación autor/revisor (ver H-26).
- **Corrección:**
  - Que `assign_member` solo actualice el rol de miembros existentes.
  - Que solo el propietario o el creador pueda cambiar el rol de los admins.
  - Salvaguarda del último admin.
  - Un `set_member_active` explícito y auditado, con el rol anterior en la auditoría.

#### H-05 · Fechas retroactivas sin límite: saldos históricos negativos y cierres negativos congelados

- **Media.** Conf.: alta. VC-R (`agent-fin/s3_backdate.sql`). Origen: FIN-01.
- **Ubicación:** `202610190001_core.sql:189,204` y `202610190003_drafts_closures.sql:93-104`.
- **Código:** `post_movement` solo rechaza fechas futuras o ya cerradas. El control de sobregiro usa el saldo actual, no el saldo a la fecha de la operación. `close_period` no exige que el saldo final sea ≥ 0.
- **Reproducción:**
  1. Fondo creado hace 10 días con apertura 0.
  2. Ingreso de 100 con fecha de hoy.
  3. Egreso de 100 con fecha de hace 5 días: se acepta.
  4. Ingreso de 1 con fecha de hace 400 días, antes de crear el fondo: se acepta.
- **Observado:** `financial_report(hoy-6, hoy-1)` da `closing_balance = -99`. Tras la aprobación de otro admin, `close_period(hoy-1)` congela un cierre inmutable con saldo final de -99.
- **Esperado:** la caja nunca queda negativa en la línea temporal, y no hay operaciones anteriores a la existencia del fondo.
- **Impacto:**
  - Actas de cierre inmutables con estados imposibles.
  - Cualquier usuario con escritura puede imputar gastos a meses anteriores mientras sigan abiertos.
  - El saldo actual sigue siendo correcto.
- **Corrección:**
  - Rechazar fechas anteriores a `funds.created_at`, en origen y en destino.
  - Opcionalmente, fijar una ventana máxima de retroactividad.
  - Con el fondo bloqueado, validar que el saldo acumulado por `operation_date` siga ≥ 0 desde `p_date`; aplicarlo también en la reversión.
  - Añadir `check (closing_balance >= 0)` en `period_closures`.

#### H-06 · La reversión mueve dinero en fondos inactivos

- **Media.** Conf.: alta. VC-R, reproducido por dos revisores. Origen: FIN-02, SQL-06.
- **Ubicación:** `202610190001_core.sql:228-255` (líneas 232 y 249); invariante en `202610190005_administration.sql:61,78`.
- **Código:** `reverse_movement` solo exige rol admin; no llama a `can_write_fund` ni comprueba `funds.active`.
- **Reproducción:**
  1. Fondo A con 1000.
  2. Egreso de 300 y transferencia de 700 a B. A queda en 0.
  3. `set_fund_active(A, false)`.
  4. Revertir el egreso y la transferencia.
- **Observado:** A queda inactivo con saldo 1000 (los asientos cuadran). No se puede arquear, porque `record_check` exige escritura, y queda fuera de las alertas. Se rompe el invariante "inactivo ⇒ saldo 0".
- **Impacto:** dinero contable fuera de los controles operativos.
- **Corrección:** después de bloquear los fondos, rechazar la operación con `FUND_INACTIVE` si alguno está inactivo.

#### H-07 · Comprobantes de más de unos 4,5 MB fallan en Vercel aunque la app promete 10 MB

- **Media.** Conf.: alta en el mecanismo; no reproducido en el despliegue. VC-L. Origen: APP-01, OPS-01.
- **Ubicación:** `next.config.ts:7` (`bodySizeLimit "11mb"`); `src/app/receipt-actions.ts:8-37`; `src/proxy.ts:25-37`; texto en `movimientos/page.tsx:94`.
- **Mecanismo:**
  - El archivo viaja en el `FormData` de una Server Action.
  - Vercel Functions rechaza los cuerpos de más de unos 4,5 MB con 413 `FUNCTION_PAYLOAD_TOO_LARGE`.
  - Fuera de Vercel, el proxy de Next 16 guarda el cuerpo en memoria hasta `proxyClientMaxBodySize`, que vale 10 MiB por defecto, y lo **trunca** por encima. Un archivo de exactamente 10 MiB, más la sobrecarga multipart, lo supera.
  - El error termina en `error.tsx` con un mensaje genérico.
- **Impacto:** las fotos de móvil y los PDF escaneados, a menudo de más de 4,5 MB, no se pueden adjuntar, y el egreso queda sin comprobante.
- **Corrección:**
  - Preferida: tras `reserve_receipt`, generar `createSignedUploadUrl` con la sesión del usuario, subir directamente a Storage desde el navegador y verificar después en una acción de confirmación. Esto también resuelve H-18.
  - Mínima: bajar el límite a 4 MB, validar el tamaño en el cliente y corregir los textos.
  - En ambos casos, añadir E2E con archivos de 4,4, 5 y 9,9 MB.

#### H-08 · "Failed to find Server Action" tras un redespliegue: mensaje engañoso y sin recuperación

- **Media.** Conf.: alta. VC-L, más el incidente real del handoff §6. Origen: APP-02, OPS-10.
- **Ubicación:** `src/components/action-form.tsx:16`, `src/app/error.tsx:3-13`, `next.config.ts`.
- **Causa:**
  - Next cambia los identificadores de las acciones en cada build.
  - El servidor responde 409 con `x-nextjs-action-not-found` y el cliente lanza `UnrecognizedActionError`.
  - `ActionForm` no lo captura, así que llega a `error.tsx` raíz. Ese componente sustituye toda la interfaz y dice "Revisa la conexión y la configuración del servicio".
  - `reset()` reutiliza el bundle viejo y vuelve a fallar.
- **Impacto:** el usuario no sabe si la operación se registró. El riesgo financiero es bajo, porque el rechazo ocurre antes de ejecutar la acción.
- **Corrección:**
  - Activar Vercel Skew Protection (`deploymentId`).
  - En `ActionForm`, capturar el error con `unstable_isUnrecognizedActionError()` y mostrar "CUADRIA se actualizó; recarga. La operación no se registró", con botón de recarga completa.
  - Añadir un `error.tsx` dentro de `(protected)` para conservar la navegación.

#### H-09 · Cambio de contraseña sin reautenticación

- **Media.** Conf.: alta en el código; configuración remota sin verificar. VC-L. Origen: APP-03, OPS-07 (parcial).
- **Ubicación:** `src/app/actions.ts:292-303`; `src/app/auth/password/page.tsx:5-9`; `supabase/config.toml:21-23`, donde falta `secure_password_change`.
- **Reproducción:** con sesión iniciada, abrir `/auth/password` y fijar una contraseña nueva. No pide la contraseña actual ni un nonce, y no cierra las demás sesiones.
- **Agravantes:**
  - Las cookies de sesión duran 400 días y son legibles por JavaScript (H-34).
  - La regla de 12 caracteres solo existe en la app. Supabase acepta 6 por defecto, así que se puede poner una contraseña más corta llamando directamente a `auth.updateUser`.
- **Impacto:** una sesión robada o un equipo desatendido se convierte en toma de cuenta persistente, también de cuentas de administrador.
- **Corrección:**
  - Activar `secure_password_change` con `reauthenticate()`.
  - Eximir solo el modo recuperación o invitación, con una cookie de corta duración emitida en el callback.
  - Llamar a `signOut({scope:"others"})` tras el cambio.
  - Fijar `minimum_password_length = 12` en Auth.
  - Valorar MFA para administradores.

#### H-10 · Login y recuperación sin límite de intentos ni CAPTCHA

- **Media.** Conf.: media. SP. Origen: APP-04.
- **Ubicación:** `src/app/actions.ts:245-291`.
- **Análisis:**
  - La app no aplica ningún límite propio.
  - Supabase limita por IP, pero probablemente ve la IP de la función de Vercel. Consecuencias: un atacante puede bloquear el login de todos los usuarios, o repartir la fuerza bruta entre varias IP.
  - `recoverPassword` permite agotar la cuota del SMTP Gmail temporal y bloquear así invitaciones y recuperaciones.
  - Hoy lo mitiga la Vercel Authentication de la Preview.
- **Corrección:**
  - CAPTCHA en Supabase Auth (Turnstile o hCaptcha).
  - Rate limit en el Firewall de Vercel para los POST a `/login`.
  - Revisar los `rate_limit.*` de Auth.
  - Pasar a un SMTP transaccional (H-12).

#### H-11 · Cuatro proyectos Vercel conectados al repositorio

- **Media.** Conf.: media. SP. Origen: OPS-03.
- **Evidencia:** `docs/DEPLOYMENT.md:5`, `docs/PROGRESS.md:11,39`.
- **Situación:** `cuadria-caja`, `cuadria-app` y `cuadria-czyg` compilan cada push, y no se verificaron sus variables ni su protección. Podrían publicar sin Vercel Authentication.
- **Corrección:** hacer inventario y desconectar todos menos el canónico `cuadria`.

#### H-12 · SMTP con la cuenta Gmail personal del propietario

- **Media.** Conf.: alta. LC. Origen: OPS-04.
- **Evidencia:** `docs/PROGRESS.md:90-94`.
- **Riesgo:** la contraseña de aplicación da acceso SMTP e IMAP a todo el buzón. Comprometer el panel de Supabase compromete también el correo del propietario. Además hay límites de envío y problemas de entrega.
- **Corrección:** usar un proveedor transaccional con dominio propio y SPF/DKIM/DMARC, y revocar la contraseña de aplicación.

#### H-13 · Configuración crítica remota fuera del repositorio

- **Media.** Conf.: alta. VC-L. Origen: OPS-07, SQL-08.
- **Ubicación:** `supabase/config.toml:16-26`, `vercel.json`.
- **Situación:**
  - `config.toml` tiene `site_url` localhost y un solo callback.
  - No se versionan las plantillas de correo, el SMTP ni la política de contraseñas.
  - Framework, Node y comandos de Vercel están solo en el panel; ya causaron un 404 con "Other".
- **Dependencia de seguridad:** la aceptación de invitaciones supone que el registro público está desactivado, que la confirmación de correo es obligatoria y que no hay OAuth/SSO que marque correos como verificados. Si eso cambia, quien registre el correo de una víctima hereda sus invitaciones, que se aceptan solas en `actions.ts:262` y en `auth/callback/route.ts:21`.
- **Corrección:**
  - Versionar plantillas, política de contraseñas y URLs en `config.toml`, y framework y comandos en `vercel.json`.
  - Documentar como requisito de despliegue que el registro esté deshabilitado y la confirmación sea obligatoria.
  - Valorar una aceptación explícita por ID de invitación.

#### H-14 · Los sustitutos de Auth y Storage de las pruebas son más simples que Supabase

- **Media.** Conf.: media. VC-L en las diferencias; SP en el impacto. Origen: TEST-03.
- **Ubicación:** `tests/database.test.ts:55,61`, `scripts/test-concurrency.mjs:71,80`.
- **Diferencias:**
  - `auth.uid()` solo lee `request.jwt.claim.sub`.
  - No se emulan `auth.jwt()`, `auth.role()` ni los privilegios por defecto de Supabase.
  - `storage.objects` solo tiene `id`, `bucket_id` y `name`, sin límites de MIME o tamaño, sin `upsert` y sin URLs firmadas.
  - Todo corre como superusuario con `set local role`.
- **Corrección:** ejecutar también contra `supabase start` y copiar la definición real de `auth.uid()`.

#### H-15 · No hay prueba de regresión de privilegios

- **Media.** Conf.: alta. VC-L. Origen: TEST-05.
- **Situación:** no hay casos con `set role anon` ni una lista blanca de grants del catálogo. Si una migración futura olvida un `revoke`, pasaría todas las pruebas.
- **Corrección:** un test que compare los grants de tablas, funciones y secuencias con una lista blanca, emulando los privilegios por defecto de Supabase, más casos con anon que deben dar `permission denied`.

#### H-16 · Lagunas funcionales en las pruebas SQL

- **Media.** Conf.: alta. VC-L. Origen: TEST-06.
- **Ubicación:** `tests/database.test.ts:212-330`.
- **Sin probar:**
  - **Invitaciones:** expiración, `INVITATION_RATE_LIMIT`, normalización de correo e invitación como admin.
  - **Reportes:** paginación con más de 200 filas, `opening_balance` con días previos al rango, reversiones dentro del período y la ecuación del reporte (los dos tests usan `current_date` como inicio y fin).
  - **Cierres:** una reversión posterior a un cierre.
  - **Sin cobertura:** `create_category`, `member_directory`, `controls_snapshot` y `review_check`, salvo el caso de aprobación.
- Varios hallazgos de este informe (H-05, H-06, H-20) se habrían detectado con estos casos.

#### H-17 · No hay PR ni protección de rama; `main` está en el commit inicial

- **Media.** Conf.: alta. LC. Origen: CI-06, CI-07.
- **Evidencia:** `docs/PROGRESS.md:60`; commits `[skip ci]` 86b03b2, e06c5ca y 47acdab.
- **Corrección:** abrir el PR, proteger las ramas con el check Quality obligatorio y revisión, y no saltar CI en commits que se despliegan.

### 3.3 Severidad Baja

#### Comprobantes, membresías e invitaciones

| ID   | Título                                                                       | Ubicación                                                     | Clasif.                  | Detalle y corrección                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H-18 | La validación de comprobantes solo existe en la Server Action                | `202610190002_receipts.sql:14-33`; `receipt-actions.ts:17-24` | VC-R (SQL) + VC-L (HTTP) | `reserve_receipt` acepta `p_mime` y `p_size` del cliente, y la política INSERT de Storage solo comprueba la ruta reservada. Por RPC directa más subida a Storage se registran metadatos falsos y bytes arbitrarios, y se crearon 501 reservas inmutables sobre un mismo movimiento. Efectos: vector de malware contra revisores y la alerta `missing_receipts` se cumple con cualquier archivo. **Corrección:** verificar tras la carga (firma, tamaño y MIME de `storage.objects.metadata`), usar un estado `verified`/`quarantined`, limitar las reservas por movimiento y servir con `attachment` todo lo que no sea imagen. Origen: SQL-04, APP-06 |
| H-19 | Una invitación de admin sigue siendo válida después de degradar al invitador | `202610190005_administration.sql:24-37`                       | VC-R                     | Al aceptar, comprobar que `invited_by` sigue siendo admin, y revocar las invitaciones pendientes cuando cambia el rol del invitador. Origen: SQL-02                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| H-20 | Asignaciones que no se pueden cerrar y reviven                               | `202610190001_core.sql:151,142,94`                            | VC-R                     | Si E pasa de empleado a auditor, `assign_fund(..., p_end=true)` da `INVALID_MEMBER`. Al volver a empleado recupera la escritura sin reasignación ni evento. **Corrección:** no validar el rol al finalizar y cerrar las asignaciones al cambiar el rol. Origen: SQL-03, FIN-07                                                                                                                                                                                                                                                                                                                                                                         |
| H-21 | Invitación consumida sin efecto                                              | `administration.sql:30-32`                                    | VC-R                     | Si ya existe una membresía (inactiva o de otro rol), `on conflict do nothing` no hace nada y la invitación igualmente queda aceptada. **Corrección:** marcarla solo si hubo inserción (`returning`). Origen: SQL-05                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| H-22 | Spam de invitaciones y creación de cuentas Auth                              | `invitation-actions.ts:32-44`; `administration.sql:12-23`     | VC-L                     | Cualquier admin puede invitar sin un límite global; solo hay 1 intento por correo y minuto. `inviteUserByEmail` crea usuarios aunque el registro público esté deshabilitado. **Corrección:** límites por actor, empresa y día, y registrar los fallos de envío. Origen: APP-08                                                                                                                                                                                                                                                                                                                                                                         |

#### Integridad financiera y separación de funciones

| ID   | Título                                                                   | Ubicación                                                             | Clasif. | Detalle y corrección                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-23 | Una reversión cambia la revisión de movimientos de un período cerrado    | `core.sql:244,250-251`; `drafts_closures.sql:112-119`                 | VC-R    | El original pasa de `approved/posted` a `rejected/reversed` aunque esté dentro de un cierre; el cierre congela los IDs pero no los estados. **Corrección:** no tocar el `review_status` si la fecha está cerrada, o guardar una copia de los estados en el cierre. Origen: FIN-03                                                                                                                       |
| H-24 | Reversiones sin cuatro ojos                                              | `core.sql:232,251`; `drafts_closures.sql:96`; `administration.sql:74` | VC-R    | El autor puede revertir su propio movimiento y queda como "revisor" que lo rechaza. `close_period` y las alertas no exigen revisar las reversiones. **Corrección:** registrar la reversión como evento propio, no como revisión, y exigir aprobación de otra persona antes del cierre. Origen: FIN-04, SQL-07                                                                                           |
| H-25 | Se puede reabrir un movimiento aprobado                                  | `drafts_closures.sql:114-125`                                         | VC-R    | Un movimiento pasa de `approved` a `observed` sin restricción ni motivo, y eso vuelve a habilitar la subida de comprobantes. **Corrección:** restringir esa transición y exigir motivo. Origen: SQL-07                                                                                                                                                                                                  |
| H-26 | La separación autor/revisor es por cuenta, no por persona                | `drafts_closures.sql:114-125`                                         | VC-R    | Con un admin alias (H-04 o invitación) se aprueban movimientos propios. **Corrección:** cerrar H-04 y documentar este límite. Origen: SQL-07                                                                                                                                                                                                                                                            |
| H-27 | Los totales de cierre usan el tipo `cop`                                 | `drafts_closures.sql:87,97-104`                                       | VC-R    | Si el flujo bruto supera 10^18−1, `close_period` falla de forma permanente. **Corrección:** usar `numeric` para los totales de flujo. Origen: FIN-05                                                                                                                                                                                                                                                    |
| H-28 | Claves de idempotencia inconsistentes entre RPC                          | `core.sql:171,193`; `drafts_closures.sql:47`                          | VC-R    | La clave de una apertura cero se puede reutilizar en `post_movement`, y un borrador puede "adoptar" un movimiento previo con la misma clave. No duplica dinero y solo es alcanzable por RPC directa. **Corrección:** una tabla privada de solicitudes con espacio de nombres por operación. Origen: FIN-06                                                                                              |
| H-29 | Operaciones sin clave de idempotencia                                    | `core.sql:256-267`; `actions.ts:110-165,195-210`                      | VC-R    | `record_check`, `review_movement`, `review_check` y `reserve_receipt` no tienen clave: si se pierde la respuesta y se reenvía, se duplican arqueos y revisiones. **Corrección:** añadir `p_key`. Origen: FIN-09, APP-12                                                                                                                                                                                 |
| H-30 | `movements` y `funds.balance` sin protección de inmutabilidad en la base | `core.sql:99-102,125`                                                 | SP      | No hay trigger en `movements` y `TRUNCATE` no está bloqueado. Como superusuario, `update movements set amount=1` deja un movimiento descuadrado con sus asientos. Probablemente `service_role` tiene escritura (no verificado en remoto). **Corrección:** trigger de transiciones válidas, `before truncate` por sentencia, revocar a `service_role` y conciliar periódicamente. Origen: FIN-08, SQL-09 |

#### Autenticación, sesión y aplicación

| ID   | Título                                                     | Ubicación                                                                             | Clasif.   | Detalle y corrección                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-31 | Enumeración de cuentas por la recuperación                 | `actions.ts:280-290`                                                                  | SP (alta) | Un 429 en una cuenta existente produce un mensaje distinto del de un correo inexistente. **Corrección:** mensaje siempre idéntico y registro en el servidor. Origen: APP-05                                                                                                                  |
| H-32 | El callback consume el token en un GET                     | `auth/callback/route.ts:4-33`                                                         | VC-L / SP | Los escáneres de enlaces del correo consumen el token del invitado. Además permite CSRF de login: sustituir la sesión de la víctima por la de otro usuario. **Corrección:** página intermedia `/auth/confirm` con un POST, y confirmación si ya hay sesión de otro usuario. Origen: APP-07   |
| H-33 | El visor de comprobantes carga con URL de 60 s en diferido | `receipt-preview.tsx:18-25,59-67`                                                     | VC-L      | `next/image` es `lazy`, así que las imágenes inferiores llegan con la URL vencida; además hace 20 firmas por render. El revisor puede aprobar sin ver la evidencia. **Corrección:** `loading="eager"` o `src="/comprobantes/<id>"`, y `createSignedUrls` en una sola llamada. Origen: APP-09 |
| H-34 | Sin CSP ni HSTS; cookies de sesión sin HttpOnly            | `next.config.ts:8-22`; `supabase/server.ts:9-12`; `proxy.ts:8-19`                     | M         | `@supabase/ssr` usa por defecto `httpOnly:false` y 400 días, aunque ningún cliente de navegador lee esas cookies. **Corrección:** `{...options, httpOnly:true, secure:true}`, CSP con nonce, HSTS y un time-box de sesión en Auth. Origen: APP-10, OPS-11                                    |
| H-35 | Formularios vaciados tras un error y mensajes en inglés    | `action-form.tsx:16-41`; `actions.ts:232-238`; `login/page.tsx:6`; `lib/reports.ts:6` | VC-L      | React 19 reinicia el formulario y se pierden los datos tras un "saldo insuficiente". Zod responde en inglés. `?error=callback` no se muestra. Un filtro de reporte inválido lleva a la pantalla de error, o da 500 en CSV y PDF. Faltan `aria-invalid` y `autoComplete`. Origen: APP-11      |
| H-36 | `appOrigin()` cae en silencio a `http://localhost:3000`    | `src/lib/env.ts:13-15`                                                                | VC-L      | Si falta `NEXT_PUBLIC_APP_URL`, las invitaciones y recuperaciones redirigen a localhost. **Corrección:** fallar en Preview y Production si falta la variable. Origen: OPS-09                                                                                                                 |
| H-37 | No se pueden borrar usuarios desde Auth                    | 14 FK a `auth.users` sin `ON DELETE`                                                  | SP        | Borrar un usuario fallaría. No hay un procedimiento documentado de baja (asignación, `active=false`, ban). Origen: OPS-13                                                                                                                                                                    |

#### CI, dependencias y operación

| ID   | Título                                                         | Ubicación                                          | Clasif. | Detalle y corrección                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------- | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H-38 | Acciones de CI fijadas por tag, con runtime Node 20            | `.github/workflows/ci.yml:24-25`                   | VC-L    | `checkout@v4` y `setup-node@v4`. Lo mitiga `permissions: contents: read`. **Corrección:** fijar por SHA, migrar de versión y añadir Dependabot. Origen: CI-01, CI-02                                                                                                                                                           |
| H-39 | La auditoría de CI solo cubre producción                       | `ci.yml:39`                                        | VC-L    | Hay 5 high en desarrollo (`braces`) sin documentar. **Corrección:** una excepción documentada con fecha de revisión, más `overrides`. Origen: CI-03                                                                                                                                                                            |
| H-40 | Faltan controles básicos en CI                                 | `ci.yml:8-39`                                      | M       | No hay `timeout-minutes`, `concurrency`, `format:check` ni `git diff --check`, y falta `persist-credentials: false`. Origen: CI-04                                                                                                                                                                                             |
| H-41 | Versiones flotantes en CI                                      | `ci.yml:13,27,37`                                  | VC-L    | `postgres:17`, Node `"24"` y `playwright --with-deps`. Además, la revisión de Chromium que exige Playwright no está documentada (causa del fallo 6). **Corrección:** fijar por digest o versión exacta, o usar la imagen `mcr.microsoft.com/playwright:v1.64.1`. Origen: CI-05, TEST-11                                        |
| H-42 | El harness de concurrencia demuestra menos de lo que se afirma | `scripts/test-concurrency.mjs:12-13,66-71,153-187` | VC-L    | Con un pool `max: 8` y la conexión admin ocupada, los "8 reintentos simultáneos" son como mucho 7. No se verifica el solape en las transferencias opuestas y asientos = saldo se comprueba una sola vez. Faltan carreras de `submit_draft`, `reverse_movement`, revisión contra cierre y `accept_invitations`. Origen: TEST-07 |
| H-43 | Información operativa en un repositorio público                | historia de Git, `docs/`                           | VC-L    | Se exponen la ref de Supabase, la URL de la Preview, el equipo de Vercel, dónde vive la clave y el uso del Gmail del propietario. Una búsqueda de secretos en toda la historia no encontró ninguno real. **Corrección:** valorar repo privado, secret scanning y push protection. Origen: OPS-06                               |

### 3.4 Informativos

| ID   | Título                                                                                                                                                                                 | Ubicación                                                                                             | Origen          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| H-44 | Las secuencias `entries_id_seq` y `audit_events_id_seq` conservan USAGE/UPDATE para anon y authenticated; falta `alter default privileges ... revoke` para funciones futuras           | `core.sql:52,71,125`                                                                                  | SQL-09, TEST-04 |
| H-45 | Varias funciones hacen `FOR UPDATE` sobre filas, quizá de otra empresa, antes de autorizar                                                                                             | `core.sql:149,220`; `receipts.sql:17`; `drafts_closures.sql:43,66,89,117`; `administration.sql:41,59` | SQL-10          |
| H-46 | La lectura directa por PostgREST expone `request_payload` e `idempotency_key`; los auditores ven los correos de todos los miembros; los empleados ven a los demás asignados a su fondo | Políticas en `core.sql:116-124`                                                                       | SQL-11          |
| H-47 | La matriz de permisos difiere de REQUIREMENTS §7: el auditor no puede registrar observaciones (más restrictivo) y no hay RPC del propietario para gestionar usuarios                   | `audit_conversation.sql:17-18`                                                                        | SQL-12          |
| H-48 | Un reintento idempotente tras perder el permiso recibe `FORBIDDEN` en vez del id ya registrado                                                                                         | `core.sql:186,193`                                                                                    | FIN-10          |
| H-49 | CSV: Excel trunca a 15 dígitos; falta `financial_status`; `totals` sin `ORDER BY`; se muestra "Detalle 1 a 0 de 0"                                                                     | `lib/domain/reports.ts:58-123`; `reports.sql:154,160`                                                 | FIN-11          |
| H-50 | El desbordamiento de `cop` se muestra con un mensaje genérico (mapear `23514`)                                                                                                         | `lib/errors.ts:28-35`                                                                                 | FIN-12          |
| H-51 | Observabilidad: no hay logger de servidor ni `global-error.tsx`, y una caída de Auth parece un cierre de sesión                                                                        | `lib/errors.ts:28-35`; `lib/auth.ts:9-10`                                                             | APP-14          |
| H-52 | Escalado: consulta N+1 de comprobantes; `workspace_snapshot` no limita empresas, fondos ni categorías                                                                                  | `movimientos/page.tsx:104-108`; `lib/data.ts:55-63`                                                   | APP-15          |
| H-53 | La lista de invitaciones "pendientes" incluye las vencidas, sin empresa ni orden                                                                                                       | `empresas/page.tsx:13-18,47-57`                                                                       | APP-13          |
| H-54 | Regiones desalineadas (base en ca-central-1, funciones en iad1) e inconsistencias documentales (ver §5)                                                                                | `vercel.json`; `docs/*`                                                                               | OPS-08, OPS-12  |

---

## 4. Controles verificados correctos

### Dinero (PostgreSQL 16 real, 7 migraciones)

- **Dominio `cop`:**
  - Rechaza `"100\n"`, `"0100"`, `"1e5"`, `" 100"`, `"100.0"`, `"-100"`, dígitos de ancho completo y 19 dígitos.
  - Acepta exactamente el máximo `999999999999999999`; el máximo +1 se rechaza con rollback completo.
- **TypeScript:** `money.ts` usa el mismo regex y `BigInt`, sin `Number`, `parseInt` ni `parseFloat` sobre importes.
- **Asientos y saldo:**
  - Los asientos son inmutables (trigger) y `authenticated` solo tiene SELECT.
  - Hay `check(balance >= 0)`.
  - Saldo = suma de asientos en todos los escenarios, incluidos errores y carreras.
- **Bloqueos y carreras:**
  - Los fondos se bloquean en orden de UUID y se reautoriza después del bloqueo.
  - En una carrera real a 3 conexiones hubo una sola reversión, el segundo intento recibió `INVALID_REVERSAL`, el egreso concurrente recibió `INSUFFICIENT_FUNDS` y los saldos cuadraron.
- **Transferencias:** exigen escritura en origen y destino y la misma empresa (FK compuestas), rechazan origen = destino y generan dos asientos opuestos.
- **Idempotencia:**
  - Advisory lock por actor y clave, unicidad `(created_by, clave)` y un payload con todos los parámetros económicos.
  - Las aperturas, comentarios y borradores con versión se comportan correctamente.
- **Revisión:** aprobar u observar no crea asientos; el revisor debe ser distinto del autor y debe ser admin.
- **Reversión:** es única, exige motivo, no aplica a aperturas ni a reversiones, no permite sobregiro y lleva la fecha de hoy.
- **Apertura cero:** no crea asiento y queda auditada; no hay segunda apertura.
- **Arqueos:** el saldo teórico se toma con el fondo bloqueado y la diferencia no ajusta el saldo.
- **Cierres:**
  - El corte es inclusive.
  - Las fechas se comparan como `date` en hora de Bogotá.
  - Totales e IDs quedan congelados.
  - Las carreras cierre/registro y cierre/revisión quedan serializadas.
- **Reportes:**
  - La ecuación del reporte se cumple y el saldo final coincide con `funds.balance`.
  - Los filtros no alteran los totales y la paginación es estable.
  - CSV y PDF usan los mismos totales.

### Autorización y aislamiento

- **RLS:**
  - Las 17 tablas tienen RLS y una única política SELECT para `authenticated`.
  - `installation_owners` no tiene política ni grant.
  - anon no tiene privilegios de tabla y los INSERT/UPDATE directos se rechazan.
- **Funciones:**
  - Ninguna de las 31 funciones es ejecutable por anon.
  - Todas las `SECURITY DEFINER` tienen `search_path=''`.
  - El actor es siempre `auth.uid()` y no se usa metadata de usuario.
  - El rol se relee en cada llamada.
- **Aislamiento entre empresas:** un admin de B no puede leer ni operar sobre A, ni en movimientos, revisiones, reversiones, directorio, invitaciones, comentarios, comprobantes, reportes o Storage. No hay oráculos de existencia.
- **Escalada:** empleados y auditores no pueden escalar, aprobar, asignar, invitar ni escribir.
- **Invitaciones:** se rechaza el correo no confirmado. Hay normalización, expiración, revocación y protección contra la doble aceptación bajo `FOR UPDATE`.
- **Propietario de instalación:** solo se crea con `bootstrap-owner.sql`.
- **Storage:** bucket privado, sin políticas UPDATE ni DELETE, y la ruta la genera el servidor.
- **`private.fund_requests`:** no tiene grants y tiene RLS.

### Aplicación

- **Sesión y entrada:**
  - `requireUser()`, con `getUser`, va antes de cualquier mutación.
  - Los IDs se validan con `z.uuid()` y los enums son cerrados.
  - Las claves extra del FormData se descartan.
- **Errores:** `publicError` no filtra mensajes internos.
- **Cliente administrativo:** solo se usa para `inviteUserByEmail`, después de `create_invitation`, con `persistSession:false`.
- **Secretos:**
  - `server-only` está en `auth`, `supabase/server`, `data` y `reports`.
  - El build no contiene `service_role` en `.next/static`.
  - No hay secretos reales en la historia de Git.
- **CSRF:** se aplica la comprobación de `Origin` de Next, sin `allowedOrigins` ampliados.
- **Callback:**
  - `type` solo admite `invite` o `recovery`.
  - `next` solo acepta el literal `/auth/password`.
  - El origen sale de `appOrigin()`, no de `Host`.
  - Lleva `no-store` y `no-referrer`.
- **`/comprobantes/[id]`:** valida el UUID, exige sesión, lee con RLS, devuelve un 404 uniforme y redirige con 303 y `no-store`.
- **Reportes:** la autenticación va antes de los filtros, y el CSV neutraliza `= + - @`, tabulador y CR, entrecomilla y añade BOM.
- **Cabeceras:** nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `noindex` y sin `X-Powered-By`.
- **XSS:** no hay `dangerouslySetInnerHTML`, `innerHTML` ni `eval`.
- **Doble envío:** el botón se desactiva con `pending` y las claves de idempotencia se generan en el servidor, conservándose en los reintentos.
- **Login:** el mensaje de error es el mismo para cualquier fallo.

---

## 5. Inconsistencias documentales

| Ubicación                              | Qué dice                                           | Qué hay realmente                                     |
| -------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `DATABASE.md:3-10`                     | 6 migraciones                                      | Hay 7 (ya reconocido en el handoff)                   |
| `DATABASE.md:97-108`                   | Lista de funciones                                 | Omite las funciones de las migraciones 3 a 6          |
| `DEPLOYMENT.md:5`                      | La prueba autenticada de la Preview está pendiente | La línea 9 dice que ya se verificó                    |
| `DEPLOYMENT.md:14,48`                  | Región us-east-1                                   | La base está en ca-central-1                          |
| `DEPLOYMENT.md:47` y `ACCEPTANCE.md:3` | Supabase de desarrollo / `cuadria-dev`             | No existe ese proyecto                                |
| `README.md:7,73-75`                    | El próximo hito es conectar Supabase               | Supabase ya está conectado                            |
| README, UI y `DEPLOYMENT.md:21`        | "Máximo 10 MB"                                     | El límite efectivo en Vercel es de unos 4,5 MB (H-07) |
| Handoff §7 y `PROGRESS.md:37`          | 8 reintentos simultáneos                           | Como mucho 7 (H-42)                                   |
| Handoff §8.2                           | La concurrencia se ejecuta con Docker              | No ofrece alternativa sin Docker                      |

---

## 6. No verificado y por qué

- **Peticiones HTTP reales a PostgREST, Storage (MIME, upsert, TUS, caducidad de URLs) y GoTrue con JWT de varios usuarios:** no hubo conexión remota autorizada. Los pasos de reproducción por HTTP de H-04 y H-18 salen del código.
- **Configuración remota de Supabase:** Auth (`secure_password_change`, longitud mínima, CAPTCHA, `rate_limit`, MFA, signup), privilegios reales de `service_role`, pg_graphql y Realtime.
- **Vercel:** Skew Protection, el límite real de 4,5 MB en este proyecto, el Firewall, HSTS y los otros 3 proyectos.
- **Suite oficial `npm run test:concurrency`:** no se ejecutó por la restricción de permisos descrita en §2. Una carrera equivalente sí se reprodujo en los escenarios propios.
- **Circuito `docs/ACCEPTANCE.md`, entrega de correo, aceptación de invitaciones y recuperación por un destinatario real.**
- **Restauración de la base y de Storage.**
- **Rendimiento con más de 100 000 asientos y exportación masiva:** limitación ya declarada en el handoff §9.5.
- **Cómo interpretan Excel y LibreOffice ciertos caracteres Unicode en el CSV.**

---

## 7. Prioridades recomendadas

1. **Antes de cualquier uso con dinero real:**
   - H-01: separar entornos y quitar la clave de la Preview.
   - H-02: ensayo de restauración.
   - H-04: limitar `assign_member`.
   - H-05 y H-06: retroactividad y fondos inactivos.
   - H-17: PR y protección de rama.
2. **Antes de dar acceso a usuarios externos:**
   - H-07: subida directa a Storage.
   - H-08: Skew Protection y manejo del error.
   - H-09 y H-10: reautenticación, CAPTCHA y rate limit.
   - H-11, H-12 y H-13: proyectos Vercel, SMTP transaccional y configuración versionada.
3. **Calidad continua:**
   - H-03, H-14, H-15 y H-16: pruebas de integración con Supabase local, lista blanca de grants y casos que faltan.
   - H-42: un harness de concurrencia más estricto.
4. **Endurecimiento:** el resto de hallazgos Bajos e Informativos, empezando por H-18 a H-24, H-30 y H-34.

---

## 8. Artefactos de la auditoría

Se conservaron en el directorio temporal de la sesión de auditoría, fuera del repositorio (no versionados):

| Ruta         | Contenido                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `audit-src/` | Checkout aislado (worktree desacoplado) del SHA revisado                                                                    |
| `agent-sql/` | `stub.sql`, `reset.sh`, `scenarios*.sql` y sus salidas `.out` (autorización y aislamiento)                                  |
| `agent-fin/` | `setup.sh` y `s1_domain.sql` … `s7_assign.sql`, `t6.sql` (carrera) y `csv.mjs` (integridad financiera)                      |
| `agent-ci/`  | `logs/*.log` y `logs/summary.txt`, la configuración Playwright de la auditoría, `acl/acl-check.mjs` y el Node 24 descargado |

Nota de proceso: para arrancar PostgreSQL como usuario sin privilegios, uno de los revisores cambió a 755 los permisos de algunos directorios del scratchpad temporal; no tocó nada fuera de él ni del repositorio.
