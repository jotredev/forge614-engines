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

**El manual que se instala.** Engines pide a Engram el manual con `forge614-engram memory-protocol --json --protocol-version 4` (el «manual v4»). Solo si Engram responde con el error INVALID_INPUT —señal de un Engram anterior a la 1.7.0, que no conoce esa opción— Engines repite la llamada de siempre (protocolo v1) y agrega al plan un aviso en español e inglés (`metadata.protocol.legacyNotice`) que pide actualizar Engram. Cualquier otro error se reporta como antes, sin repetir la llamada. Con la v4, el texto `instructions` que entrega Engram se instala tal cual, sin encabezado ni nada agregado por Engines.

**Dónde queda.** El manual va incrustado dentro del archivo principal de cada agente, entre los marcadores administrados por Engines (Claude Code: `~/.claude/CLAUDE.md`; Codex: `~/.codex/AGENTS.md`). Dentro de los marcadores va primero la línea de marca de Engines (`<!-- Managed by Forge614 Engines. … -->`, que prueba que el bloque es suyo) y, después, `instructions` idéntico al de Engram. Claude Code ya no usa un archivo aparte.

**Migración desde la versión anterior.** Si el bloque ya instalado no es el manual sino una referencia `@archivo` (la forma antigua de Claude Code, que apuntaba a un archivo aparte), `plan memory-install` la reemplaza por el manual incrustado. Ese archivo aparte se borra solo si empieza con la marca de Engines; si no la trae (por ejemplo, lo escribió o editó otra persona), se deja donde está y el plan lo avisa en `metadata.instructions.status.notice`. `plan memory-remove` aplica la misma regla al quitar el bloque.

## Reparar un conflicto MCP existente

```text
forge614-engines plan mcp-repair --agent codex
```

`plan mcp-repair` clasifica la entrada `forge614-engram` en uno de cuatro
estados: `not-installed` (no existe), `already-correct` (ya es la
canónica, no hay nada que hacer), `repairable-conflict` (existe con otro
contenido y el archivo se puede escribir) o `blocked` (el archivo está
dañado —`blockedReason: "unparsable-config"`— o no se puede escribir
—`blockedReason: "not-writable"`—). El plan trae `repair.existing`: una
vista previa de la entrada conflictiva donde solo `command` y `args` se
muestran tal cual; cualquier otra clave (por ejemplo un `env` con
credenciales de otra herramienta) aparece como `"<redacted>"`. Shell debe
mostrar `plan.repair`, no `plan.writes[].afterContent` (ese campo es
plomería interna con el archivo completo, igual que en cualquier otro
plan, y se guarda con acceso restringido).

## Resolver Engram sin depender de PATH

Forge614 Shell instala el MCP con la ruta pública canónica del binario en `~/.forge614/engram/bin/forge614-engram`. Engines resuelve directamente esa misma ruta: usa `FORGE614_HOME` cuando existe esa variable de entorno; de lo contrario, usa la carpeta personal del usuario más `.forge614`; en Windows el ejecutable termina en `.exe`. Esta resolución se usa para la entrada MCP y para `forge614-engram memory-protocol --json`, de modo que una instalación válida de Shell se reconoce como la misma entrada y `plan memory-install` puede devolver `noop` en vez de un `CONFLICT` falso.

El resolvedor solo construye la ruta pública del ejecutable. No lee el `.env`, SQLite, memoria ni archivos de código internos de Engram, y no depende de `PATH`. Una entrada llamada `forge614-engram` con un comando diferente sigue siendo un conflicto real y permanece bloqueada; Engines nunca la sobrescribe en silencio.

## Ciclo correcto

1. Shell solicita el plan.
2. Shell muestra la vista previa a la persona.
3. La persona confirma o cancela.
4. Solo tras confirmar, Shell solicita `apply` con el `planId`.

No trates un plan como permiso automático. Es un presupuesto, no una orden de trabajo.
