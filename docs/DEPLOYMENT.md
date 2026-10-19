# Instalación y despliegue de CUADRIA

## Estado real

No se ha creado un proyecto Supabase o Vercel desde esta sesión. Al publicar la rama, GitHub reportó despliegues automáticos de cuatro proyectos Vercel existentes: cuadria, cuadria-caja, cuadria-app y cuadria-czyg. Falta acceso administrativo y verificación de la URL pública; reutilizar el proyecto canónico cuadria antes de considerar otro. La opción preferida es habilitar las integraciones y continuar desde Codex; no enviar secretos por chat.

## Supabase: intervención mínima

1. Ingresar en https://supabase.com/dashboard y seleccionar la organización propia.
2. Crear un proyecto llamado **cuadria-dev** para validación. Elegir **East US (North Virginia), us-east-1**, como punto de partida para mantener base y funciones Vercel en la misma región. Medir latencia desde Colombia durante el piloto; no se está afirmando que sea la región más rápida. Si existe una obligación de residencia de datos, resolverla antes de crear producción.
3. Generar una contraseña de base de datos única y guardarla en el gestor de contraseñas. No compartirla en el chat ni guardarla en el repositorio. No contratar un plan de pago sin autorización del propietario.
4. Mantener Data API habilitada. No desactivar RLS. En Authentication, habilitar correo/contraseña, exigir confirmación y deshabilitar registro público. Configurar SMTP autorizado antes de invitar empleados reales.
5. En el diálogo Connect/API keys obtener Project URL y publishable key; configurar los campos correspondientes de `.env.local` o las variables de Vercel. No usar service_role como clave pública.
6. Habilitar la integración Supabase para que Codex aplique las migraciones y verifique resultados. Si se usa CLI con una sesión autorizada: `npx supabase login`, `npx supabase link --project-ref REFERENCIA_DEL_PROYECTO`, `npx supabase db push`. Introducir credenciales solo en los mecanismos interactivos seguros. Alternativamente, el administrador puede ejecutar los archivos de migración en orden desde SQL Editor.
7. Crear el usuario inicial desde Authentication → Users utilizando un correo bajo control del propietario. El propietario introduce su contraseña fuera del chat. Verificar el UUID y ejecutar `supabase/bootstrap-owner.sql` sustituyendo únicamente el UUID. El script se niega a correr con el marcador o si ya existe propietario. Codex puede realizar este paso una vez que tenga una conexión autorizada.
8. En Authentication → URL Configuration, Site URL debe coincidir con `NEXT_PUBLIC_APP_URL`. Permitir exactamente `http://localhost:3000/auth/callback` en desarrollo y la URL `/auth/callback` del dominio de pruebas publicado. No usar comodines para dominios ajenos.
9. Aplicar migraciones y comprobar el bucket `receipts`: privado, 10 MB, MIME JPG/PNG/PDF y políticas habilitadas. No crear un bucket público alternativo.
10. Probar login, recuperación, empresa, usuario empleado, asignación, egreso, comprobante, revisión y arqueo. Para probar invitaciones, configurar `SUPABASE_SERVICE_ROLE_KEY` solo en el entorno del servidor y SMTP autorizado. El administrador puede invitar desde Empresas; nunca se usa esta clave para consultas o movimientos financieros.

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
2. Revisar primero el proyecto existente **cuadria** asociado a `Lgomezg321/cuadria`. No crear un quinto proyecto. Si el propietario confirma que ninguno de los existentes corresponde a esta instalación, importar exclusivamente ese repositorio.
3. Framework: Next.js. Root Directory: raíz del repositorio. Node.js: 24.x. Install: `npm ci`. Build: `npm run build`. Output Directory: automático.
4. Para la primera prueba, desplegar la rama `codex/cuadria-foundation` como Preview. Mantener el control de acceso de previews disponible en la cuenta. No declarar producción lista porque una preview compile.
5. Configurar las variables públicas de `.env.example` y, para invitaciones, la variable administrativa opcional solo de servidor. `NEXT_PUBLIC_APP_URL` debe ser el origen HTTPS exacto de ese entorno. Utilizar Supabase de desarrollo para Preview; separar producción más adelante.
6. Configurar Functions Region en Washington, D.C./iad1 para acompañar us-east-1. No cambiar la región de una base existente sin un plan de migración.
7. Agregar el callback exacto en Supabase y volver a desplegar después de cambiar variables públicas: Next.js las incorpora durante la compilación.
8. Verificar la URL desplegada, inicio/cierre de sesión, RPCs, lectura aislada y documentos privados. Revisar errores sin imprimir tokens o contraseñas.

Vercel admite importar repositorios y generar previews por rama según su [documentación de Git](https://vercel.com/docs/git). El código incluye `vercel.json` con región iad1; no hay un despliegue confirmado todavía.

## Integración de la rama

Revisar el Pull Request, comprobar el workflow Quality y resolver sus fallos antes de integrar en main. No hacer force push ni reemplazar main. La implementación inicial se entrega como borrador porque falta la validación Supabase real y módulos del MVP.

## Operación y recuperación pendientes

Antes del piloto, comprobar retención y restauración de backups del plan elegido, recuperación de Storage, acceso de administradores, límites de Auth y correo, y retirada de usuarios. Registrar un ensayo de recuperación. La existencia de una opción de backup no demuestra que se haya verificado una restauración.

No utilizar dinero real hasta cerrar las pruebas pendientes de `docs/PROGRESS.md` y obtener validación del administrador.
