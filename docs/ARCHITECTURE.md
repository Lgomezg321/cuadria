# Arquitectura

## Aplicación modular

Next.js 16.4.2 y React 19.3.0, versiones estables resueltas desde npm al inicializar; dependencias bloqueadas en package-lock.json. TypeScript estricto con ES2022 para bigint, Tailwind 4, Lucide y un componente Button con Radix Slot/CVA siguiendo shadcn/ui. La identidad usa verde oscuro, superficies neutras y estados vacíos explícitos.

`src/app` contiene rutas y Server Actions. `src/components` presenta datos y formularios. `src/lib/domain` valida cantidades y firmas de archivos sin dependencias de servidor. `src/lib/supabase`, `auth` y `data` se ejecutan solo en servidor. `supabase/migrations` define el límite de seguridad y consistencia. No hay microservicios.

## Autoridad y sesiones

Auth usa @supabase/ssr con cookies y el Proxy (`src/proxy.ts`) renueva la sesión. Las rutas protegidas y cada Server Action validan el usuario en servidor con `getUser` (`requireUser`) **antes** de validar datos o crear cualquier cliente; las descargas de reportes autentican antes de leer los filtros. Las consultas y operaciones financieras se ejecutan con la sesión del usuario y la autorización final está en RLS y en las RPC. Una caída de Auth se muestra como fallo temporal (`AuthUnavailableError`), no como cierre de sesión.

- **Cookies de sesión:** no hay cliente Supabase en el navegador, así que las cookies son `HttpOnly`, `SameSite=Lax`, `path=/` y `Secure` cuando la aplicación se sirve por HTTPS (siempre en Preview/Production). Se aplican tanto al escribirlas desde el Proxy como desde Server Actions.
- **Callback de correo con confirmación POST:** `GET /auth/callback` (invitación o recuperación, `token_hash` + `type` o PKCE `code`) **no consume el token**: valida los parámetros, los guarda en una cookie `HttpOnly` de 15 minutos con `path=/auth` y redirige con 303 a `/auth/confirm`. Esa página avisa si ya hay otra sesión abierta y el usuario confirma con un botón (Server Action `confirmAuthLink`), que es el único paso que llama a `verifyOtp`/`exchangeCodeForSession`. Así los escáneres de enlaces no queman el token y se evita el CSRF de inicio de sesión. Tras confirmar se aceptan las invitaciones pendientes y, para recuperación o invitación, se emite una cookie de 30 minutos que permite fijar la contraseña sin la actual (`/auth/password`). Fuera de esa ventana, cambiar la contraseña exige la actual (verificada en un cliente efímero) y cierra las demás sesiones; si la ventana vence con el formulario abierto, la acción lo explica y enlaza a `/login`.
- **Clave administrativa:** solo para `inviteUserByEmail`, y solo después de que `create_invitation` autoriza y registra la invitación con la sesión del administrador (`persistSession: false`). Nunca se usa para dinero ni comprobantes.
- **Propietario de instalación:** crea empresas y recibe una membresía admin explícita en cada una; no tiene lectura global. No se deriva ningún rol de `user_metadata`.
- **CAPTCHA opcional:** Cloudflare Turnstile en login, recuperación y cambio de contraseña cuando hay `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; Supabase Auth valida el token.

### Cabeceras y CSP con nonce

El Proxy genera en cada petición un nonce aleatorio de 128 bits y una Content-Security-Policy (`src/lib/security-headers.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` (más Turnstile si está activo), `connect-src`/`img-src` limitados al propio origen y al de Supabase, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` y `upgrade-insecure-requests` sobre HTTPS. Next.js lee el nonce de la cabecera de la petición y lo aplica a sus scripts. Los estilos conservan `'unsafe-inline'` porque React emite atributos `style`. HSTS solo en producción servida por HTTPS. `next.config.ts` añade `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` (y `no-referrer` en `/auth/*`) y `Permissions-Policy`; las páginas con sesión llevan `Cache-Control: private, no-store`.

### Versiones desfasadas

`deploymentId` toma el identificador del despliegue de Vercel (Skew Protection). Si una pestaña antigua llama a una Server Action que ya no existe, el formulario muestra "CUADRIA se actualizó; recarga" en lugar de la pantalla de error, y la operación no se registra.

## Dinero

El dominio PostgreSQL `cop` usa numeric sin escala impuesta y valida integridad, evitando el redondeo silencioso que podría producir numeric(p,0). Máximo absoluto 999999999999999999 COP. El JSON monetario usa cadenas decimales y TypeScript usa bigint. El formato usa Intl.NumberFormat con bigint.

