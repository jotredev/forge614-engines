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
| Cursor | — | No; devuelve `HEADLESS_UNSUPPORTED` |

`--timeout-ms` acepta un tiempo en milisegundos (mil partes de un segundo) para que el consumidor lo incluya en su propio control. El adaptador actual construye la orden y no añade ese valor a los argumentos de Claude Code ni Codex.

`--model <model-id>` y `--reasoning-level <low|medium|high>` son opcionales y aditivos: si no se pasan, el comando es idéntico al que cada adaptador ya construía. Cada adaptador decide por sí mismo cómo (o si) los honra, igual que cada adaptador ya es dueño de la forma de su propio comando headless:

| Agente | `--model` | `--reasoning-level` |
| --- | --- | --- |
| Claude Code | Agrega `--model <model-id>` | No soportado — lanza `REASONING_LEVEL_UNSUPPORTED`. El CLI de Claude Code no tiene un flag público y estable para elegir un nivel de razonamiento/pensamiento, así que el adaptador lo rechaza de forma explícita en vez de construir en silencio una orden que lo ignoraría. |
| Codex | Agrega `--model <model-id>` | Agrega `-c model_reasoning_effort=<level>` |

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

Un adaptador nuevo declara un identificador, nombres de ejecutable, rutas conocidas, archivo y formato de configuración, forma MCP y capacidades. Si marca `supportsHeadlessExec: true`, debe proporcionar una función que construya el comando. Las pruebas de registro rechazan una promesa de capacidad incompleta.
