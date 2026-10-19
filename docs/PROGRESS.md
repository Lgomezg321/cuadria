# Progreso de CUADRIA

Actualizado: 2026-10-19, America/Bogota.

## Estado real

**Base funcional ampliada, con pruebas locales y CI. MVP completo aún no verificado y piloto con dinero real no aprobado.**

Repositorio único: `Lgomezg321/cuadria`. Se conservó main original `81928fb`; implementación en `codex/cuadria-foundation`. No se integró main ni se reemplazó su historia.

No hay conexión Supabase autorizada disponible en esta sesión. La comprobación web también llegó a la pantalla de inicio de sesión. No se aplicaron migraciones a una base externa ni se enviaron invitaciones reales. GitHub confirmó compilaciones Vercel automáticas existentes para `cuadria`, `cuadria-caja`, `cuadria-app` y `cuadria-czyg`. No se creó otro proyecto. Falta verificar el proyecto canónico, variables y circuito autenticado en la URL pública.

## Implementado

- Next.js 16.4.2, React 19.3.0, TypeScript estricto/ES2022, Tailwind, Radix/Lucide y componente Button según shadcn/ui. Identidad CUADRIA y navegación responsive en español.
- Auth SSR, cookies, renovación en Proxy, login/logout, recuperación/cambio de contraseña y callback PKCE o token hash. Páginas, descargas y acciones verifican la sesión.
- Seis migraciones: empresas, membresías, fondos, asignaciones históricas, categorías, movimientos, asientos, comprobantes, revisiones, arqueos, borradores, cierres, invitaciones y comentarios.
- RLS, escrituras exclusivamente por RPC autorizadas, search_path fijo y bootstrap de propietario separado. El propietario no recibe lectura implícita de empresas sin membresía.
- COP enteros exactos, JSON monetario en texto, bigint, operaciones atómicas, bloqueo de fondos, no sobregiros, idempotencia por actor/clave/contenido y reversión compensatoria.
- Borradores propios con versión optimista: guardar no contabiliza; enviar utiliza el motor financiero y es idempotente.
- Invitaciones por correo desde el servidor, rol persistido antes del envío, vencimiento y revocación. Aceptación exige correo verificado; no eleva ni reactiva membresías existentes. Requiere SMTP y clave administrativa exclusivamente de servidor.
- Creación de categorías y activación/desactivación de fondos; desactivar exige saldo cero. Membresías y asignaciones por UUID; directorio SQL disponible, presentación de perfiles pendiente.
- Arqueos y conciliaciones actuales capturan saldo bajo bloqueo. Un administrador distinto del autor puede observar/aprobar; aprobar no ajusta dinero.
- Cierres por fondo y fecha inclusive: rechazan movimientos pendientes, congelan totales e IDs, impiden registros tardíos y cambios de revisión en períodos cerrados. Una corrección posterior requiere reversión fechada en período abierto.
- Auditoría de dos paneles: movimiento y decisiones junto a comprobantes privados, navegación reciente, detalle histórico desde reportes, respuestas inmutables del autor/administrador. Auditor tiene solo lectura.
- JPG/PNG/PDF privados hasta 10 MB; validación de tamaño/MIME/firma inicial, enlaces de 60 segundos y sin sobrescritura/borrado desde la aplicación.
- Alertas reales: pendientes, observados, egresos sin objeto comprobante, diferencias y fondos sin verificación aprobada reciente (7 días).
- Reportes por empresa, fondo y período: saldos, aperturas, ingresos, egresos, transferencias y reversiones separados. Detalle filtrable por tipo, revisión, categoría y autor, paginado de 200 en 200. CSV con protección frente a fórmulas; PDF de resumen por fondo.
- CI con PostgreSQL 17, lint, tipos, pruebas SQL/unitarias, concurrencia entre conexiones, build, Playwright desktop/móvil y auditoría de dependencias de producción.

## Evidencia de validación

