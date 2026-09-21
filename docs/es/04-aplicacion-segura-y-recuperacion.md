# 04. Aplicación segura y recuperación

## La analogía: comparar el presupuesto con la pieza real

Un presupuesto viejo no debe aplicarse si alguien ya cambió la pieza. Antes de escribir, Engines vuelve a mirar el archivo y compara su huella con la que guardó al crear el plan. Así evita deshacer el trabajo de una persona o de otro programa.

## Aplicar un plan confirmado

```text
forge614-engines apply --plan-id 11111111-2222-3333-4444-555555555555
```

El identificador debe corresponder a un archivo en `~/.forge614/engines/plans/`. Si falta, la respuesta usa `PLAN_NOT_FOUND`. Si el plan indica `noop`, la operación termina correctamente y `changedFiles` queda vacío.

Para cada escritura real, Engines lee de nuevo el archivo objetivo. Calcula SHA-256 y exige que sea idéntico al valor `beforeHash` del plan. Una diferencia produce `STALE_PLAN` (plan vencido), sin escribir nada. La solución segura es crear otro plan, mostrarlo de nuevo y volver a pedir confirmación.

Una escritura también puede ser una eliminación —usada para retirar por completo el archivo de contenido de instrucciones dedicado de Claude Code en `plan memory-remove`— y se aplica mediante exactamente el mismo camino de verificación de huella y copia de seguridad que cualquier otra escritura.

## Aplicar una reparación solo con confirmación explícita

```text
forge614-engines apply mcp-repair --plan-id <id> --confirm
```

A diferencia de `apply` genérico, `apply mcp-repair` exige la bandera
`--confirm`. Sin ella, la respuesta trae `confirmed: false` y
`applied: false`, y Engines no lee, no calcula huellas ni escribe nada.
Con `--confirm`, aplica el mismo mecanismo que cualquier otro plan: huella
del contenido anterior, respaldo (snapshot) y escritura atómica. Si el
archivo cambió desde que se generó el plan, falla con `STALE_PLAN` y no
sobrescribe nada.

## Copia y escritura confiable

Antes de cambiar un archivo existente, Engines crea una copia bajo `~/.forge614/engines/snapshots/<planId>/`. El manifiesto (lista estructurada de lo respaldado) guarda ruta original, nombre de copia, fecha y huella.

La escritura es atómica (el archivo nuevo aparece de una sola vez): escribe primero un archivo temporal con permisos privados, lo sincroniza con el disco y luego lo renombra al nombre final. Después vuelve a leerlo y compara su huella. En sistemas distintos de Windows también sincroniza la carpeta, reduciendo el riesgo de una interrupción a mitad del cambio.

## Recuperación

La función interna de restauración usa el manifiesto para copiar cada respaldo a su ruta original. La interfaz pública actual no expone un comando `restore`; Shell debe conservar el contexto del plan y decidir cualquier flujo visible de recuperación. No elimines respaldos manualmente si todavía se investiga un cambio.

## Qué esperar al fallar

| Código | Significado cotidiano | Acción segura |
| --- | --- | --- |
| `STALE_PLAN` | el archivo cambió desde el presupuesto | crear un plan nuevo |
| `PLAN_NOT_FOUND` | no está el comprobante solicitado | volver a calcular el plan |
| `CONFLICT` | el mismo nombre contiene otra configuración | revisar ambos valores en Shell |
| `UNRECOGNIZED_ENTRY` | la entrada parece ser de otra persona o herramienta | no retirarla automáticamente |

La seguridad depende de conservar este orden: plan, revisión humana, aplicación inmediata.
