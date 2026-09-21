# 05. Referencia del CLI público

## La analogía: un mostrador con recibos uniformes

El CLI (interfaz de línea de comandos) es el mostrador de Engines. Cada pedido devuelve un recibo JSON con `schemaVersion: 1`. Los productos deben usar ese contrato público, no importar archivos internos de este repositorio.

## Comandos

| Comando | Resultado principal | Escritura |
| --- | --- | --- |
| `forge614-engines detect` | `agents` detectados | No |
| `forge614-engines agents list` | todos los agentes que soporta el código, instalados o no | No |
| `forge614-engines capabilities --agent <id>` | capacidades de un agente | No |
| `forge614-engines plan mcp-install ...` | `plan` de instalación | Solo guarda el plan |
| `forge614-engines plan mcp-remove ...` | `plan` de retiro | Solo guarda el plan |
| `forge614-engines plan memory-install --agent <id>` | un `plan` coherente de integración de memoria | Solo guarda el plan |
| `forge614-engines plan memory-remove --agent <id>` | un `plan` coherente de retiro de integración de memoria | Solo guarda el plan |
| `forge614-engines apply --plan-id <id>` | `result` de aplicación | Sí, solo el plan confirmado |
| `forge614-engines headless ...` | `headless` con comando y argumentos | No |
| `forge614-engines update` | `result` de actualización | Gestiona solamente Engines |
| `forge614-engines verify memory-integration --agent <id>` | `verification` actual de MCP/instrucciones/hook | No |
| `forge614-engines memory-hook-run --agent <id>` | texto plano (Claude Code) o JSON `hookSpecificOutput.additionalContext` (Codex) por stdout | No |
| `forge614-engines plan mcp-repair --agent <id>` | `plan` de reparación con estado (`not-installed`/`already-correct`/`repairable-conflict`/`blocked`) | Solo guarda el plan |
| `forge614-engines apply mcp-repair --plan-id <id> [--confirm]` | `result` de aplicación confirmada | Sí, y solo con `--confirm` |
| `forge614-engines verify mcp-repair --agent <id> --plan-id <id>` | `verification` de esa reparación puntual | No |

`--args` consume valores hasta la siguiente bandera que empieza con `--`. Así los argumentos del servidor MCP no absorben por error otra opción de Engines.

## Ejemplos

```text
forge614-engines agents list
forge614-engines capabilities --agent cursor
forge614-engines headless --agent codex --executable codex --prompt "Resume este repositorio"
forge614-engines plan mcp-install --agent claude-code --name engram --command forge614-engram --args mcp
```

`agents list` reporta el registro estático de agentes que el código soporta —todos, sin importar si están o no instalados en esta máquina. `detect` responde una pregunta distinta: cuáles de esos agentes están realmente presentes ahora.

La salida de `headless` no ejecuta Codex ni Claude Code: produce la orden segura que Atlas puede decidir iniciar. Para Codex, la orden es `codex exec <prompt>`; para Claude Code, `claude -p <prompt>`. Las banderas opcionales `--model <model-id>` y `--reasoning-level <low|medium|high>` son aditivas: cada adaptador decide cómo incorporarlas a su propia orden, y Claude Code rechaza `--reasoning-level` con `REASONING_LEVEL_UNSUPPORTED` (ver 06). La bandera opcional `--stdin-prompt` saca el prompt de `args` y lo señala con `stdin: true` en la orden devuelta, para que nunca quede visible a `ps` en la máquina que lo ejecuta (ver 06).

`plan memory-install` lee el protocolo directamente desde `forge614-engram memory-protocol --json` cada vez, decide la entrada MCP y el o los archivos de instrucciones para el agente indicado, y devuelve un solo plan que ya contiene cada escritura que `apply` necesita — instalar y retirar la integración de memoria comparten el mismo comando `apply --plan-id <id>` que cualquier otro plan. `verify memory-integration` nunca toca Engram; solo inspecciona los archivos que Engines mismo administra.

