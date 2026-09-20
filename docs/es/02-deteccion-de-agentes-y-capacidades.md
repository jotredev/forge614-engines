# 02. Detección de agentes y capacidades

## La analogía: pasar lista antes de abrir el taller

Antes de asignar trabajo, el inspector pasa lista: busca cada herramienta, confirma que puede encenderse y anota qué funciones trae. Encontrar una carpeta no equivale a encontrar una herramienta utilizable; por eso Engines revisa ambas cosas por separado.

## Agentes registrados

| Identificador | Ejecutable buscado | Archivo MCP | MCP | Hooks | Ejecución automática |
| --- | --- | --- | ---: | ---: | ---: |
| `claude-code` | `claude` / `claude.exe` | `~/.claude.json` | Sí | Sí | Sí |
| `codex` | `codex` / `codex.exe` | `~/.codex/config.toml` | Sí | Sí | Sí |
| `cursor` | aplicación Cursor | `~/.cursor/mcp.json` | Sí | No | No |

Un hook (una acción que un programa llama en un momento concreto) aparece como capacidad informativa. No implica que Engines lo configure.

## Cómo busca

`detect` revisa primero PATH. Solo acepta rutas absolutas y archivos ejecutables; por eso no confunde un texto llamado `codex` con el programa real. Si no lo encuentra ahí, prueba rutas conocidas: Claude Code puede estar en `~/.local/bin/claude`; Cursor tiene rutas conocidas de aplicación en macOS y Windows. Codex no tiene una ruta alternativa fija.

También comprueba si existe la carpeta de configuración, aunque el ejecutable falte. Esto permite a Shell explicar “hay ajustes guardados, pero el programa no está disponible” sin inventar una causa.

```text
forge614-engines detect
```

La salida contiene una lista `agents`; cada elemento incluye `id`, `label`, `installed`, `executable`, `configDir` y `configFound`.

## Consultar capacidades

```text
forge614-engines capabilities --agent codex
```

La respuesta indica `supportsMcp`, `supportsHooks` y `supportsHeadlessExec`. Es una promesa explícita del adaptador, no una suposición basada en el nombre del agente. Si se registra un adaptador que dice soportar ejecución automática pero no sabe construir su comando, el registro se rechaza al iniciar.

## Límites y diagnóstico

La detección no inicia el agente, no inicia sesión, no modifica PATH y no prueba credenciales. “No instalado” significa solo que Engines no halló un archivo ejecutable en los lugares que revisa; no demuestra que una cuenta esté desconectada.
