# Arquitectura

## Aplicación modular

Next.js 16.4.2 y React 19.3.0, versiones estables resueltas desde npm al inicializar; dependencias bloqueadas en package-lock.json. TypeScript estricto con ES2022 para bigint, Tailwind 4, Lucide y un componente Button con Radix Slot/CVA siguiendo shadcn/ui. La identidad usa verde oscuro, superficies neutras y estados vacíos explícitos.

`src/app` contiene rutas y Server Actions. `src/components` presenta datos y formularios. `src/lib/domain` valida cantidades y firmas de archivos sin dependencias de servidor. `src/lib/supabase`, `auth` y `data` se ejecutan solo en servidor. `supabase/migrations` define el límite de seguridad y consistencia. No hay microservicios.

## Autoridad y sesiones

Auth usa @supabase/ssr, cookies y Proxy para renovación. Las rutas protegidas y cada mutación validan el usuario en servidor con getUser. Las consultas y operaciones financieras se ejecutan con la sesión del usuario. La clave administrativa opcional se limita al envío Auth Admin después de autorizar y registrar la invitación mediante la sesión del administrador. La autorización final se encuentra en RLS y RPCs.

El propietario de instalación puede crear empresas. Cada empresa creada le concede una membresía admin explícita; no recibe lectura global de otras empresas. No se deriva ningún rol de user_metadata. El alta inicial requiere una sesión administrativa separada en Supabase.

## Dinero

El dominio PostgreSQL `cop` usa numeric sin escala impuesta y valida integridad, evitando el redondeo silencioso que podría producir numeric(p,0). Máximo absoluto 999999999999999999 COP. El JSON monetario usa cadenas decimales y TypeScript usa bigint. El formato usa Intl.NumberFormat con bigint.

Los asientos son la evidencia financiera y el saldo del fondo es una proyección mantenida en la misma transacción. Cada operación bloquea fondos por UUID ascendente. La idempotencia serializa solicitudes por actor/clave con advisory lock y compara el contenido antes de devolver un resultado anterior. Las restricciones únicas son una segunda barrera. Una colisión del hash únicamente serializa más solicitudes.

Transferencia: dos asientos de signos opuestos en una transacción. Revisión: cambia estado de revisión y agrega historial, sin asientos. Reversión: agrega una operación compensatoria, conserva original y marca reversado. Una apertura cero se registra en auditoría sin crear un asiento de valor cero.

Los arqueos capturan saldo teórico bajo el mismo bloqueo de fondo y no ajustan saldo. Las conciliaciones implementadas son declaraciones al momento actual; el corte bancario histórico y las partidas pendientes todavía no están implementados.

## Comprobantes

Bucket privado con políticas por movimiento. Ruta generada por servidor: empresa/movimiento/UUID. La aplicación valida tamaño, MIME declarado y firma inicial, pero no realiza análisis antivirus ni interpretación completa de PDF. La reserva de metadatos y la carga a Storage son dos operaciones: si falla la carga, el movimiento permanece y el documento reservado puede no existir. Se informa el fallo; quedan pendientes estados explícitos de carga y limpieza supervisada de reservas huérfanas. No se permite reemplazar ni eliminar objetos desde la sesión normal.

Cada acceso firmado se autoriza nuevamente y vence en 60 segundos. Mientras siga vigente, un enlace firmado funciona como credencial temporal; no registrarlo ni compartirlo. La auditoría presenta un visor de imágenes/PDF junto al movimiento y su historial; los enlaces permiten abrir una copia temporal en otra pestaña.

## Límites explícitos

El snapshot inicial devuelve todos los fondos autorizados y los últimos 100 movimientos/arqueos. No se presentan esas muestras como indicadores completos del período. Los reportes calculan totales sobre todo el período autorizado y paginan el detalle de 200 en 200. Los filtros de operación afectan el detalle y no alteran el saldo completo.

Borradores, invitaciones, cierres, revisión de arqueos, comentarios y reportes tienen implementación. Faltan perfiles con nombres, administración completa, conciliación histórica, alertas configurables y PWA. Toda la integración Auth/Storage/correo requiere validación real. No hay sincronización financiera offline.

## Fuentes técnicas consultadas

- https://nextjs.org/docs/app/getting-started/installation
- https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
- https://supabase.com/docs/guides/storage/security/access-control

La configuración SSR sigue la separación de cliente/servidor y renovación de cookies documentada por Supabase. Las comprobaciones de autorización se repiten en servidor y SQL.
