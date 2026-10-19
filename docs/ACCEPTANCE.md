# Aceptación con Supabase real

Estado: **pendiente de ejecutar**. Esta guía no representa resultados de prueba. Ejecutar en `cuadria-dev`, con usuarios y documentos de prueba identificados, nunca con dinero ni facturas reales. Usar un administrador propietario, un empleado y un usuario sin membresía. Los datos de este documento son exclusivamente entradas de prueba y no se precargan en la aplicación.

## Circuito MVP de la especificación

| Paso | Acción                                          | Resultado que debe comprobarse                                                    |
| ---- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| 1    | Administrador inicia sesión                     | Sesión válida; una petición sin sesión no obtiene datos.                          |
| 2    | Crea empresa de prueba                          | Empresa persistida y membresía admin explícita.                                   |
| 3    | Invita al empleado                              | Correo llega; vínculo verifica correo y concede exactamente el rol invitado.      |
| 4    | Crea caja menor                                 | Fondo COP, empresa correcta y tipo efectivo.                                      |
| 5    | Asigna caja al empleado                         | Asignación vigente; empleado no obtiene fondos ajenos.                            |
| 6    | Establece apertura de 100000 COP al crear fondo | Un único asiento de apertura; saldo 100000. No volver a abrir un fondo ya creado. |
| 7    | Empleado inicia sesión desde móvil              | Navegación y formularios utilizables; solo caja asignada.                         |
| 8    | Registra egreso de 12500 COP                    | Una operación, un asiento -12500 y actor correcto.                                |
| 9    | Adjunta factura de prueba                       | Archivo privado; usuario sin acceso no puede leerlo.                              |
| 10   | Consulta saldo                                  | 87500 COP tras recargar y volver a iniciar sesión.                                |
| 11   | Administrador abre Auditoría                    | Encuentra el egreso del empleado.                                                 |
| 12   | Abre detalle y comprobante                      | Importe, fecha y factura coinciden; imagen/PDF legible.                           |
| 13   | Aprueba movimiento                              | Revisión aprobada por actor diferente del autor.                                  |
| 14   | Consulta historial                              | Decisión, comentario, actor y fecha visibles; saldo sigue 87500.                  |
| 15   | Empleado declara efectivo 87000 COP             | Declaración guardada con saldo teórico 87500.                                     |
| 16   | Consulta arqueo                                 | Diferencia -500 COP, sin ajuste automático de asientos.                           |
| 17   | Administrador consulta diferencia               | Ve -500 y puede observar/aprobar la declaración.                                  |
| 18   | Consulta historial de auditoría                 | Eventos de registro, comprobante y revisión atribuibles al actor.                 |
| 19   | Consulta saldos autorizados                     | La caja muestra 87500; otras cajas respetan sus saldos propios.                   |
| 20   | Cierra sesión, reinicia navegador y consulta    | Persistencia en Supabase, sin depender de memoria o almacenamiento local.         |

El paso 6 ocurre durante el paso 4 en esta UI: la apertura es atómica con la creación y no se modifica después. La asignación del paso 5 se realiza tras aceptar la invitación; actualmente se usa el UUID Auth del empleado.

## Ampliación implementada

1. Guardar borrador de egreso: saldo sin cambio. Abrirlo en dos sesiones; una versión desactualizada debe fallar. Enviar dos veces: un único movimiento.
2. Observar un egreso y responder como autor. La respuesta no cambia saldo ni revisión y permanece al recargar. Auditor solo lee.
3. Transferir 1000 COP entre dos fondos: suma total sin cambio. Reintentar misma clave con distinto contenido: rechazo.
4. Aprobar todos los movimientos elegibles y cerrar el período. Comparar totales del cierre con asientos. Registro tardío y cambio de revisión deben fallar. Repetir mismo corte no duplica cierre.
5. Reversar en una fecha abierta: asiento compensatorio único, original conservado. Si no hay saldo suficiente, nada cambia.
6. Reporte: comprobar saldo inicial + aperturas + ingresos - egresos + transferencias netas + reversiones netas = saldo final. Cambiar filtros del detalle no altera saldo total del fondo.
7. Crear más de 200 asientos de prueba para comprobar paginación, ausencia de duplicados y enlaces históricos a auditoría. CSV debe indicar la página exportada; PDF debe mostrar el resumen completo legible.
8. Revocar invitación y probar que no activa membresía. Correo sin verificar no puede aceptar. Invitar a un usuario que ya tiene membresía no debe escalar su rol ni reactivarla.
9. Intentar desactivar fondo con saldo: rechazo. Fondo vacío puede desactivarse y no admite nuevos movimientos ordinarios.

## Seguridad y recuperación

Comprobar mediante PostgREST/Storage con JWT de cada usuario: lectura entre empresas, fondos no asignados, escritura directa de asientos, escalación de rol, RPCs anónimas y lectura de comprobantes ajenos. Desactivar asignación y confirmar pérdida de acceso. No reutilizar tokens de prueba en documentación ni logs.

Probar cierre de sesión, vencimiento/renovación de cookies, recuperación de contraseña, invitación expirada y callback alterado. Validar que claves administrativas no aparecen en JavaScript descargado, logs o reportes.

Ejecutar concurrencia sobre PostgreSQL vacío desechable mediante `npm run test:concurrency`; no apuntarlo a Supabase con datos. Repetir escenarios de carrera mediante sesiones HTTP reales en desarrollo.

Ensayar restauración de base y objetos Storage en un entorno aislado. Registrar fecha, alcance, duración, conteos, saldos antes/después y responsable. Confirmar el plan de backup vigente en la cuenta; no afirmar recuperación probada solo porque existe una opción de backup.

## Registro de resultados

Por caso, registrar: fecha, commit, entorno, actor/rol sin secretos, entrada, resultado esperado, resultado observado, aprobado/fallido y evidencia saneada. Cualquier fallo de dinero, aislamiento o persistencia impide aprobar el piloto. La aprobación final corresponde al responsable de la operación después del circuito completo.
