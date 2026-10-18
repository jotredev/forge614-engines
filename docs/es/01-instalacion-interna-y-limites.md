# 01. Instalación interna y límites

## La analogía: una pieza dentro de una caja de herramientas

Engines es una llave especializada dentro de la caja Forge614. Funciona para otros productos, pero no es la caja completa ni la mesa donde una persona trabaja. Esa separación evita que dos productos intenten controlar la misma configuración.

## Propiedad y ubicación

Cada producto Forge614 posee solamente su propia subcarpeta:

```text
~/.forge614/
├─ shell/
├─ engines/
├─ engram/
└─ atlas/
```

Shell instala y valida Engines automáticamente cuando lo necesita. En macOS y Linux, el binario esperado es `~/.forge614/engines/bin/forge614-engines`; en Windows termina en `.exe`. El instalador no cambia perfiles de terminal ni agrega Engines al PATH. Para funcionar necesita `tar`; `curl` para bajar la última versión publicada; `shasum` o `sha256sum` para verificar la descarga; y Node, o `python3` 3.9 o posterior si no hay Node, para leer la descripción de la versión.

La instalación común usa `install.sh` o `install.ps1`, que verifican `SHA256SUMS` antes de ejecutar `install.mjs`. Requiere Node.js 22.19.0 o posterior; no cambia PATH ni los perfiles de terminal. `FORGE614_HOME` puede cambiar la carpeta compartida durante pruebas controladas. No es una forma de compartir o borrar las carpetas de otros productos.

`update` llama al portero con una etiqueta resuelta, verifica su huella y lee la versión instalada después. Para conservar compatibilidad con Shell 1.17.0, devuelve el JSON de actualización incluso sin `--json`; se retirará esta excepción al acta 0031 cuando Shell pase esa opción. Desde Engines 1.17.x se requieren dos `update`: el primero instala 1.18.0 con el formato anterior; el segundo migra a la versión más reciente mediante el instalador común.

`uninstall` se detiene si detecta Shell, Workers, Atlas o Engram bajo `FORGE614_HOME`; `--force` permite continuar y limpia las integraciones administradas de Claude Code y Codex. `uninstall --self` retira únicamente esas integraciones mediante planes transaccionales, sin reemplazar configuraciones ni borrar archivos enteros.

## Responsabilidad exacta

Engines detecta agentes, conoce la ubicación de sus archivos de configuración, informa capacidades, prepara vistas previas de cambios MCP y aplica únicamente un plan identificado que ya fue confirmado por su consumidor. Atlas usa además el contrato de ejecución automática para decidir qué agentes puede iniciar sin una conversación visible.

Shell es el único producto Forge614 que presenta preguntas, avances, advertencias y confirmaciones. Engram conserva memoria; Atlas analiza repositorios. Engines no duplica ninguna de esas funciones.

## Límites de seguridad

Un plan guarda una huella SHA-256 (firma digital del contenido anterior) antes de proponer un cambio. Si el archivo cambia después, Engines rechaza la aplicación. Sus planes, copias de seguridad y evidencias se guardan bajo `FORGE614_HOME/engines/` — por defecto `~/.forge614/engines/` — con permisos solo para el propietario cuando el sistema lo permite.

No borra la carpeta familiar `~/.forge614/`, no toca archivos propios de Shell, Engram o Atlas, y no elimina una entrada MCP que no coincida exactamente con la forma que Engines habría instalado.

## Decisión práctica

Si una pantalla debe preguntar “¿quieres aplicar este cambio?”, la respuesta pertenece a Shell. Si se necesita saber “¿qué agentes existen y cómo se modifica su conexión?”, pertenece a Engines.
