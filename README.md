# CUADRIA

Administrador de caja menor para empleados y supervisión de su superior.

Plataforma web multiempresa para administrar fondos de efectivo y cuentas operativas en Colombia. Idioma español, COP enteros y zona horaria America/Bogota.

**Estado:** base funcional ampliada con borradores, auditoría, cierres, reportes e invitaciones. Hay un proyecto Supabase conectado con las siete migraciones iniciales aplicadas (las cuatro correcciones de la auditoría, `202610210001` a `202610210004`, **todavía no**) y una Preview de Vercel protegida, pero sin separación entre desarrollo y producción ni circuito de aceptación completo. Una auditoría independiente ([informe](docs/AUDIT_REPORT.md)) dejó hallazgos que bloquean el piloto. El MVP completo y el piloto con dinero real **no están aprobados**. Consulta [el progreso detallado](docs/PROGRESS.md) y [los runbooks de operación](docs/OPERATIONS.md).

## Implementación disponible

- Next.js App Router, React, TypeScript estricto, Tailwind, componentes con convenciones shadcn/ui y Lucide.
- Inicio, configuración explícita, login, recuperación de contraseña y rutas internas protegidas.
- Migraciones PostgreSQL para empresas, membresías, asignaciones, fondos, categorías, movimientos, asientos, revisiones, arqueos/conciliaciones y auditoría.
- Formularios conectados a RPCs de Supabase para crear empresas/fondos, asignar usuarios existentes, contabilizar, revisar, reversar y declarar saldos.
- Motor transaccional, idempotencia, bloqueo de fondos en orden estable, protección de sobregiros y cantidades exactas.
- Comprobantes privados JPG/PNG/PDF de hasta 10 MiB. El archivo ya no viaja dentro de una Server Action (que en Vercel falla a partir de unos 4,5 MB, H-07): se reserva, el navegador lo sube directamente a Storage con una URL de subida firmada y el servidor verifica los bytes y firma su veredicto antes de marcarlo como verificado. Enlaces de lectura de 60 segundos. **La subida directa y el límite de 10 MiB aún no se han verificado en el despliegue remoto**: hasta hacerlo (archivos de 4,4, 5 y 9,9 MB), no prometer 10 MB a los usuarios.
- Borradores con versión, revisión de arqueos, cierres de períodos inmutables y respuestas a observaciones.
- Invitaciones verificadas por correo, categorías, estado de fondos y alertas operativas.
- Reportes filtrables con detalle paginado, exportación CSV de página actual y PDF de resumen por fondo.
- No hay datos de demostración ni sustitución de la base de datos por almacenamiento del navegador.

## Instalación

Requiere Node.js 24 (CI usa exactamente 24.22.0) y npm. Desde este repositorio:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Abre http://localhost:3000. Sin las variables Supabase, la aplicación muestra la configuración pendiente. Esto permite compilar y revisar la interfaz sin inventar una conexión.

## Variables

| Variable                               | Uso                                                             |
| -------------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL del proyecto autorizado                                     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública sujeta a RLS                                      |
| `NEXT_PUBLIC_APP_URL`                  | Origen exacto de esta instalación; localhost:3000 en desarrollo |

