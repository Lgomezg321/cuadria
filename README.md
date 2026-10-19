# CUADRIA

Administrador de caja menor para empleados y supervisión de su superior.

Plataforma web multiempresa para administrar fondos de efectivo y cuentas operativas en Colombia. Idioma español, COP enteros y zona horaria America/Bogota.

**Estado:** base funcional ampliada con borradores, auditoría, cierres, reportes e invitaciones. CI de la base confirmado; validación Supabase y URL pública Vercel pendientes. El MVP completo y el piloto con dinero real **no están aprobados**. Consulta [el progreso detallado](docs/PROGRESS.md).

## Implementación disponible

- Next.js App Router, React, TypeScript estricto, Tailwind, componentes con convenciones shadcn/ui y Lucide.
- Inicio, configuración explícita, login, recuperación de contraseña y rutas internas protegidas.
- Migraciones PostgreSQL para empresas, membresías, asignaciones, fondos, categorías, movimientos, asientos, revisiones, arqueos/conciliaciones y auditoría.
- Formularios conectados a RPCs de Supabase para crear empresas/fondos, asignar usuarios existentes, contabilizar, revisar, reversar y declarar saldos.
- Motor transaccional, idempotencia, bloqueo de fondos en orden estable, protección de sobregiros y cantidades exactas.
- Comprobantes privados JPG/PNG/PDF, máximo 10 MB, reserva de ruta y enlace temporal de 60 segundos.
- Borradores con versión, revisión de arqueos, cierres de períodos inmutables y respuestas a observaciones.
- Invitaciones verificadas por correo, categorías, estado de fondos y alertas operativas.
- Reportes filtrables con detalle paginado, exportación CSV de página actual y PDF de resumen por fondo.
- No hay datos de demostración ni sustitución de la base de datos por almacenamiento del navegador.

## Instalación

Requiere Node.js 24 y npm. Desde este repositorio:

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

`SUPABASE_SERVICE_ROLE_KEY` es opcional y se utiliza exclusivamente en servidor para enviar invitaciones mediante Auth Admin. Las operaciones financieras y consultas usan la sesión del usuario y no requieren esa clave. Configurar también SMTP autorizado para correo. No guardar secretos en Git ni pegarlos en el chat. La creación del propietario se realiza por una vía privilegiada separada, descrita en [despliegue](docs/DEPLOYMENT.md).

## Comandos

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm start
npx playwright install chromium
npm run test:e2e
npm run test:concurrency
npm audit --omit=dev
```

`test:concurrency` requiere `CUADRIA_TEST_DATABASE_URL` apuntando exclusivamente a una base PostgreSQL vacía y desechable. El script se niega a ejecutarse si encuentra tablas. Crea objetos de prueba y no es una migración de producción. El workflow de GitHub Actions proporciona PostgreSQL 17.

Los tests unitarios/de SQL usan PGlite (PostgreSQL embebido) con Auth y tablas Storage mínimas de prueba. No equivalen a una prueba de Supabase Auth, entrega de correo, Storage HTTP o concurrencia real. Los E2E actuales cubren la instalación sin configurar; falta el circuito autenticado completo.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Modelo de datos](docs/DATABASE.md)
- [Instalación y despliegue](docs/DEPLOYMENT.md)
- [Estado, pruebas y pendientes](docs/PROGRESS.md)
- [Especificación original](docs/REQUIREMENTS.md)
- [Reglas para continuar el desarrollo](AGENTS.md)

## Próximo hito

Conectar un proyecto Supabase de desarrollo, aplicar y verificar migraciones, habilitar al propietario y comprobar el circuito administrador → empleado → egreso → comprobante → revisión → arqueo. Después completar los pendientes funcionales y verificar el despliegue en Vercel.
