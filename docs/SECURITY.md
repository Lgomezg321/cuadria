# Seguridad de la cadena de suministro y excepciones

Este documento registra los controles de dependencias y de CI, y las excepciones aceptadas con su fecha de revisión. Los runbooks de operación (entornos, claves, SMTP, backups, bajas) están en [OPERATIONS.md](OPERATIONS.md).

## Controles en CI (`.github/workflows/ci.yml`)

| Control                                    | Detalle                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Acciones fijadas por SHA completo          | `actions/checkout` v7.0.1 y `actions/setup-node` v7.1.0, ambas con runtime Node 24. El comentario indica la versión         |
| Sin credenciales persistidas               | `persist-credentials: false` en el checkout; permisos del token: `contents: read`                                           |
| Versiones exactas                          | Runner `ubuntu-24.04`, Node `24.22.0`, `postgres:17.10-bookworm` fijado por digest del índice multiarquitectura             |
| Navegador                                  | Chromium de la revisión que exige `@playwright/test` del lockfile (1.64.1 → revisión 1248, Chrome for Testing 156.0.8078.4) |
| Auditoría de producción (bloqueante)       | `npm audit --omit=dev` sin vulnerabilidades                                                                                 |
| Auditoría completa (bloqueante en crítico) | `npm audit --audit-level=critical`: muestra todo el árbol y falla solo con severidad crítica                                |
| Formato y espacios                         | `npm run format:check` y `git diff --check` contra el árbol vacío (todos los archivos versionados)                          |
| Árbol limpio                               | El pipeline no puede modificar archivos versionados (`git diff --exit-code`)                                                |
| Límites                                    | `timeout-minutes` por job y `concurrency` que cancela ejecuciones obsoletas de la misma ref                                 |
| Actualizaciones                            | Dependabot semanal para GitHub Actions y npm (`.github/dependabot.yml`)                                                     |

Dependabot no actualiza la imagen `postgres` de los servicios del workflow. Revisarla a mano cada trimestre: elegir la última `17.x` estable, obtener el digest del índice desde el registro oficial y actualizar a la vez la imagen y este documento.

## Scripts de instalación

npm 11 avisa de los paquetes con scripts de instalación no revisados. `package.json` → `allowScripts` registra los revisados:

| Paquete                | Script                                                                                   | Revisado   |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| `unrs-resolver@1.12.2` | `postinstall`: `napi-postinstall` comprueba o prepara el binario nativo de la plataforma | 2026-10-21 |

Cuando Dependabot cambie la versión, revisar el script de nuevo y aprobarlo con `npm approve-scripts unrs-resolver`.

## Excepciones de vulnerabilidades

### EXC-2026-01 · `braces` (GHSA-vfj7-8cjw-p6xm), solo desarrollo

| Campo          | Valor                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advisory       | GHSA-vfj7-8cjw-p6xm, severidad alta (CVSS 7.5): agotamiento de pila con patrones muy anidados (DoS)                                                                                                     |
| Rango afectado | `braces <= 3.0.3`, es decir, **todas** las versiones publicadas a 2026-10-21 (la última es 3.0.3)                                                                                                       |
| Cadena         | `eslint-config-next@16.4.2` → `@next/eslint-plugin-next@16.4.2` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`                                                                               |
| Alcance        | Solo `devDependencies` (lint). No entra en el build ni en el runtime: `npm audit --omit=dev` da 0                                                                                                       |
| Exposición     | `fast-glob` recibe patrones fijos de la configuración del plugin, no entradas de usuarios                                                                                                               |
| `overrides`    | No aplicable: no existe una versión parcheada de `braces`, y `micromatch` 4 y `fast-glob` 3 dependen de ella. `npm audit fix --force` propone bajar a `eslint-config-next@14`, incompatible con Next 16 |
| Decisión       | Aceptada. El gate de CI sigue siendo `--omit=dev`; el árbol completo se audita con `--audit-level=critical`                                                                                             |
| Revisión       | **2027-01-21** o antes si se publica una versión corregida de `braces` o `micromatch`, o si `@next/eslint-plugin-next` cambia de dependencia                                                            |
| Responsable    | Propietario del repositorio                                                                                                                                                                             |

En cada revisión: ejecutar `npm view braces version` y `npm audit`; si hay versión corregida, añadir un `overrides` en `package.json`, regenerar el lockfile con `npm install --package-lock-only` y comprobar `npm ci && npm run lint`. Si no, renovar la fecha.

## Secretos

- Nunca en Git, chats, logs ni capturas. `.env.local` está ignorado.
- `SUPABASE_SERVICE_ROLE_KEY` es exclusiva del servidor y solo de producción (ver OPERATIONS §1).
- `RECEIPT_VERIFICATION_SECRET` firma los veredictos de comprobantes (R-01). Es exclusiva del servidor, de al menos 32 caracteres, distinta por entorno y con el mismo valor en Supabase Vault (`cuadria_receipt_verification`); procedimiento y rotación en OPERATIONS §13.
- Si un secreto se expone, rotarlo primero y documentar después.

## Riesgos aceptados o pendientes

### RSK-2026-01 · Escritura de `service_role` fuera de las tablas financieras

| Campo      | Valor                                                                                                                                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Situación  | `202610210002` retira a `service_role` la escritura directa sobre las tablas de dinero (`funds`, `movements`, `entries`, `reviews`, `checks`, `check_reviews`, `period_closures`, `audit_events`). Conserva escritura en `memberships`, `installation_owners`, `assignments` y `receipts` |
| Riesgo     | Quien obtenga la clave secreta podría darse membresías o rol de propietario, asignarse fondos o alterar metadatos y estados de comprobantes sin pasar por las RPC ni dejar auditoría                                                                                                      |
| Mitigación | La clave solo está en el servidor de producción y solo se usa para `inviteUserByEmail` (OPERATIONS §1). Los asientos y saldos siguen protegidos por triggers y por la revocación anterior                                                                                                 |
| Decisión   | Pendiente del propietario: revocar también esa escritura en una migración futura tras comprobar en dev que Auth Admin y los procesos de soporte no la necesitan. No verificado contra Supabase real                                                                                       |
| Revisión   | Antes del piloto con dinero real                                                                                                                                                                                                                                                          |

## Reporte de vulnerabilidades

Reportar de forma privada al propietario del repositorio, mediante GitHub Security Advisories (Security → Report a vulnerability) si está habilitado, sin abrir un issue público. No incluir datos reales ni credenciales en el reporte.