Los asientos son la evidencia financiera y el saldo del fondo es una proyección mantenida en la misma transacción. Cada operación bloquea fondos por UUID ascendente. La idempotencia serializa solicitudes por actor/clave con advisory lock y compara el contenido antes de devolver un resultado anterior. Las restricciones únicas son una segunda barrera. Una colisión del hash únicamente serializa más solicitudes.

Transferencia: dos asientos de signos opuestos en una transacción. Revisión: cambia estado de revisión y agrega historial, sin asientos. Reversión: agrega una operación compensatoria, conserva original y marca reversado. Una apertura cero se registra en auditoría sin crear un asiento de valor cero.

Los arqueos capturan saldo teórico bajo el mismo bloqueo de fondo y no ajustan saldo. Las conciliaciones implementadas son declaraciones al momento actual; el corte bancario histórico y las partidas pendientes todavía no están implementados.

## Comprobantes

Bucket privado `receipts`; la ruta la genera el servidor (`empresa/movimiento/UUID`). Los archivos **no pasan por una Server Action** (H-07): el cuerpo de las acciones está limitado a 1 MB.

1. **Reserva.** El navegador revisa el archivo (tipo, tamaño hasta 10 MiB y firma inicial) y llama a `reserveReceiptUpload`, que valida los metadatos declarados y llama a `reserve_receipt` con una clave de idempotencia. La reserva queda `pending`.
2. **Subida directa.** El servidor crea con la sesión del usuario una URL de subida firmada (`createSignedUploadUrl`); Storage la emite solo si la política de inserción admite esa ruta (reserva `pending` propia, de menos de 1 hora, sobre un movimiento propio no aprobado). El navegador sube los bytes directamente a Storage con `x-upsert: false`, mostrando el progreso.
3. **Confirmación.** `confirmReceiptUpload` descarga el objeto con la sesión del autor, inspecciona los bytes reales (firma, estructura completa, MIME y tamaño) y **firma su veredicto** con `RECEIPT_VERIFICATION_SECRET` (HMAC-SHA256, R-01). `confirm_receipt` recalcula la firma con el mismo secreto guardado en Supabase Vault, contrasta la reserva con los metadatos de `storage.objects` y deja el comprobante `verified` o `rejected`. Sin la firma del servidor, una llamada directa a la RPC no puede verificar nada. Un objeto rechazado se elimina en lo posible.

Solo los comprobantes `verified` cuentan para las alertas, el visor y `/comprobantes/[id]`. Las reservas pendientes vencen (`expired`) en lugar de borrarse. No se pueden reemplazar ni modificar objetos desde la sesión normal. No hay antivirus ni análisis completo de PDF.

`/comprobantes/[id]` exige sesión, valida el UUID, lee con RLS solo comprobantes verificados y responde un 404 uniforme si no existe, no es visible o hay error. Firma una URL de 60 segundos y redirige con 303 y `no-store`; las imágenes se abren en línea y los PDF como descarga (`Content-Disposition: attachment`) para que nunca se rendericen dentro de la aplicación. El visor de Auditoría apunta a esa ruta (no incrusta URLs prefirmadas que vencían antes de cargarse, H-33).

**Pendiente de verificar en remoto:** la subida directa a Storage real (CORS, límites del bucket, `owner_id` y `metadata` escritos por Storage), el límite efectivo con archivos de 4,4, 5 y 9,9 MB, y que la función lee el secreto de Vault.

## Límites explícitos

El snapshot inicial devuelve todos los fondos autorizados y los últimos 100 movimientos/arqueos. No se presentan esas muestras como indicadores completos del período. Los reportes calculan totales sobre todo el período autorizado y paginan el detalle de 200 en 200. Los filtros de operación afectan el detalle y no alteran el saldo completo.

Borradores, invitaciones, cierres, revisión de arqueos, comentarios y reportes tienen implementación. Un filtro de reporte inválido se informa en línea en `/reportes` y con un 400 en español en `/reportes/csv` y `/reportes/pdf`. Faltan perfiles con nombres, administración completa, conciliación histórica, alertas configurables y PWA. Toda la integración Auth/Storage/correo requiere validación real. No hay sincronización financiera offline.

## Fuentes técnicas consultadas

- https://nextjs.org/docs/app/getting-started/installation
- https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
- https://supabase.com/docs/guides/storage/security/access-control

La configuración SSR sigue la separación de cliente/servidor y renovación de cookies documentada por Supabase. Las comprobaciones de autorización se repiten en servidor y SQL.