Para los comandos de memoria, Engines resuelve `forge614-engram` en la ruta canónica `~/.forge614/engram/bin/forge614-engram`, o bajo `FORGE614_HOME` cuando esa variable existe; no busca en `PATH` ni lee archivos internos de Engram. Un comando diferente para el mismo nombre MCP `forge614-engram` sigue siendo un `CONFLICT` real.

## El hook de `SessionStart`

Desde esta versión, `plan memory-install` también instala un hook `SessionStart` para Claude Code y Codex, además del servidor MCP y las instrucciones estáticas — sin depender de que el modelo decida llamar a `memory_context` por su cuenta. El hook, en ambos agentes, apunta siempre al mismo comando fijo: `forge614-engines memory-hook-run --agent <id>`. Ese comando lee el `cwd` real de la sesión desde el propio stdin del hook, lo pasa a `forge614-engram startup-context --directory <cwd> --json` (el único comando de Engram que el hook puede invocar — nunca SQLite ni archivos privados), y devuelve el resultado ya saneado, enmarcado como memoria recuperada y acotado en tamaño. Claude Code recibe texto plano por stdout; Codex recibe `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`, nunca `systemMessage`. Si Engram falla o no está instalado, el hook sigue devolviendo una respuesta clara de "memoria no disponible" y la sesión continúa — nunca finge haber cargado memoria.

**`needs-user-trust`.** Codex exige revisar y confiar cada hook no administrado una vez, de forma interactiva, con su propio comando `/hooks`, antes de ejecutarlo — Engines no tiene ninguna forma documentada y estable de otorgar o verificar esa confianza, y nunca usa `--dangerously-bypass-hook-trust` para saltarla. Por eso, para Codex, el componente `hook` de `plan memory-install`/`verify memory-integration` reporta `needs-user-trust` en vez de "correcto", y `overallStatus` nunca llega a `"complete"` para Codex — solo a `"partial"`. Engines no abre Codex ni pregunta nada: solo reporta ese estado para que Shell decida cómo lanzarlo. Claude Code no tiene esta restricción y sí puede llegar a `"complete"`.

**Verificación real, no solo presencia.** `verify memory-integration` no se conforma con comprobar que la entrada del hook existe en el archivo de configuración: además ejecuta el mismo código que correría el hook real, de punta a punta, contra el binario real de Engram (o uno de prueba), y solo cuenta el componente `hook` como correcto si esa ejecución de verificación produce contexto bien formado. Eso es lo máximo que Engines puede verificar honestamente sin una sesión de agente real en curso.

## Errores públicos

Todos los errores salen como JSON y tienen `error.code` y `error.message`.

| Código | Causa |
| --- | --- |
| `CONFLICT` | existe una entrada MCP diferente con el mismo nombre |
| `STALE_PLAN` | el archivo cambió tras crear el plan |
| `UNRECOGNIZED_ENTRY` | retirar afectaría una entrada no reconocida |
| `PLAN_NOT_FOUND` | no se encontró el plan |
| `UPDATE_ASSET_MISSING` | no existe una descarga para plataforma y arquitectura |
| `HEADLESS_UNSUPPORTED` | el agente no puede construir una orden sin pantalla |
| `REASONING_LEVEL_UNSUPPORTED` | el adaptador headless del agente no tiene forma de seleccionar un nivel de razonamiento |
| `UNKNOWN_COMMAND` | la combinación de palabras no es un comando público |
| `UNKNOWN_AGENT` | el identificador no está registrado |
| `INTERNAL_ERROR` | ocurrió un problema no clasificado |
| `ENGRAM_PROTOCOL_UNAVAILABLE` | Engram no está instalado, el comando falló, o su JSON no coincidió con la forma del protocolo |
| `NOT_REPAIRABLE` | el `planId` dado no es un plan de reparación de `forge614-engram` |
| `CONFIRMATION_REQUIRED` | intento de aplicar un plan de reparación de `mcp-repair` mediante `apply` genérico en lugar de `apply mcp-repair --confirm` |

No dependas del texto del mensaje para automatizar decisiones; usa el código estable.
