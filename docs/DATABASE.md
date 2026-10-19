# Base de datos

## Migraciones

1. `202610190001_core.sql`: dominio monetario, esquema relacional, permisos, políticas RLS y funciones transaccionales.
2. `202610190002_receipts.sql`: metadatos inmutables y bucket privado con políticas de lectura/carga.

Las migraciones requieren Supabase con `auth.users`, `auth.uid()`, roles `anon`/`authenticated` y esquema Storage. Las pruebas locales crean sustitutos mínimos de estos elementos. No aplicar los sustitutos de pruebas sobre Supabase.

## Entidades

| Entidad               | Responsabilidad                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| installation_owners   | Propietario configurado fuera del acceso cliente                                                |
| companies             | Empresas y NIT único                                                                            |
| memberships           | Usuario, empresa, rol y vigencia                                                                |
| funds                 | Fondo, empresa, moneda COP, saldo y estado                                                      |
| assignments           | Responsabilidad por intervalos; conserva asignaciones finalizadas                               |
| categories            | Categorías pertenecientes a una empresa                                                         |
| movements             | Operaciones contabilizadas, dos estados independientes, creador, fecha operativa e idempotencia |
| entries               | Asientos inmutables por movimiento/fondo                                                        |
| reviews               | Historial inmutable de decisiones                                                               |
| checks                | Arqueos y conciliaciones al momento del registro, con diferencia congelada                      |
| receipts              | Metadatos y ruta de objeto privado                                                              |
| audit_events          | Actor, evento, entidad, detalle y momento                                                       |
| private.fund_requests | Idempotencia de creación de fondos, incluso con apertura cero                                   |

Las claves compuestas empresa/fondo y empresa/categoría impiden relaciones entre empresas. Los roles cliente tienen SELECT autorizado por RLS y EXECUTE de RPCs concretas; no tienen INSERT/UPDATE/DELETE sobre tablas de dominio.

## Funciones

- `create_company`: solo propietario; asigna admin explícito y categoría General.
- `assign_member`: admin de la empresa; solo usuarios Auth existentes; no permite modificar el rol propio.
- `create_fund`: admin, apertura no negativa, asiento si es mayor que cero, auditoría siempre e idempotencia.
- `assign_fund`: admin, miembro empleado activo, inicio o fin del intervalo.
- `post_movement`: permisos de operación en ambos fondos, importe positivo, validación de fecha, bloqueo de fondos, no sobregiro.
- `review_movement`: admin, autor diferente, aprobar/observar y auditoría; no afecta dinero.
- `reverse_movement`: admin, motivo obligatorio, compensación atómica, una reversión por original; no reversa aperturas ni reversiones.
- `record_check`: captura saldo bajo bloqueo; cuenta bancaria produce conciliación manual.
- `reserve_receipt`: solo autor con permiso vigente; no adjuntar a aprobado/reversado.
- `workspace_snapshot`: SECURITY INVOKER, RLS activa y cantidades convertidas a texto.

Funciones elevadas usan search_path vacío y referencias calificadas. Los helpers privados solo comprueban permisos; no permiten acceder a información fuera de la membresía actual.

## Lectura y conservación

Un empleado ve fondos con asignación vigente. Al finalizar su asignación deja de ver esos fondos y su historial; administradores y auditores de la empresa conservan acceso. Transferencias son visibles a quien puede consultar origen o destino; los asientos solo se leen en los fondos autorizados.

Los triggers impiden cambiar o eliminar asientos, revisiones, arqueos, comprobantes y eventos, incluso por una escritura privilegiada accidental. El rol administrador de la aplicación no equivale a propietario PostgreSQL.

No existen cierres de períodos todavía. `closed_through` es una barrera preparada en el motor y no tiene UI ni RPC de cierre. No se debe marcar una auditoría cerrada manualmente mediante ese campo. Falta implementar la entidad de cierre, sus totales y reglas de corrección.

## Pruebas requeridas antes del piloto

Aplicar migraciones en desarrollo y repetir pruebas con usuarios Auth reales, PostgREST y Storage real. Verificar precisión monetaria en JSON, RLS en llamadas directas, solicitudes concurrentes con varias conexiones y restauración de copia de seguridad. El CI proporciona un PostgreSQL desechable para pruebas de concurrencia, pero no sustituye el circuito Supabase completo.
