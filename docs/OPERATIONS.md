# Operación de CUADRIA: runbooks y checklist

Estado: **ningún procedimiento de este documento está ejecutado todavía**. Esta guía cierra, como documentación, los hallazgos operativos del informe de auditoría ([AUDIT_REPORT.md](AUDIT_REPORT.md)): H-01, H-02, H-11, H-12, H-13, H-17, H-37, H-43 y la parte de regiones de H-54. Cada control se da por cumplido solo cuando el responsable lo ejecuta y deja evidencia en el acta (sección 12).

Reglas para usar esta guía:

- La ejecuta el propietario o un administrador técnico autorizado por él, desde los paneles oficiales o la CLI con su propia sesión.
- No contiene secretos ni identificadores reales. Los marcadores `<ref-dev>`, `<ref-prod>`, `<dominio>` y similares se sustituyen al ejecutar, nunca en el repositorio.
- No copiar claves, contraseñas, cookies, JWT, URLs firmadas ni volcados en Git, chats, tickets o capturas. Las capturas de evidencia se recortan para no mostrar valores.
- Los paneles de Supabase, Vercel, GitHub y Google cambian de nombre y ubicación. Si una opción no aparece donde se indica, buscarla en la documentación oficial vigente y anotar la ruta real en el acta.
- Ningún paso autoriza contratar planes de pago. Donde una función depende del plan, la decisión es del propietario.

## Índice

