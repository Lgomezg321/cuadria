# Progreso de CUADRIA

Actualizado: 2026-10-19, America/Bogota.

## Estado de la entrega

**Fase 1 implementada y compilable. Fases 2–5 con una primera implementación parcial. MVP completo no verificado. No aprobado para dinero real.**

Repositorio original verificado antes de modificar: `Lgomezg321/cuadria`, main `81928fb`, únicamente README.md y sin cambios locales. Se conservó su historia. Rama: `codex/cuadria-foundation`.

No existe un proyecto Supabase conectado a esta sesión ni una URL Vercel verificada. Se localizaron ambas integraciones y se propuso habilitarlas. No se crearon recursos externos ni se inventaron credenciales.

## Implementado

- Next.js 16.4.2, React 19.3.0, TypeScript estricto/ES2022, Tailwind, Button según shadcn/ui, Radix y Lucide.
- Identidad CUADRIA, inicio, navegación responsive, configuración explícita, errores y estados vacíos en español.
- Auth SSR con cookies, renovación en Proxy, login/logout, recuperación y cambio de contraseña, páginas y acciones protegidas.
- Migraciones con COP exactos; empresas, membresías, fondos, asignaciones históricas, categorías, movimientos, asientos, revisiones, arqueos/conciliaciones y auditoría.
- RLS y revocación de escritura directa. RPCs autorizadas con search_path fijo. Bootstrap de propietario separado y manualmente verificable.
- Formularios conectados a RPC para empresas, fondos (incluida apertura cero), asignaciones y membresías de usuarios Auth existentes.
- Ingresos, egresos, transferencias, idempotencia por contenido, bloqueo de fondos, prevención de sobregiros, aprobación sin asientos adicionales y reversión compensatoria.
- Arqueos y conciliaciones manuales al momento actual; saldo teórico congelado, sin ajustes automáticos.
- Reserva y carga de JPG/PNG/PDF de hasta 10 MB, bucket privado, políticas por movimiento y enlaces de 60 segundos. No sobrescritura ni borrado desde sesiones de aplicación.
- Dashboard de saldos autorizados y últimos 100 movimientos; revisión administrativa de operaciones ajenas y acceso a comprobantes.
- Pruebas unitarias/SQL, pruebas E2E de instalación y script de concurrencia. Workflow Quality con PostgreSQL 17, build, E2E y auditoría de dependencias de producción.
- README, AGENTS, arquitectura, modelo, despliegue y especificación original guardada.

## Verificaciones ejecutadas localmente

| Verificación                        | Resultado                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                      | Aprobada                                                                                                                          |
| `npm run typecheck`                 | Aprobada                                                                                                                          |
| `npm test`                          | 44 pruebas aprobadas en 3 archivos                                                                                                |
| `npm run build`                     | Aprobada, build optimizado de Next.js                                                                                             |
| `npm audit --omit=dev`              | 0 vulnerabilidades reportadas                                                                                                     |
| `npm audit` completo                | 5 avisos high en cadena de lint derivada de braces; npm no ofrece parche compatible                                               |
| Playwright, 6 casos desktop/móvil   | Intentados; navegador no arrancó por restricción macOS MachPortRendezvous/Permission denied. No aprobados localmente              |
| PostgreSQL nativo para concurrencia | Intentado con servidor desechable; initdb bloqueado por shmget/Operation not permitted. No se ejecutaron los casos localmente     |
| Navegador integrado                 | Inicio inspeccionado a ancho móvil y escritorio; navegación a configuración verificada; configuración a 390 px sin desbordamiento |
| HTTP local                          | /panel devuelve 307 a /configuracion; /login devuelve 200 sin conexión configurada                                                |

PGlite ejecuta SQL PostgreSQL real, pero Auth y Storage usan tablas/funciones mínimas de prueba. Los 44 casos no equivalen a un circuito Supabase completo ni a concurrencia entre conexiones.

Se detectó y corrigió una colisión entre variable PL/pgSQL y alias en la reversión. Las pruebas de reversión ahora pasan. Se ajustó ES2022 y se eliminó un caché TypeScript generado con el target anterior antes de verificar nuevamente.

## Pendientes funcionales

- Conectar Supabase, aplicar migraciones y validar usuarios/sesiones/Storage reales.
- Invitación de empleados desde la aplicación, perfiles y presentación de nombres; hoy la asignación usa UUID de usuarios Auth existentes.
- Borradores y su edición/envío; gestión completa de categorías y desactivación de fondos.
- Visor integrado de dos paneles, historial de revisiones visible, respuesta a observaciones.
- Revisión/aprobación de arqueos, conciliación por fecha histórica y partidas pendientes.
- Cierres de períodos con totales congelados y reglas completas de registros tardíos. `closed_through` es solo una barrera preparada, no un cierre implementado.
- Filtros, paginación, indicadores por período, alertas configurables, reportes CSV/PDF y PWA.
- E2E autenticado del circuito de 20 pasos, pruebas Supabase reales, recuperación de respaldos y piloto supervisado.
- Despliegue Vercel, verificación de URL y variables del entorno de pruebas.

## Limitaciones conocidas

- Reservar un comprobante y cargar el objeto no es una transacción distribuida. Una carga fallida deja una reserva y se informa al usuario; falta reconciliación de reservas huérfanas y estado explícito de carga.
- Firma inicial de archivo no equivale a análisis antivirus ni parser completo.
- El snapshot limita movimientos/arqueos a 100; no debe usarse como un reporte completo de período.
- Avisos en dependencias de desarrollo: @next/eslint-plugin-next → fast-glob → micromatch → braces. No se aplicó el downgrade incompatible sugerido por npm. No se reportaron vulnerabilidades de dependencias de producción.
- Las pruebas de CI deben comprobarse sobre el commit publicado; su configuración no demuestra que hayan pasado.

## Siguiente tarea

Habilitar acceso a Supabase y Vercel. Crear o seleccionar **cuadria-dev**, aplicar migraciones, verificar el propietario y ejecutar un flujo real con administrador y empleado. Resolver los fallos encontrados antes de ampliar funcionalidad. Las instrucciones exactas, región propuesta y variables están en DEPLOYMENT.md; nunca solicitar secretos por chat.

## Continuidad

Al retomar: leer AGENTS.md y este archivo; revisar Git y los resultados del workflow; confirmar si las integraciones ya fueron conectadas. No reconstruir el proyecto ni afirmar que los módulos parciales completan las fases correspondientes.
