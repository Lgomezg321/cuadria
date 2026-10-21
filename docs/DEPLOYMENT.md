# Instalación y despliegue de CUADRIA

## Estado real (2026-10-21)

- **Supabase:** existe un único proyecto, `cuadria`, en `ca-central-1`, con las siete migraciones iniciales aplicadas. No existen todavía proyectos separados `cuadria-dev` ni `cuadria-prod` (H-01). La referencia del proyecto se consulta en el panel; no se publica aquí.
- **Vercel:** el proyecto canónico es `cuadria`, con una Preview de la rama de trabajo protegida por Vercel Authentication. Al publicar la rama, GitHub reportó despliegues automáticos de otros tres proyectos (`cuadria-caja`, `cuadria-app` y `cuadria-czyg`), pendientes de inventario y desconexión (H-11, [OPERATIONS §4](OPERATIONS.md#4-inventario-y-desconexión-de-proyectos-vercel-h-11)). No hay despliegue de producción.
- **Sesión real:** el 2026-10-20 se verificó una sesión real del propietario en el panel y en Empresas, persistente al recargar. Sigue pendiente el circuito autenticado completo de [ACCEPTANCE.md](ACCEPTANCE.md).
- **Riesgo abierto:** la Preview usa el único proyecto Supabase y guarda `SUPABASE_SERVICE_ROLE_KEY`. Antes de cualquier uso con dinero real hay que separar entornos y rotar la clave ([OPERATIONS §1](OPERATIONS.md#1-separación-de-entornos-y-clave-administrativa-h-01)).

No enviar secretos por chat.

## Instalación existente verificada (2026-10-20)

Se reutilizó el proyecto Supabase `cuadria`, en `ca-central-1`. Las siete migraciones están aplicadas y registradas; no repetir el paquete inicial. RLS está habilitado en las 17 tablas públicas y en la idempotencia privada. El bucket `receipts` es privado y el registro público está deshabilitado. `.env.local` contiene solo URL, clave publicable y origen local, sin clave administrativa. Las tres variables públicas de Preview están guardadas en Vercel `cuadria`. La primera cuenta la creó el usuario y se activó como propietaria tras su autorización expresa. El framework de Vercel se corrigió de Other a Next.js; la Preview muestra portada y login. La Site URL de Supabase y cuatro callbacks exactos están configurados para Preview y local. Queda configurar la empresa y validar el circuito operativo.

## Supabase: guía para instalaciones nuevas

Los entornos objetivo son `cuadria-dev` (Preview) y `cuadria-prod` (producción desde `main`). Cuál se crea primero depende de la decisión sobre el proyecto existente descrita en [OPERATIONS §1](OPERATIONS.md#1-separación-de-entornos-y-clave-administrativa-h-01).

1. Ingresar en https://supabase.com/dashboard y seleccionar la organización propia.
2. Crear el proyecto (`cuadria-dev` o `cuadria-prod`). La región se decide según [OPERATIONS §2](OPERATIONS.md#2-región-de-base-de-datos-y-funciones-h-54): **East US (North Virginia), us-east-1** mantiene base y funciones Vercel (`iad1`) en la misma zona; el proyecto existente está en `ca-central-1`, lejos de `iad1`. Medir latencia desde Colombia; no se afirma que una región sea la más rápida. Si existe una obligación de residencia de datos, resolverla antes de crear producción.
3. Generar una contraseña de base de datos única y guardarla en el gestor de contraseñas. No compartirla en el chat ni guardarla en el repositorio. No contratar un plan de pago sin autorización del propietario.
4. Mantener Data API habilitada. No desactivar RLS. Aplicar los ajustes de Auth de [OPERATIONS §7](OPERATIONS.md#7-ajustes-de-supabase-auth-h-09-h-10-h-13): correo/contraseña, confirmación obligatoria, registro público deshabilitado, sin proveedores OAuth, `secure_password_change` y longitud mínima 12. Configurar un SMTP transaccional ([OPERATIONS §6](OPERATIONS.md#6-smtp-transaccional-con-dominio-propio-h-12)) antes de invitar empleados reales.
5. En el diálogo Connect/API keys obtener Project URL y publishable key; configurar los campos correspondientes de `.env.local` o las variables de Vercel del entorno correcto. No usar la clave secreta o `service_role` como clave pública.
6. Aplicar las migraciones con la CLI y una sesión autorizada: `npx supabase login`, `npx supabase link --project-ref REFERENCIA_DEL_PROYECTO`, `npx supabase db push --dry-run` y `npx supabase db push`. Introducir credenciales solo en los mecanismos interactivos seguros. Alternativamente, el administrador puede ejecutar los archivos de migración en orden desde SQL Editor y registrar el historial con `npx supabase migration repair`. Las migraciones nuevas siguen [OPERATIONS §11](OPERATIONS.md#11-aplicación-ordenada-de-migraciones-nuevas): primero en dev.
7. Crear el usuario inicial desde Authentication → Users utilizando un correo bajo control del propietario. El propietario introduce su contraseña fuera del chat. Verificar el UUID y ejecutar `supabase/bootstrap-owner.sql` sustituyendo únicamente el UUID. El script se niega a correr con el marcador o si ya existe propietario.
8. En Authentication → URL Configuration, Site URL debe coincidir con `NEXT_PUBLIC_APP_URL`. Permitir exactamente `http://localhost:3000/auth/callback` en desarrollo y la URL `/auth/callback` del dominio de pruebas publicado. No usar comodines para dominios ajenos.
9. Comprobar el bucket `receipts`: privado, límite de 10 MiB, MIME JPG/PNG/PDF y políticas habilitadas. No crear un bucket público alternativo. En Vercel, los archivos que viajan dentro de una Server Action fallan a partir de unos 4,5 MB (H-07). La carga pasa a ir directa del navegador a Storage con una URL de subida firmada; comprobar en la Preview archivos de 4,4, 5 y 9,9 MB antes de prometer 10 MB. La verificación exige el secreto `cuadria_receipt_verification` en Vault y `RECEIPT_VERIFICATION_SECRET` en Vercel con el mismo valor ([OPERATIONS §13](OPERATIONS.md#13-secreto-de-verificación-de-comprobantes-r-01)).
10. Probar login, recuperación, empresa, usuario empleado, asignación, egreso, comprobante, revisión y arqueo. Para probar invitaciones, configurar la clave secreta del servidor solo en el entorno que corresponda ([OPERATIONS §1.2](OPERATIONS.md#12-variables-de-vercel-por-entorno)) y un SMTP autorizado. El administrador puede invitar desde Empresas; nunca se usa esa clave para consultas o movimientos financieros.

La región está disponible según la [documentación oficial de Supabase](https://supabase.com/docs/guides/platform/regions). La elección inicial es una decisión de arquitectura, no una medición de latencia.

## Plantillas de correo

Configurar las plantillas de Supabase para que los enlaces lleguen al callback de servidor con token hash. Ejemplo de enlace de invitación:

```html
<a
  href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/auth/password"
  >Aceptar invitación</a
>
```

Para recuperación utilizar `type=recovery` y el mismo destino `/auth/password`. El callback acepta exclusivamente esos tipos y verifica el token en Supabase; el destino permitido es local. Site URL debe apuntar al entorno correcto. Probar con cuentas de prueba antes de enviar invitaciones reales. Consultar [plantillas oficiales](https://supabase.com/docs/guides/auth/auth-email-templates).

Las invitaciones de empresa vencen a los 7 días; el token de Auth tiene su propio vencimiento. Un fallo de correo deja la invitación pendiente y se informa. Una cuenta existente puede iniciar sesión y aceptar la invitación con correo verificado; una invitación no cambia el rol ni reactiva una membresía existente.

## Vercel

1. Ingresar en https://vercel.com/new o habilitar la integración Vercel.
2. Usar el proyecto existente **cuadria** asociado a `Lgomezg321/cuadria`. No crear un quinto proyecto; los otros tres se desconectan según [OPERATIONS §4](OPERATIONS.md#4-inventario-y-desconexión-de-proyectos-vercel-h-11).
3. Framework: Next.js. Root Directory: raíz del repositorio. Node.js: 24.x (CI fija 24.22.0). Install: `npm ci`. Build: `npm run build`. Output Directory: automático.
4. Production Branch: `main`, publicando solo commits con el check `verify` en verde ([OPERATIONS §3](OPERATIONS.md#3-rama-main-protegida-y-despliegue-solo-desde-ci-verde-h-17-h-01)). Las ramas generan Preview con Vercel Authentication activa. No declarar producción lista porque una Preview compile.
5. Variables por entorno según [OPERATIONS §1.2](OPERATIONS.md#12-variables-de-vercel-por-entorno): Preview contra `cuadria-dev` y sin la clave de producción; Production contra `cuadria-prod`. `NEXT_PUBLIC_APP_URL` debe ser el origen HTTPS exacto de cada entorno. `RECEIPT_VERIFICATION_SECRET` (solo servidor, Sensitive) en Preview y Production, con el valor del proyecto Supabase correspondiente.
6. Functions Region: `vercel.json` fija `iad1` (Washington, D.C.), junto a `us-east-1`. Con la base actual en `ca-central-1` hay que decidir entre crear producción en `us-east-1` o mover las funciones ([OPERATIONS §2](OPERATIONS.md#2-región-de-base-de-datos-y-funciones-h-54)). No cambiar la región de una base existente sin un plan de migración.
7. Activar Skew Protection ([OPERATIONS §5](OPERATIONS.md#5-skew-protection-de-vercel-h-08)) para que las pestañas abiertas sigan funcionando tras un redespliegue.
8. Agregar el callback exacto en Supabase y volver a desplegar después de cambiar variables públicas: Next.js las incorpora durante la compilación.
9. Verificar la URL desplegada, inicio/cierre de sesión, RPCs, lectura aislada y documentos privados. Revisar errores sin imprimir tokens o contraseñas.

Vercel admite importar repositorios y generar previews por rama según su [documentación de Git](https://vercel.com/docs/git). El despliegue de la aplicación con Supabase debe verificarse en Preview antes de promoverlo a producción.

## Integración de la rama

Abrir un Pull Request hacia `main`, comprobar el workflow Quality y resolver sus fallos antes de integrar. No hacer force push ni reemplazar `main`. No usar `[skip ci]` en commits que se despliegan. La protección de `main` se configura según [OPERATIONS §3](OPERATIONS.md#3-rama-main-protegida-y-despliegue-solo-desde-ci-verde-h-17-h-01).

## Operación y recuperación

Antes del piloto: backup y ensayo de restauración de la base y del bucket `receipts` con RPO/RTO y acta ([OPERATIONS §8](OPERATIONS.md#8-backup-y-ensayo-de-restauración-h-02)), procedimiento de baja de personal ([OPERATIONS §9](OPERATIONS.md#9-baja-de-personal-h-37)), límites de Auth y correo, y acceso de administradores. La existencia de una opción de backup no demuestra que se haya verificado una restauración.

No utilizar dinero real hasta cerrar las pruebas pendientes de `docs/PROGRESS.md`, los controles de [OPERATIONS §12](OPERATIONS.md#12-checklist-verificable-y-acta) y obtener validación del administrador.