El commit `bf93a3b6b775b6dabd078be955c00a8f9a2c56c1` completó satisfactoriamente [Quality 39318345627](https://github.com/Lgomezg321/cuadria/actions/runs/39318345627): 44 pruebas SQL/unitarias, 3 casos de concurrencia en PostgreSQL 17.11, 6 E2E desktop/móvil, lint, tipos, build y auditoría de producción.

La ampliación pasó localmente `npm run typecheck`, `npm run lint`, `npm test` (70 pruebas en 4 archivos), `npm run build`, `npm run format:check` y `git diff --check`; `npm audit --omit=dev` reportó 0 vulnerabilidades. Incluye pruebas de borradores, cierres, reportes, invitaciones, comentarios y aislamiento. El CI `39338056284` confirmó las 70 pruebas y los cuatro casos de concurrencia real; sus E2E detectaron que las descargas validaban filtros antes de comprobar sesión. Se corrigió el orden y la repetición quedó aprobada. El script de concurrencia ahora carga todas las migraciones, comprueba espera real por bloqueo y añade cierre contra contabilización tardía.

El commit final de código `ea788abb2407b9d36dfb8cd5a2eb29a0ef6ef4e7` pasó [Quality 39338265070](https://github.com/Lgomezg321/cuadria/actions/runs/39338265070): **70 pruebas SQL/unitarias, 4 escenarios de concurrencia en PostgreSQL 17.11 y 6 E2E de escritorio/móvil**, además de instalación limpia, lint, tipos, build y auditoría de producción con cero vulnerabilidades. Los cuatro casos concurrentes cubren sobregiro, ocho reintentos idempotentes, transferencias opuestas y cierre contra contabilización tardía; las pruebas de bloqueo comprueban espera real entre conexiones.

GitHub reportó éxito de Vercel en los cuatro proyectos existentes para ese mismo commit. El [despliegue del proyecto canónico cuadria](https://vercel.com/lucas-gomezs-projects-7ea98b84/cuadria/9ZSG7iDPjkhWqBNmGx9urJrcgC1j) requiere iniciar sesión para inspeccionarlo. Esto confirma el estado reportado por la integración, pero no verifica una URL pública ni el circuito Auth/Storage. La actualización posterior de documentación no modifica código y referencia expresamente este commit probado.

Restricciones locales: Chromium CLI no inicia por permisos macOS MachPortRendezvous; PostgreSQL nativo desechable no inicializa por shmget. Esos casos se ejecutan en CI, sin eludir el aislamiento local. La inspección del navegador integrado verificó inicio y configuración en móvil/escritorio; no equivale a una sesión Supabase autenticada.

PGlite ejecuta SQL PostgreSQL real con sustitutos mínimos de Auth/Storage. No demuestra entrega de correo, Storage HTTP ni autorización JWT de Supabase. Los E2E actuales verifican el entorno sin configurar y la protección de sus rutas.

## Límites y pendientes

- Conectar Supabase de desarrollo, aplicar las seis migraciones y probar Auth, correo, RPCs, Storage privado y aislamiento mediante llamadas HTTP reales.
- Circuito autenticado de aceptación de 20 pasos, pruebas de recuperación/restauración y piloto supervisado.
- Perfiles y nombres legibles, directorio en formularios, retirada de membresías, edición completa de categorías y administración ampliada.
- Conciliación bancaria histórica, partidas pendientes y evidencias del arqueo; hoy se registra una declaración al momento actual.
- Alertas configurables y notificaciones, PWA y experiencia móvil autenticada validada. No se implementa sincronización financiera offline.
- Snapshot general: últimos 100 movimientos/arqueos/borradores/cierres. Los reportes consultan todo el período con detalle paginado; CSV exporta la página actual y totales completos. PDF contiene solo resumen. Exportación masiva y rendimiento a escala pendientes.
- Visor muestra hasta 20 comprobantes. Su integración con Storage/PDF real sigue pendiente de validación. PDF de reportes usa Helvetica; caracteres fuera de su alfabeto se sustituyen por `?`.
- Reserva de comprobante y carga son operaciones separadas; un fallo deja una reserva huérfana y se informa. Faltan estado explícito y reconciliación de cargas. Firma inicial no es antivirus ni parser completo.
- Clave administrativa de invitaciones opcional y solo en servidor. Registrar invitación y enviar correo no es una transacción distribuida: si falla el envío, se conserva pendiente y se informa.
- Avisos de desarrollo en @next/eslint-plugin-next → fast-glob → micromatch → braces; no aplicar el downgrade incompatible sugerido por npm. La auditoría de producción no reportó vulnerabilidades.

## Publicación

Rama publicada en el repositorio existente. La creación de PR mediante la integración devolvió HTTP 403 `Resource not accessible by integration`; GitHub web no tenía sesión. No existe PR creado desde esta sesión. [Comparación preparada](https://github.com/Lgomezg321/cuadria/compare/main...codex/cuadria-foundation).

Se corrigió el lockfile inicial generado con npm 11.6: faltaban dependencias opcionales exigidas por npm 11.19 en Linux. Se regeneró en un directorio limpio y CI confirmó instalación reproducible.

## Siguiente paso y continuidad

Habilitar una conexión autorizada a Supabase y seleccionar/crear **cuadria-dev**. Seguir DEPLOYMENT, aplicar migraciones, verificar propietario y realizar el circuito administrador → empleado → borrador → egreso → comprobante → observación/respuesta → aprobación → arqueo → cierre → reporte. Después verificar la preview del proyecto Vercel canónico `cuadria`. Nunca solicitar secretos por chat.

Al retomar: leer AGENTS y este archivo, revisar Git y el último CI; continuar la implementación existente. No declarar el MVP terminado por una compilación exitosa ni por pruebas con sustitutos de Auth/Storage.