1. [Separación de entornos y clave administrativa](#1-separación-de-entornos-y-clave-administrativa-h-01)
2. [Región de base de datos y funciones](#2-región-de-base-de-datos-y-funciones-h-54)
3. [Rama `main` protegida y despliegue solo desde CI verde](#3-rama-main-protegida-y-despliegue-solo-desde-ci-verde-h-17-h-01)
4. [Inventario y desconexión de proyectos Vercel](#4-inventario-y-desconexión-de-proyectos-vercel-h-11)
5. [Skew Protection de Vercel](#5-skew-protection-de-vercel-h-08)
6. [SMTP transaccional con dominio propio](#6-smtp-transaccional-con-dominio-propio-h-12)
7. [Ajustes de Supabase Auth](#7-ajustes-de-supabase-auth-h-09-h-10-h-13)
8. [Backup y ensayo de restauración](#8-backup-y-ensayo-de-restauración-h-02)
9. [Baja de personal](#9-baja-de-personal-h-37)
10. [Repositorio, secret scanning y push protection](#10-repositorio-secret-scanning-y-push-protection-h-43)
11. [Aplicación ordenada de migraciones nuevas](#11-aplicación-ordenada-de-migraciones-nuevas)
12. [Checklist verificable y acta](#12-checklist-verificable-y-acta)

---

## 1. Separación de entornos y clave administrativa (H-01)

### Situación de partida (informe, 21-10-2026)

- Un solo proyecto Supabase, con la cuenta real del propietario y una empresa creada.
- La Preview de la rama de trabajo usa ese proyecto y guarda `SUPABASE_SERVICE_ROLE_KEY`.
- No hay producción ni separación entre desarrollo y producción.

### Topología objetivo

| Entorno    | Supabase                      | Vercel                                                         | Quién lo usa                       |
| ---------- | ----------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| Local      | `supabase start` (contenedor) | `npm run dev`                                                  | Desarrollo, pruebas sintéticas     |
| Desarrollo | `cuadria-dev`                 | Entorno **Preview** del proyecto canónico `cuadria`            | Pruebas con usuarios sintéticos    |
| Producción | `cuadria-prod`                | Entorno **Production** del proyecto `cuadria`, solo desde main | Operación real tras aprobar piloto |

Ningún dato real ni clave de producción en Preview, Development o en equipos locales.

### Decisión previa: qué hacer con el proyecto existente

- **Opción A (recomendada):** tratar el proyecto existente como **desarrollo**. Estuvo expuesto a despliegues sin revisión con la clave administrativa, así que no conviene convertirlo en producción. Crear `cuadria-prod` limpio. Antes de empezar, el propietario confirma que no hay datos financieros reales que conservar; si los hubiera, se migran con el procedimiento de la sección 8 y se registra en el acta.
- **Opción B:** convertir el existente en producción y crear `cuadria-dev` nuevo. Exige además la rotación completa del paso 1.4 y revisar los usuarios y la auditoría existentes.

Registrar la opción elegida y el motivo en el acta.

### 1.1 Crear el proyecto que falte

1. Supabase → New project. Nombre `cuadria-prod` (opción A) o `cuadria-dev` (opción B). Región según la sección 2.
2. Contraseña de base de datos única, generada y guardada solo en el gestor de contraseñas del propietario.
3. Aplicar las migraciones en orden con la CLI enlazada al proyecto nuevo, desde un checkout limpio de `main`:
   ```sh
   npx supabase login
   npx supabase link --project-ref <ref-nuevo>
   npx supabase db push --dry-run   # revisar la lista: todas las migraciones, en orden
   npx supabase db push
   npx supabase migration list      # todas como aplicadas en local y remoto
   ```
4. Aplicar los ajustes de Auth de la sección 7 y el SMTP de la sección 6.
5. Comprobar en SQL Editor:
   ```sql
   select count(*) filter (where not c.relrowsecurity) as sin_rls, count(*) as tablas
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'receipts';
   ```
   Esperado: `sin_rls = 0`; bucket `receipts` privado con JPG/PNG/PDF.
6. Crear al propietario en Authentication → Users y ejecutar `supabase/bootstrap-owner.sql` con su UUID (ver [DEPLOYMENT.md](DEPLOYMENT.md)).

### 1.2 Variables de Vercel por entorno

En Vercel → proyecto `cuadria` → Settings → Environment Variables:

| Variable                               | Production (solo `main`)                     | Preview                                                          | Development |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL de prod                                  | URL de dev                                                       | URL de dev  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | clave publicable de prod                     | clave publicable de dev                                          | dev         |
| `NEXT_PUBLIC_APP_URL`                  | dominio de producción                        | URL estable de Preview                                           | localhost   |
| `SUPABASE_SERVICE_ROLE_KEY`            | clave secreta de prod, marcada **Sensitive** | **ninguna** o, si hace falta probar invitaciones, solo la de dev | ninguna     |

1. Eliminar `SUPABASE_SERVICE_ROLE_KEY` de Preview (incluido el valor asociado a la rama de trabajo).
2. Volver a desplegar la Preview: las variables se leen al compilar y al arrancar.
3. Comprobar en Settings → Environment Variables que la clave solo aparece en Production. Anotar nombres y entornos, nunca valores.

### 1.3 Rotar la clave administrativa expuesta

Hacerlo **después** de separar los entornos, en el proyecto cuya clave estuvo en la Preview:

1. Supabase → Project Settings → API Keys. Crear una **clave secreta nueva** (formato de claves secretas actual) para el servidor.
2. Guardarla en Vercel Production (Sensitive) en lugar de la anterior y redesplegar producción.
3. Probar una invitación a un buzón de prueba autorizado.
4. Revocar la clave antigua. Si era la clave legacy `service_role` (JWT), desactivar las claves legacy cuando la aplicación ya use las nuevas, o rotar el JWT secret. Rotar el JWT secret invalida todas las sesiones y la clave anon legacy: planificar una ventana y avisar a los usuarios.
5. Revisar en los logs de Supabase (API/Auth) el uso de la clave antigua entre la exposición y la revocación. Anotar el resultado.

**Verificación:** una llamada administrativa con la clave antigua devuelve error de autenticación; la invitación con la nueva funciona.

---

## 2. Región de base de datos y funciones (H-54)

La base existente está en `ca-central-1` (Canadá) y `vercel.json` fija las funciones en `iad1` (Washington, D.C.). Cada consulta cruza esa distancia. Opciones:

1. **Producción nueva en `us-east-1`** junto a `iad1`. Es la opción de [DEPLOYMENT.md](DEPLOYMENT.md) y no exige cambiar `vercel.json`.
2. **Mantener Canadá** y mover las funciones a la región Vercel más cercana a `ca-central-1` (cambio en `vercel.json`, en un PR propio, comprobando que la región esté disponible en el plan).

Antes de decidir: resolver cualquier obligación de residencia de datos y medir la latencia desde Colombia en la Preview (tiempo de una página autenticada, 10 muestras). Anotar la decisión en el acta y en DEPLOYMENT.

---

## 3. Rama `main` protegida y despliegue solo desde CI verde (H-17, H-01)

### 3.1 Integrar por PR

1. Abrir un PR desde la rama de trabajo hacia `main`. No hacer force push ni reemplazar la historia de `main`.
2. Esperar el workflow **Quality** completo en verde para el último commit del PR.

### 3.2 Regla de protección de `main`

GitHub → Settings → Rules → Rulesets → New branch ruleset (o Branches → Branch protection rules):

- Objetivo: rama por defecto (`main`). Enforcement: **Active**. Sin bypass, o solo para el propietario y registrado.
- **Require a pull request before merging.** Si hay un segundo desarrollador: 1 aprobación y descartar aprobaciones al hacer push. Con una sola persona, GitHub no permite autoaprobar: mantener el PR obligatorio y anotarlo como riesgo aceptado.
- **Require status checks to pass**: añadir el check `verify` (job del workflow Quality) y **Require branches to be up to date**. El job `e2e-webkit` es informativo y no se exige.
- **Block force pushes** y **Restrict deletions**.
- Opcional: Require linear history y Require signed commits.

### 3.3 Sin `[skip ci]` en commits que se despliegan

- No usar `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` ni `[actions skip]` en commits que vayan a `main` ni en ramas con Preview.
- Con la regla 3.2, un commit que salte CI deja `verify` pendiente y el PR no se puede fusionar.
- Comprobación antes de fusionar:
  ```sh
  git log --oneline -i -E --grep='\[(skip ci|ci skip|no ci|skip actions|actions skip)\]' origin/main..HEAD
  ```
  Esperado: sin resultados.

### 3.4 Vercel solo publica lo verificado

1. Vercel → Settings → Git → **Production Branch** = `main`.
2. Activar **Deployment Checks** (o el mecanismo equivalente vigente) exigiendo el check `verify` de GitHub antes de asignar el dominio de producción.
3. Mantener Vercel Authentication en las Preview.

**Verificación:** un PR de prueba con un fallo deliberado de formato no puede fusionarse; un push directo a `main` es rechazado.

---

## 4. Inventario y desconexión de proyectos Vercel (H-11)

Hay cuatro proyectos conectados al repositorio: `cuadria` (canónico), `cuadria-caja`, `cuadria-app` y `cuadria-czyg`.

1. Para cada proyecto, rellenar la tabla del acta (sin valores de variables):

   | Proyecto | Repo conectado | Production Branch | Dominios | Variables (solo nombres y entornos) | Deployment Protection | Último despliegue |
   | -------- | -------------- | ----------------- | -------- | ----------------------------------- | --------------------- | ----------------- |

2. En los tres no canónicos, en este orden:
   1. Settings → Environment Variables: borrar cualquier clave o secreto. Si alguno tenía `SUPABASE_SERVICE_ROLE_KEY`, incluir ese proyecto en la rotación de la sección 1.3.
   2. Settings → Git → **Disconnect** del repositorio.
   3. Settings → Deployment Protection: dejar Vercel Authentication activa en todos los entornos mientras exista el proyecto.
   4. Tras confirmar el propietario que no se usan: eliminar el proyecto (Settings → Advanced → Delete Project). Si hay dudas, pausarlo y anotar una fecha de revisión.
3. En GitHub → Settings → Integrations → GitHub Apps → Vercel, limitar el acceso de la app a los repositorios necesarios.

**Verificación:** en el siguiente push solo aparece un estado de despliegue de Vercel (el de `cuadria`) en el commit o PR.

---

## 5. Skew Protection de Vercel (H-08)

1. Vercel → proyecto `cuadria` → Settings → Advanced → **Skew Protection**: activar (puede depender del plan) y fijar una antigüedad máxima de al menos 12 horas.
2. Redesplegar.
3. Prueba: abrir una página con formulario, desplegar una versión nueva y enviar el formulario desde la pestaña antigua. Esperado: la acción se resuelve contra el despliegue anterior, o la aplicación muestra el aviso de "CUADRIA se actualizó; recarga" cuando ese cambio de código esté integrado. No debe aparecer la pantalla genérica de error.

---

## 6. SMTP transaccional con dominio propio (H-12)

Requiere un dominio propio controlado por el propietario.

1. Elegir un proveedor transaccional (por ejemplo Amazon SES, Postmark, Resend, Brevo o SendGrid). Registrar en el acta el proveedor, el plan y los límites de envío.
2. Verificar el dominio de envío en el proveedor y publicar en el DNS de `<dominio>`:
   - **SPF:** un único registro TXT `v=spf1 include:<proveedor> -all` (o `~all` durante la transición).
   - **DKIM:** los CNAME o TXT que indique el proveedor.
   - **DMARC:** `_dmarc.<dominio>` TXT `v=DMARC1; p=none; rua=mailto:<buzón-de-informes>`. Tras dos semanas de informes limpios, pasar a `p=quarantine` y después a `p=reject`.
3. Comprobar la alineación con una herramienta de verificación de cabeceras sobre un correo de prueba: SPF, DKIM y DMARC en `pass`.
4. Supabase → Authentication → Emails → SMTP Settings, en **cada** proyecto: host, puerto, usuario y contraseña del proveedor; remitente `no-reply@<dominio>` y nombre "CUADRIA". Desarrollo puede usar un subdominio o un modo sandbox del proveedor.
5. Enviar una invitación y una recuperación solo a buzones de prueba autorizados y comprobar la entrega, el enlace (`/auth/callback` del entorno correcto) y que no llegan a spam.
6. Revocar la contraseña de aplicación de Gmail: cuenta de Google → Seguridad → Contraseñas de aplicaciones → eliminar la creada para Supabase. Revisar la actividad reciente y los dispositivos de la cuenta.
7. Revisar en Authentication → Rate Limits el límite de correos por hora acorde al proveedor.

**Verificación:** la contraseña de aplicación ya no figura en Google; un correo de invitación de prueba llega con DMARC `pass` desde `<dominio>`.

---

## 7. Ajustes de Supabase Auth (H-09, H-10, H-13)

Aplicar en **cada** proyecto (dev y prod) y anotar el valor observado en el acta. Los valores que admite `supabase/config.toml` deben versionarse allí en un cambio aparte.

| Ajuste (panel)                                           | Valor requerido                                                | Motivo                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Allow new users to sign up                               | **Desactivado**                                                | Las invitaciones suponen que nadie puede registrar un correo ajeno |
| Confirm email                                            | **Activado**                                                   | La aceptación de invitaciones exige correo verificado              |
| Proveedores OAuth/SSO                                    | **Ninguno** habilitado                                         | Un proveedor podría marcar correos como verificados                |
| Secure password change (`secure_password_change`)        | **Activado**                                                   | Cambiar la contraseña exige sesión reciente o reautenticación      |
| Minimum password length                                  | **12**                                                         | Igualar la regla de la aplicación                                  |
| Password requirements                                    | Letras y dígitos como mínimo                                   | Endurecimiento                                                     |
| Leaked password protection                               | Activado si el plan lo permite                                 | Contraseñas filtradas                                              |
| Secure email change                                      | Activado                                                       | Confirmación en ambos correos                                      |
| Site URL y Redirect URLs                                 | Origen exacto del entorno y su `/auth/callback`, sin comodines | Evitar redirecciones a orígenes ajenos                             |
| Rate limits (correos, verificaciones, inicios de sesión) | Revisar y anotar                                               | H-10                                                               |
| Sesiones: time-box o inactividad                         | Valorar 12-24 h si el plan lo permite                          | H-34                                                               |
| CAPTCHA (Turnstile o hCaptcha)                           | **Opcional; solo cuando la aplicación envíe el token**         | Activarlo sin soporte en la app bloquea el login                   |
| MFA para administradores                                 | Valorar                                                        | H-09                                                               |

Notas:

- `secure_password_change` exige que la aplicación pida reautenticación; si el cambio de código correspondiente no está desplegado, el cambio de contraseña desde la app puede fallar. Comprobarlo en dev antes de prod.
- CAPTCHA: activarlo en el panel solo cuando la aplicación incluya `captchaToken` en login y recuperación (pendiente de código). Hasta entonces, usar el Firewall de Vercel para limitar los POST a `/login`.

**Verificación:** en dev, un registro directo con la clave publicable falla; una contraseña de 8 caracteres se rechaza; cambiar la contraseña sin reautenticar se rechaza.

---

## 8. Backup y ensayo de restauración (H-02)

### 8.1 Objetivos propuestos (los fija el propietario)

| Objetivo  | Propuesta para el piloto                                  | Requisito                                                         |
| --------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| RPO       | ≤ 24 h                                                    | Backups diarios gestionados por Supabase, más la copia lógica 8.2 |
| RTO       | ≤ 4 h                                                     | Procedimiento 8.4 ensayado y cronometrado                         |
| Retención | ≥ 7 días gestionados y 30 días de copias lógicas cifradas | Almacenamiento externo del propietario                            |

Un RPO menor exige PITR (complemento de pago). El plan gratuito no ofrece backups descargables gestionados: operar con dinero real sin un plan con backups es un riesgo que el propietario debe aceptar por escrito.

### 8.2 Copia lógica de la base

Desde un equipo de confianza, con la cadena de conexión introducida de forma interactiva o en una variable de la sesión, nunca en archivos del repositorio:

```sh
npx supabase db dump --db-url "$DB_URL" -f roles.sql --role-only
npx supabase db dump --db-url "$DB_URL" -f schema.sql
npx supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only
sha256sum roles.sql schema.sql data.sql > SHA256SUMS
```

Cifrar los archivos (por ejemplo con `age` o `gpg`), guardarlos fuera del repositorio y borrar las copias en claro. Contrastar con la guía oficial vigente de backup y restauración por CLI los esquemas que incluye o excluye cada volcado.

### 8.3 Copia del bucket `receipts`

Los backups de la base **no** incluyen los objetos de Storage.

1. Supabase → Storage → S3 Connection: crear claves de acceso S3 **temporales** para esta copia.
2. Sincronizar el bucket con un cliente S3 compatible:
   ```sh
   aws s3 sync s3://receipts ./receipts-<fecha> \
     --endpoint-url "https://<ref>.storage.supabase.co/storage/v1/s3" --region <region>
   ```
3. Contar objetos y bytes; cifrar y guardar junto a la copia de la base.
4. Revocar las claves S3 temporales.

### 8.4 Ensayo de restauración (obligatorio antes del piloto)

En un proyecto **separado y nuevo** (`cuadria-restore-<fecha>`), nunca sobre dev ni prod:

1. Iniciar el cronómetro.
2. Restaurar roles, esquema y datos:
   ```sh
   psql "$RESTORE_DB_URL" --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql
   ```
3. Subir los objetos de `receipts` con las mismas rutas (`aws s3 sync ./receipts-<fecha> s3://receipts --endpoint-url ...`).
4. Conciliar. Todas deben coincidir con los valores anotados en origen al hacer la copia:
   ```sql
   -- Saldo = suma de asientos en cada fondo (esperado: 0 filas)
   select f.id from public.funds f left join public.entries e on e.fund_id = f.id
   group by f.id having f.balance <> coalesce(sum(e.amount), 0);
   -- Conteos para el acta
   select (select count(*) from public.movements) movimientos, (select count(*) from public.entries) asientos,
          (select count(*) from public.period_closures) cierres, (select count(*) from public.receipts) comprobantes,
          (select count(*) from storage.objects where bucket_id = 'receipts') objetos,
          (select sum(balance) from public.funds) saldo_total;
   -- Comprobantes sin objeto (debería coincidir con el origen)
   select count(*) from public.receipts r
   where not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = r.object_path);
   ```
5. Abrir un comprobante restaurado con un usuario de prueba de la empresa y comprobar que otro usuario sin acceso no lo puede leer.
6. Detener el cronómetro y anotar la duración real frente al RTO.
7. Eliminar el proyecto de restauración y las copias en claro. Anotarlo en el acta.

Repetir el ensayo antes del piloto, cada trimestre y después de migraciones que cambien tablas de dinero.

---

## 9. Baja de personal (H-37)

No borrar usuarios de Auth: 14 claves foráneas a `auth.users` no tienen `ON DELETE` y el historial debe conservar al actor. La baja se hace así, en este orden:

1. **Finalizar asignaciones** de fondos del usuario (Empresas → asignaciones, o RPC `assign_fund(p_fund, p_user, true)` por cada fondo).
2. **Revocar invitaciones pendientes** dirigidas a su correo (Empresas → invitaciones, o RPC `revoke_invitation`).
3. **Desactivar la membresía** en cada empresa. Con la membresía inactiva, `private.company_role` deja de devolver rol y el acceso a datos se corta en la siguiente petición.
   - Si existe la RPC de desactivación de miembros (prevista por H-04), usarla desde la aplicación.
   - Si no existe, el propietario lo hace en SQL Editor, dentro de una transacción y dejando auditoría:
     ```sql
     begin;
     update public.memberships set active = false
      where company_id = '<empresa>' and user_id = '<usuario>' returning *;
     insert into public.audit_events(company_id, actor_id, action, entity_id, details)
     values ('<empresa>', '<uuid-del-propietario>', 'membership.deactivated', '<usuario>',
             jsonb_build_object('reason', '<motivo>', 'channel', 'sql-editor'));
     commit;
     ```
4. **Bloquear el acceso en Auth:** Authentication → Users → usuario → **Ban user** con duración indefinida. Los tokens de acceso ya emitidos siguen siendo válidos hasta su caducidad (por defecto 1 hora), pero el paso 3 ya impide leer y operar.
5. Si era administrador técnico: retirarlo de los equipos de Supabase, Vercel y GitHub, y rotar cualquier secreto al que tuviera acceso (secciones 1.3 y 6).
6. Anotar en el acta: fecha, empresa, usuario (UUID, sin datos personales innecesarios), pasos y responsable.

**Verificación:** el usuario no puede iniciar sesión; una petición con un token suyo anterior a la baja no devuelve datos de la empresa (`FORBIDDEN` o lista vacía).

---

## 10. Repositorio, secret scanning y push protection (H-43)

El repositorio es público y la documentación histórica expone datos operativos (referencia del proyecto, URL de la Preview, equipo de Vercel, uso de Gmail). La búsqueda del informe no encontró secretos reales en la historia.

1. **Visibilidad:** valorar pasarlo a privado (Settings → General → Danger Zone → Change visibility). Las integraciones de Vercel y Supabase siguen funcionando. La historia publicada ya pudo copiarse: tratar como expuesto lo que contenía y rotar si hubiera duda.
2. **Secret scanning y push protection:** Settings → Code security → activar Secret scanning y Push protection. En repositorios públicos es gratuito. En privados puede requerir una licencia de GitHub Secret Protection; sin ella, añadir un escáner de secretos en CI (por ejemplo gitleaks) antes de cambiar la visibilidad.
3. **Dependabot:** activar Dependabot alerts y security updates. Las actualizaciones de versión ya están en `.github/dependabot.yml`.
4. **Documentación:** no añadir referencias de proyecto, URLs de Preview, correos personales ni ubicación de claves. Usar marcadores como en esta guía.
5. **Acceso:** revisar colaboradores, deploy keys, webhooks y GitHub Apps con acceso al repositorio.

---

## 11. Aplicación ordenada de migraciones nuevas

Aplica a `202610210001`, `202610210002` y `202610210003` (correcciones de la auditoría) y a cualquier migración futura.

Requisitos previos:

- PR con el workflow Quality en verde, incluido `test:concurrency` sobre PostgreSQL 17 con todas las migraciones.
- Notas del PR revisadas: si una migración cambia la firma de una RPC (por ejemplo, añadir `p_key`), la aplicación nueva y la migración deben publicarse en la misma ventana, con Skew Protection activa (sección 5).
- Copia lógica reciente del entorno de destino (sección 8.2).

Procedimiento, **primero en dev** y después en prod:

1. `npx supabase link --project-ref <ref-dev>`.
2. `npx supabase db push --dry-run`. Esperado: solo las migraciones nuevas, en orden ascendente (`202610210001`, `202610210002`, `202610210003`). Si aparece cualquier otra, detenerse.
3. `npx supabase db push` y `npx supabase migration list`: las tres figuran como aplicadas.
4. Si se aplicaron desde SQL Editor (un archivo por vez, en orden y dentro de una transacción), registrar el historial con `npx supabase migration repair --status applied <versión>`.
5. Comprobaciones en SQL Editor: la consulta de RLS de la sección 1.1 (`sin_rls = 0`), la conciliación saldo = asientos de la sección 8.4 (0 filas) y que las funciones `SECURITY DEFINER` siguen con `search_path` fijo:
   ```sql
   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
   ```
   Esperado: 0 filas.
6. Desplegar la Preview con el código correspondiente y ejecutar los casos afectados de [ACCEPTANCE.md](ACCEPTANCE.md).
7. Repetir los pasos 1-5 en prod en una ventana anunciada, con una copia lógica tomada justo antes. Promover el despliegue de producción a continuación.
8. No editar nunca una migración ya aplicada. La marcha atrás es una migración correctiva nueva o la restauración de la sección 8.

---

## 12. Checklist verificable y acta

Copiar esta tabla al acta (fuera del repositorio si contiene datos sensibles) y completar cada fila.

| #   | Control                                                           | Hallazgo   | Cómo se verifica                                                | Evidencia (fecha, responsable) | Estado |
| --- | ----------------------------------------------------------------- | ---------- | --------------------------------------------------------------- | ------------------------------ | ------ |
| 1   | Proyectos `cuadria-dev` y `cuadria-prod` separados                | H-01       | Dos proyectos; la Preview apunta a dev (variables, sin valores) |                                | ☐      |
| 2   | Sin `SUPABASE_SERVICE_ROLE_KEY` de prod en Preview                | H-01       | Lista de variables por entorno                                  |                                | ☐      |
| 3   | Clave administrativa rotada y antigua revocada                    | H-01       | Llamada con la clave antigua rechazada                          |                                | ☐      |
| 4   | Región decidida y documentada                                     | H-54       | Decisión en el acta y en DEPLOYMENT                             |                                | ☐      |
| 5   | `main` protegida: PR + check `verify` obligatorio                 | H-17       | PR de prueba bloqueado; push directo rechazado                  |                                | ☐      |
| 6   | Producción solo desde `main` con Deployment Checks                | H-01       | Configuración de Vercel                                         |                                | ☐      |
| 7   | Sin `[skip ci]` en commits desplegables                           | H-17       | Comando de la sección 3.3 sin resultados                        |                                | ☐      |
| 8   | Tres proyectos Vercel no canónicos desconectados                  | H-11       | Un solo estado de Vercel por push                               |                                | ☐      |
| 9   | Skew Protection activa                                            | H-08       | Prueba de pestaña antigua                                       |                                | ☐      |
| 10  | SMTP transaccional con SPF/DKIM/DMARC                             | H-12       | Cabeceras con DMARC `pass`                                      |                                | ☐      |
| 11  | Contraseña de aplicación de Gmail revocada                        | H-12       | Lista de contraseñas de aplicación vacía                        |                                | ☐      |
| 12  | Auth: signup off, confirmación, secure password change, mínimo 12 | H-09, H-13 | Tabla de la sección 7 con valores observados                    |                                | ☐      |
| 13  | RPO/RTO aprobados por el propietario                              | H-02       | Firma en el acta                                                |                                | ☐      |
| 14  | Ensayo de restauración de base y `receipts`                       | H-02       | Conciliación sin diferencias y duración ≤ RTO                   |                                | ☐      |
| 15  | Procedimiento de baja ensayado con un usuario de prueba           | H-37       | Verificación de la sección 9                                    |                                | ☐      |
| 16  | Visibilidad del repo decidida; secret scanning/push protection    | H-43       | Settings → Code security                                        |                                | ☐      |
| 17  | Migraciones `202610210001`-`003` en dev y luego en prod           | —          | `supabase migration list` en ambos                              |                                | ☐      |

Plantilla de acta por actividad: fecha y hora (America/Bogota), entorno, responsable, commit desplegado, pasos ejecutados, resultado esperado y observado, duración, incidencias y decisión. Sin secretos.
