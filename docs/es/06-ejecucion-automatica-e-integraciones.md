# 06. Ejecución automática e integraciones

## La analogía: preparar una orden sellada

Atlas necesita a veces pedir un análisis sin abrir una conversación en pantalla. Engines no hace ese trabajo por él: prepara una orden sellada con el programa y los argumentos correctos. Atlas decide cuándo y dónde iniciarla.

## Contrato `headless`

“Headless” (sin pantalla interactiva) significa que un programa puede recibir una instrucción y devolver un resultado sin que una persona responda menús o preguntas. Engines expone la forma de construir esa orden:

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explica la estructura"
forge614-engines headless --agent codex --executable codex --prompt "Explica la estructura"
forge614-engines headless --agent codex --executable codex --prompt "Explica la estructura" --model gpt-5-codex --reasoning-level medium
```

| Agente | Orden devuelta | Soporte |
| --- | --- | --- |
| Claude Code | `claude -p <prompt>` | Sí |
| Codex | `codex exec <prompt>` | Sí |

Un agente sin ejecución automática responde `HEADLESS_UNSUPPORTED`.

`--timeout-ms` acepta un tiempo en milisegundos (mil partes de un segundo) para que el consumidor lo incluya en su propio control. El adaptador actual construye la orden y no añade ese valor a los argumentos de Claude Code ni Codex.

`--model <model-id>` y `--reasoning-level <low|medium|high|xhigh|max>` son opcionales y aditivos: si no se pasan, el comando es idéntico al que cada adaptador ya construía. Cada adaptador decide por sí mismo cómo los honra, igual que cada adaptador ya es dueño de la forma de su propio comando headless. Engines revisa una sola vez, antes de que corra cualquier adaptador, en este orden: agente desconocido (`UNKNOWN_AGENT`), agente sin ejecución automática (`HEADLESS_UNSUPPORTED`), un nivel dado a un agente que no puede elegirlo (`REASONING_LEVEL_UNSUPPORTED`; hoy ningún agente real lo hace) y, al final, un valor que el agente no lista, que incluye cualquier valor fuera de los cinco (`INVALID_REASONING_LEVEL`):

| Agente | `--model` | `--reasoning-level` |
| --- | --- | --- |
| Claude Code | Agrega `--model <model-id>` | Agrega `--effort <level>` como último argumento: después de `-p`, del prompt (cuando no se envía por stdin) y de `--model` (si se pasó). Haiku 4.5 no tiene niveles de razonamiento y Claude Code ignora el flag para ese modelo sin error. Claude Code tampoco rechaza un valor desconocido (avisa y sigue con su esfuerzo de fábrica), por eso Engines valida el nivel antes. |
| Codex | Agrega `--model <model-id>` | Agrega `-c model_reasoning_effort=<level>` |

## Mantener el prompt fuera de `ps`

Por defecto el prompt queda embebido directamente en `args` (ej. `["-p", "<prompt>"]`), lo cual lo hace visible para cualquier otro proceso o usuario en la misma máquina que pueda correr `ps` — un riesgo real cuando el prompt lleva contenido sensible del repositorio. `--stdin-prompt` es un flag opcional y aditivo: omitirlo mantiene el comportamiento actual exacto (nada cambia para quien nunca lo pasa).

Cuando se pasa `--stdin-prompt`, el adaptador quita el prompt de `args` por completo y la orden devuelta incluye `"stdin": true`. El llamador (Atlas) ya tiene el prompt que envió originalmente — debe escribir ese mismo texto al stdin del proceso creado y cerrarlo (enviar EOF), en vez de buscarlo en `args`:

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explica la estructura" --stdin-prompt
```

```json
{ "command": "claude", "args": ["-p"], "stdin": true }
```

| Agente | Entrega por stdin | Confirmado con |
| --- | --- | --- |
| Claude Code | Soportado: `claude -p` sin prompt posicional lo lee de stdin | Invocación real contra el CLI real |
| Codex | Soportado: `codex exec` sin argumento posicional de prompt lo lee de stdin | `codex exec --help`: "If not provided as an argument (or if `-` is used), instructions are read from stdin" |

