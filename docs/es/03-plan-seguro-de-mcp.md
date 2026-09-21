# 03. Plan seguro de MCP

## La analogía: presupuesto antes de la reparación

Antes de que un mecánico toque un cable, entrega un presupuesto: qué pieza cambiaría, cuánto cambia y si en realidad no hace falta nada. `plan mcp-install` y `plan mcp-remove` hacen exactamente eso. Leen, comparan y guardan una propuesta; todavía no editan el archivo del agente.

## Instalar como propuesta

```text
forge614-engines plan mcp-install --agent codex --name engram --command forge614-engram --args mcp
```

El plan describe `planId`, `agentId`, `action`, `noop` y `writes`. `planId` es el comprobante único para aplicar después; `writes` contiene la ruta, la huella del contenido anterior y el contenido propuesto completo. Por eso el archivo de plan puede contener secretos ya presentes en la configuración y se conserva con acceso restringido.

Claude Code y Cursor usan JSON (un formato de texto con llaves); Codex usa TOML (un formato de texto con secciones). Engines coloca la entrada bajo `mcpServers` para JSON o `mcp_servers` para TOML. Una entrada tiene siempre `command` y `args`.

## Tres resultados posibles

1. **Escribir:** no existe una entrada con ese nombre; el plan incluye un cambio.
2. **Sin cambios (`noop`):** ya existe exactamente la misma entrada; aplicar el plan no toca archivos.
3. **Conflicto:** existe el mismo nombre, pero con otro contenido. Engines devuelve `CONFLICT` y se niega a adivinar cuál versión merece conservarse.

## Retirar con cautela

```text
forge614-engines plan mcp-remove --agent codex --name engram --command forge614-engram --args mcp
```

Si la entrada no existe, el plan es `noop`. Si existe pero no coincide exactamente con el comando y argumentos esperados, devuelve `UNRECOGNIZED_ENTRY`. Esto protege configuraciones creadas manualmente o por otra aplicación.

## Planear la integración de memoria

```text
forge614-engines plan memory-install --agent codex
forge614-engines plan memory-remove --agent codex
```

`plan memory-install` y `plan memory-remove` agrupan dos decisiones —la entrada MCP `forge614-engram` y el o los archivos de instrucciones del agente— en un solo plan, con un único `planId` que cubre ambas. Un conflicto en un solo componente no aborta ese plan: una entrada MCP `forge614-engram` diferente, o un `AGENTS.override.md` no vacío que eclipsa el `AGENTS.md` de Codex, se reporta como `blocked` solo para ese componente, mientras el otro componente sigue su curso normal. El componente de instrucciones de Cursor siempre se reporta como `unsupported`, porque Cursor no tiene un mecanismo global basado en archivos oficialmente documentado para cargar instrucciones automáticamente en cada sesión nueva.

## Ciclo correcto

1. Shell solicita el plan.
2. Shell muestra la vista previa a la persona.
3. La persona confirma o cancela.
4. Solo tras confirmar, Shell solicita `apply` con el `planId`.

No trates un plan como permiso automático. Es un presupuesto, no una orden de trabajo.
