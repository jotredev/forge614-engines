# 03. Plan seguro de MCP

## La analogía: presupuesto antes de la reparación

Antes de que un mecánico toque un cable, entrega un presupuesto: qué pieza cambiaría, cuánto cambia y si en realidad no hace falta nada. `plan mcp-install` y `plan mcp-remove` hacen exactamente eso. Leen, comparan y guardan una propuesta; todavía no editan el archivo del agente.

## Instalar como propuesta

```text
forge614-engines plan mcp-install --agent codex --name engram --command forge614-engram --args mcp
```

El plan describe `planId`, `agentId`, `action`, `noop` y `writes`. `planId` es el comprobante único para aplicar después; `writes` contiene la ruta, la huella del contenido anterior y el contenido propuesto completo. Por eso el archivo de plan puede contener secretos ya presentes en la configuración y se conserva con acceso restringido.

Claude Code usa JSON (un formato de texto con llaves); Codex usa TOML (un formato de texto con secciones). Engines coloca la entrada bajo `mcpServers` para JSON o `mcp_servers` para TOML. Una entrada tiene siempre `command` y `args`.

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

`plan memory-install` y `plan memory-remove` agrupan las decisiones —la entrada MCP `forge614-engram`, el o los archivos de instrucciones del agente, el hook de inicio de sesión (capítulo 05) y la aprobación de las herramientas de Engram (sección siguiente)— en un solo plan, con un único `planId` que las cubre todas. Un conflicto en un solo componente no aborta ese plan: una entrada MCP `forge614-engram` diferente, o un `AGENTS.override.md` no vacío que eclipsa el `AGENTS.md` de Codex, se reporta como `blocked` solo para ese componente, mientras el otro componente sigue su curso normal. Un componente que el agente no tiene forma de recibir se reporta como `unsupported` para ese agente.

**El manual que se instala.** Engines pide a Engram el manual con `forge614-engram memory-protocol --json --protocol-version 4` (el «manual v4»). Solo si Engram responde con el error INVALID_INPUT —señal de un Engram anterior a la 1.7.0, que no conoce esa opción— Engines repite la llamada de siempre (protocolo v1) y agrega al plan un aviso en español e inglés (`metadata.protocol.legacyNotice`) que pide actualizar Engram. Cualquier otro error se reporta como antes, sin repetir la llamada. Con la v4, el texto `instructions` que entrega Engram se instala tal cual, sin encabezado ni nada agregado por Engines.

**Dónde queda.** El manual va incrustado dentro del archivo principal de cada agente, entre los marcadores administrados por Engines (Claude Code: `~/.claude/CLAUDE.md`; Codex: `~/.codex/AGENTS.md`). Dentro de los marcadores va primero la línea de marca de Engines (`<!-- Managed by Forge614 Engines. … -->`, que prueba que el bloque es suyo) y, después, `instructions` idéntico al de Engram. Claude Code ya no usa un archivo aparte.

**Migración desde la versión anterior.** Si el bloque ya instalado no es el manual sino una referencia `@archivo` (la forma antigua de Claude Code, que apuntaba a un archivo aparte), `plan memory-install` la reemplaza por el manual incrustado. Ese archivo aparte se borra solo si empieza con la marca de Engines; si no la trae (por ejemplo, lo escribió o editó otra persona), se deja donde está y el plan lo avisa en `metadata.instructions.status.notice`. `plan memory-remove` aplica la misma regla al quitar el bloque.

## Aprobar las herramientas de Engram

**Por qué existe.** Algunos modos de permisos no pueden preguntarle nada a la persona: Claude Code en modo `dontAsk` niega toda herramienta que no esté en `permissions.allow`, y Codex con `approval_policy = "never"` niega una herramienta MCP que pide aprobación. Sin aprobación, la memoria de Engram falla justo en esos modos (`memory_session_start` sale «Fallido»). Por eso `plan memory-install` también aprueba para siempre las herramientas del servidor `forge614-engram`, en cualquier modo de permisos.

**Qué se escribe.**

| Agente | Archivo | Qué |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` (el mismo archivo del hook) | la regla `mcp__forge614-engram` agregada **al final** de `permissions.allow` |
| Codex | `~/.codex/config.toml` (el mismo archivo de la entrada MCP y del hook) | `default_tools_approval_mode = "approve"` dentro de `[mcp_servers.forge614-engram]` |

En Claude Code la regla se inserta sin reescribir el arreglo: las demás reglas conservan su orden, su texto y los comentarios que las rodean, y no se toca ninguna otra clave. Si `permissions` o `allow` no existen, se crean. Es `noop` si ya está `mcp__forge614-engram` o `mcp__forge614-engram__*` en `allow` y ninguna regla `deny` o `ask` de ese archivo cubre a Engram; si alguna lo hace, el plan igual escribe, para quitarla. Si `allow` existe pero no es un arreglo, solo el componente de aprobación queda `blocked` (`allow-not-array`) y el resto del plan sigue. Cuando el archivo también recibe el hook (o, en Codex, la entrada MCP y el hook), todo va en una sola escritura a ese archivo. Una entrada MCP `forge614-engram` existente con contenido distinto nunca se aprueba (`mcp-conflict`).

En Codex, la entrada MCP que lleva `default_tools_approval_mode` se sigue reconociendo como propia de Engines: esa clave se ignora al comparar la entrada, así que no es un `CONFLICT` ni «no reconocida» y `verify` sigue encontrando el MCP presente. Cualquier otra diferencia sigue siendo conflicto.

**Qué cambia de lo que la persona tenía.** Claude Code evalúa primero las reglas deny, luego ask y luego allow, y gana la primera que coincide, así que una regla allow no puede abrir una excepción dentro de un deny. Por eso, si `permissions.deny` o `permissions.ask` **de ese mismo archivo** tienen reglas que cubren a Engram (`mcp__forge614-engram`, `mcp__forge614-engram__*` o `mcp__forge614-engram__<herramienta>`), el plan quita exactamente esas reglas (por posición, sin tocar las demás) y lo dice. En Codex, si `default_tools_approval_mode` ya tenía otro valor (`prompt`, `writes` o `auto`), el plan lo cambia a `approve` y lo dice. Ambos casos se informan en `metadata.approval.status.notice`, con lo que se cambió y cómo desactivarlo. Agregar la regla cuando no había nada que cambiar no lleva aviso.

**Cómo desactivarla.** La aprobación es parte de la memoria de Engram: se quita desinstalando la memoria con `plan memory-remove --agent <id>` y luego `apply`. Eso quita toda regla de `permissions.allow` que sea `mcp__forge614-engram`, `mcp__forge614-engram__*` o `mcp__forge614-engram__<herramienta>` (solo esas; si `allow` queda vacío se queda vacío), y en Codex la clave se va junto con la entrada MCP. Si `permissions.allow` existe pero no es un arreglo, quitar la aprobación queda `blocked` (`allow-not-array`) y el resto del retiro sigue. Las reglas deny y ask que se quitaron al instalar no se restauran.

**Limitación.** Engines solo lee y escribe el archivo de nivel usuario (`~/.claude/settings.json`, `~/.codex/config.toml`). Las configuraciones de Claude Code de nivel proyecto o administradas por una organización no se tocan y pueden seguir ganando a esta aprobación.

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