Ambos agentes headless soportados hoy honran `--stdin-prompt`, así que no hay ninguna excepción que documentar por ahora. Si en el futuro un adaptador no puede entregar el prompt por stdin, debe lanzar un error explícito desde su propio `headlessCommand()` (mismo patrón que `REASONING_LEVEL_UNSUPPORTED`) en vez de dejar el prompt en `args` en silencio — ignorar el flag en silencio anularía el objetivo de seguridad por el que existe.

## Dar acceso de lectura a una carpeta real

El proceso creado normalmente queda confinado a su propio directorio de trabajo aislado. `--readable-dir <ruta>` es una bandera opcional y aditiva que le da acceso de lectura a una carpeta real adicional del proyecto sin romper ese aislamiento en lo demás: si no se pasa, el comportamiento es idéntico al actual.

```text
forge614-engines headless --agent claude-code --executable claude --prompt "Explica la estructura" --readable-dir /ruta/al/proyecto
```

```json
{ "command": "claude", "args": ["--add-dir", "/ruta/al/proyecto", "-p", "Explica la estructura"] }
```

Ambos agentes headless soportados hoy la mapean a `--add-dir <ruta>`, siempre colocada antes del prompt (`--add-dir` es variádico — acepta varias rutas seguidas — así que colocarla después del prompt se comería el texto del prompt como si fuera otra ruta):

| Agente | Comportamiento | Confirmado con |
| --- | --- | --- |
| Claude Code | Agrega `--add-dir <ruta>` antes de `-p`. Confirmado que no carga el `CLAUDE.md` de esa carpeta — solo carga el `CLAUDE.md` global del usuario real, que es el comportamiento esperado. | Invocación real contra el CLI real |
| Codex | Agrega `--add-dir <ruta>` antes del prompt posicional. `--add-dir` técnicamente puede otorgar acceso de escritura en Codex, pero el sandbox por defecto de `codex exec` sigue siendo de solo lectura mientras no se pase también `--sandbox workspace-write` ni `--sandbox danger-full-access` (este adaptador nunca pasa ninguno de los dos). | Invocación real contra el CLI real |

**Limitación aceptada (solo Codex):** a diferencia de Claude Code, Codex puede leer y dejarse influenciar por el `AGENTS.md` de esa carpeta si decide explorarla por su cuenta — Codex no tiene un equivalente al `--allowedTools` de Claude Code para restringir esto más fino. Es una limitación aceptada y de bajo riesgo (Codex sigue sin poder escribir ni dañar nada bajo el sandbox de solo lectura por defecto) y no es algo que esta integración intente resolver.

## Relación con Atlas

El flujo acordado es:

```text
Engines detecta agentes utilizables
        ↓
Atlas pide comando sin pantalla
        ↓
Atlas inicia y valida trabajadores
        ↓
Atlas escribe conocimiento validado en Engram
```

Los trabajadores no escriben directamente en Engram. Atlas no vuelve a implementar detección. Esta división evita respuestas distintas a la misma pregunta “¿qué agente hay disponible?”.

## Relación con Shell

Shell consume `detect`, `capabilities`, planes y `apply` para su flujo visual. Puede mostrar una propuesta, pero no debe leer `src/` ni la carpeta de planes directamente. Engines no muestra el progreso ni solicita confirmación: esos son trabajos de Shell.

## Añadir un agente futuro

Un adaptador nuevo declara un identificador, nombres de ejecutable, rutas conocidas, archivo y formato de configuración, forma MCP, capacidades y, opcionalmente, su destino de aprobación de herramientas (`toolApproval`). Si marca `supportsHeadlessExec: true`, debe proporcionar una función que construya el comando. También declara `supportsReasoningLevel` para indicar si acepta `HeadlessOptions.reasoningLevel` (el flag `--reasoning-level`) y, si lo acepta, los niveles que admite en `reasoningLevels` (un subconjunto no vacío de los cinco; obligatorio cuando `supportsReasoningLevel` es `true` y ausente en caso contrario). `headlessCommandFor()` los usa para devolver `REASONING_LEVEL_UNSUPPORTED` cuando el agente no puede elegir nivel e `INVALID_REASONING_LEVEL` cuando el valor no está en su lista. Las pruebas de registro rechazan una promesa de capacidad incompleta.
