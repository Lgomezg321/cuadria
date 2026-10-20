# Progreso de CUADRIA

Actualizado: 2026-10-20, America/Bogota.

## Estado real

**Base funcional ampliada, con pruebas locales y CI. MVP completo aún no verificado y piloto con dinero real no aprobado.**

Repositorio único: `Lgomezg321/cuadria`. Se conservó main original `81928fb`; implementación en `codex/cuadria-foundation`. No se integró main ni se reemplazó su historia.

Supabase conectado y verificado en el proyecto existente `cuadria` (`teoirtpwyqgxrcmzyqrj`, Canada Central). GitHub muestra `Lgomezg321/cuadria` vinculado; despliegue automático de base desactivado. Se aplicaron en una transacción las seis migraciones iniciales y `202610200001_private_requests_rls`; el historial remoto confirmó siete versiones. Las 17 tablas públicas tienen RLS, igual que la tabla privada de idempotencia y el historial de migraciones. El bucket `receipts` es privado, admite JPG/PNG/PDF y limita a 10 MiB. No se cargaron datos financieros ni se enviaron invitaciones. El usuario creó su cuenta inicial y autorizó expresamente su activación como propietario; la inserción se ejecutó y verificó en SQL Editor. No se crearon empresas ni datos financieros. GitHub confirmó compilaciones Vercel automáticas existentes para `cuadria`, `cuadria-caja`, `cuadria-app` y `cuadria-czyg`. No se creó otro proyecto. Proyecto canónico `cuadria` y variables Preview verificados. La configuración heredada «Other» causaba 404 aun con estado Ready; se corrigió a Next.js y se redesplegó. Portada y login de Preview cargan correctamente; sesión y circuito autenticado pendientes.

## Implementado

- Next.js 16.4.2, React 19.3.0, TypeScript estricto/ES2022, Tailwind, Radix/Lucide y componente Button según shadcn/ui. Identidad CUADRIA y navegación responsive en español.
- Auth SSR, cookies, renovación en Proxy, login/logout, recuperación/cambio de contraseña y callback PKCE o token hash. Páginas, descargas y acciones verifican la sesión.
- Siete migraciones (incluido endurecimiento RLS de idempotencia): empresas, membresías, fondos, asignaciones históricas, categorías, movimientos, asientos, comprobantes, revisiones, arqueos, borradores, cierres, invitaciones y comentarios.
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

- Completar el circuito autenticado real: correo, RPCs, carga/descarga privada e aislamiento entre cuentas. La conexión HTTP ya verificó Auth disponible, registro público deshabilitado, confirmación de correo exigida, lectura anónima de empresas rechazada (401/42501) y lista de buckets vacía para anónimos.
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

Continuar en el proyecto Supabase existente `cuadria`; no reinstalar las migraciones. `.env.local` está configurado e ignorado por Git. Las tres variables públicas están guardadas en Preview del proyecto Vercel canónico. Verificar propietario y realizar el circuito administrador → empleado → borrador → egreso → comprobante → observación/respuesta → aprobación → arqueo → cierre → reporte. Después verificar la preview del proyecto Vercel canónico `cuadria`. Nunca solicitar secretos por chat.

Al retomar: leer AGENTS y este archivo, revisar Git y el último CI; continuar la implementación existente. No declarar el MVP terminado por una compilación exitosa ni por pruebas con sustitutos de Auth/Storage.

## Verificación de instalación — 2026-10-20

El SQL Editor remoto confirmó 17 tablas públicas, cero sin RLS, siete migraciones y bucket privado de 10485760 bytes. El alta del primer usuario fue realizada personalmente por el usuario. Las credenciales privadas no se copiaron al repositorio. Tras añadir la migración de protección privada pasaron lint, tipos y las 70 pruebas. La compilación local Turbopack encontró una restricción del entorno al abrir un puerto para CSS; `npm run build -- --webpack` compiló correctamente con `.env.local`. El commit `53555289b92090de0867d9d60f15d5db5f983037` pasó nuevamente [Quality 39417194748](https://github.com/Lgomezg321/cuadria/actions/runs/39417194748): lint, tipos, 70 pruebas, concurrencia, build Turbopack, E2E y auditoría de producción.

Preview corregida: [CUADRIA](https://cuadria-git-codex-cuadria-4b0283-lucas-gomezs-projects-7ea98b84.vercel.app), [despliegue KheSJGx5r](https://vercel.com/lucas-gomezs-projects-7ea98b84/cuadria/KheSJGx5rAVt271iWwysE9brDPX6), commit `5355528`. Site URL de Supabase apunta a ese origen y hay cuatro callbacks exactos: Preview/local, con y sin `next=/auth/password`; sin comodines. Se pidió al usuario iniciar sesión personalmente en la Preview para validar la cuenta. Las rutas locales protegidas `/panel`, `/reportes/csv` y `/reportes/pdf` redirigen a login sin sesión. No se promovió a producción: `main` conserva el commit inicial.

La Preview conserva Vercel Authentication: las peticiones HTTP externas sin sesión Vercel redirigen a SSO (302). La portada y el login se verificaron en Chrome con la sesión Vercel del propietario. No se desactivó esa protección.
