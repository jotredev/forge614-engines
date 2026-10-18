# forge614-engines

Herramientas de Forge614 para detectar agentes, revisar capacidades y aplicar cambios de configuración MCP mediante planes seguros. El instalador común está definido por `forge614.node.json` y el acta 0031.

## Instalación

Plataformas: macOS (arm64/x64), Linux (arm64/x64) y Windows (x64). Requiere Node.js 22.19.0 o posterior. La instalación no modifica PATH ni perfiles de terminal.

```sh
curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | sh
```

```powershell
irm https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1 -OutFile install.ps1
./install.ps1
```

El ejecutable queda en `~/.forge614/engines/bin/forge614-engines` o, en Windows, bajo `%USERPROFILE%\.forge614\engines\bin\forge614-engines.exe`. Usa `--version --json` para obtener la versión como JSON.

## Actualizar y desinstalar

`forge614-engines update [--version X.Y.Z] [--json]` actualiza mediante el portero verificado y devuelve el JSON que Shell 1.17.0 consume incluso sin `--json`. Esta excepción al acta 0031 se retirará cuando Shell pase esa opción. Desde 1.17.x se requieren dos actualizaciones: la primera deja 1.18.0 en el formato anterior; la segunda migra mediante el instalador compartido.

`forge614-engines uninstall [--force] [--json]` detiene la retirada si Shell, Workers, Atlas o Engram están instalados. `--force` retira también las integraciones administradas por Engines en Claude Code y Codex. `uninstall --self` retira solo esas integraciones y conserva el contenido ajeno.

## Desarrollo

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
```

La documentación bilingüe está en [docs](docs/README.md). Para compilar un binario de CI, define `FORGE614_TARGET` (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64` o `windows-x64`) y ejecuta `bun run build:target`.