`RECEIPT_VERIFICATION_SECRET` (solo servidor, al menos 32 caracteres) es obligatoria para verificar comprobantes y debe coincidir con el secreto `cuadria_receipt_verification` de Supabase Vault ([OPERATIONS §13](docs/OPERATIONS.md#13-secreto-de-verificación-de-comprobantes-r-01)); sin ella los comprobantes quedan pendientes.

`SUPABASE_SERVICE_ROLE_KEY` es opcional y se utiliza exclusivamente en servidor para enviar invitaciones mediante Auth Admin. Las operaciones financieras y consultas usan la sesión del usuario y no requieren esa clave. Configurar también SMTP autorizado para correo. No guardar secretos en Git ni pegarlos en el chat. La creación del propietario se realiza por una vía privilegiada separada, descrita en [despliegue](docs/DEPLOYMENT.md).

## Comandos

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
npm start
npx playwright install chromium
npm run test:e2e
npm run test:concurrency
npm audit --omit=dev
git diff --check
```

El workflow Quality ([ci.yml](.github/workflows/ci.yml)) ejecuta además una auditoría del árbol completo a nivel crítico y comprueba que el pipeline no modifica archivos versionados. Las excepciones de dependencias están en [SECURITY.md](docs/SECURITY.md).

### Concurrencia

`test:concurrency` requiere `CUADRIA_TEST_DATABASE_URL` apuntando exclusivamente a una base PostgreSQL vacía y desechable. El script se niega a ejecutarse si encuentra tablas. Crea objetos de prueba y no es una migración de producción. CI usa PostgreSQL 17.10.

Cada carrera se fuerza: una transacción retiene las filas en disputa hasta que `pg_stat_activity` muestra todas las peticiones competidoras esperando un bloqueo. Tras cada escenario se comprueba que el saldo de cada fondo es igual a la suma de sus asientos. Escenarios: sobregiro simultáneo, 8 reintentos realmente simultáneos con la misma clave, transferencias opuestas, cierre contra registro tardío, doble reversión (claves distintas e iguales), doble envío de un borrador y revisión contra cierre en ambos órdenes.

Sin Docker, con los binarios de PostgreSQL 16 o 17 instalados y un usuario que no sea root (como root, ejecutar los comandos `initdb` y `pg_ctl` con `sudo -u postgres` o dentro de `unshare --user --map-user=1000 --map-group=1000`):

```sh
D=$(mktemp -d)
initdb -D "$D/data" -U postgres --auth=trust
pg_ctl -D "$D/data" -l "$D/pg.log" -o "-p 55432 -k $D" -w start
createdb -h 127.0.0.1 -p 55432 -U postgres cuadria_test
CUADRIA_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/cuadria_test' npm run test:concurrency
pg_ctl -D "$D/data" -m fast stop && rm -rf "$D"
```

Una repetición necesita otra base vacía. Nunca apuntar este comando a Supabase ni a una base con datos.

### Navegador para E2E

`@playwright/test` 1.64.1 exige Chromium revisión 1248 (Chrome for Testing 156.0.8078.4), que instala `npx playwright install chromium`. Si el entorno no puede descargarlo, se puede usar un Chromium del sistema:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/ruta/a/chromium npm run test:e2e
```

La variable solo se aplica si está definida. Con otra revisión del navegador el resultado es orientativo; la referencia es CI. Para probar también WebKit: `npx playwright install --with-deps webkit` y `PLAYWRIGHT_WEBKIT=1 npm run test:e2e` (proyecto `mobile-webkit`; en CI corre como job informativo).

### Alcance de las pruebas

Los tests de SQL usan PGlite (PostgreSQL embebido) con todas las migraciones y sustitutos compartidos de Auth, Storage, Vault y pgcrypto (`tests/helpers/db.ts`); `auth.uid()`, `auth.role()` y `auth.jwt()` replican la definición de Supabase. Las Server Actions y las rutas (`/reportes/csv`, `/reportes/pdf`, `/comprobantes/[id]`) tienen pruebas con un cliente Supabase simulado (`tests/app-*.test.ts`). No equivalen a una prueba de Supabase Auth, entrega de correo, Storage HTTP o concurrencia por HTTP. Los E2E actuales cubren la instalación sin configurar; falta el circuito autenticado completo.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Modelo de datos](docs/DATABASE.md)
- [Instalación y despliegue](docs/DEPLOYMENT.md)
- [Estado, pruebas y pendientes](docs/PROGRESS.md)
- [Circuito de aceptación con Supabase](docs/ACCEPTANCE.md)
- [Operación: entornos, claves, backups, bajas](docs/OPERATIONS.md)
- [Seguridad de dependencias y excepciones](docs/SECURITY.md)
- [Informe de auditoría independiente](docs/AUDIT_REPORT.md)
- [Especificación original](docs/REQUIREMENTS.md)
- [Reglas para continuar el desarrollo](AGENTS.md)

## Próximo hito

Supabase ya está conectado. Siguiente: separar desarrollo y producción, retirar la clave administrativa de la Preview, proteger `main` y ensayar la restauración ([OPERATIONS.md](docs/OPERATIONS.md)). Después, ejecutar en desarrollo el circuito de [ACCEPTANCE.md](docs/ACCEPTANCE.md) (administrador → empleado → egreso → comprobante → revisión → arqueo → cierre) con usuarios sintéticos.
