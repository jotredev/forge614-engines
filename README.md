# forge614-engines

Detecta qué agentes de programación con IA (Claude Code, Codex, …) están instalados en la máquina de la persona, y previsualiza y aplica de forma segura cambios de configuración de servidores MCP para ellos.

Dependencia interna del ecosistema Forge614 — ver `FORGE614_ECOSYSTEM_CONTRACT.md`. No está pensado para que una persona lo instale directamente; los demás productos de Forge614 lo preparan solos.

## Para otros productos de Forge614

Plataformas soportadas: macOS (arm64/x64), Linux (arm64/x64), Windows (x64).

Instalación (sin cambios en PATH ni en el perfil — deja un binario en una ruta conocida):

```bash
# macOS / Linux
curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash
```

```powershell
# Windows
irm https://github.com/jotredev/forge614-engines/releases/latest/download/install.ps1 -OutFile install.ps1
./install.ps1
```

Después se llama directamente — `~/.forge614/engines/bin/forge614-engines` en macOS/Linux, o
`%USERPROFILE%\.forge614\engines\bin\forge614-engines.exe` en Windows.

## Documentación

- [Bilingual product documentation / Documentación bilingüe del producto](docs/README.md)
- Especificación: `docs/superpowers/specs/2026-09-19-forge614-engines-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-forge614-engines-mvp.md`
- Traspaso: `docs/superpowers/handoffs/2026-09-19-forge614-engines-mvp.md`

## Publicar versiones

```bash
bun run release   # elige la versión por sí mismo — ver abajo
```

Sin el argumento `<version>` (la forma recomendada de correrlo), calcula una versión razonable
en lugar de dejarte elegir un número: mira cada commit desde la última etiqueta y sugiere una
versión, menor (minor) para cualquier commit `feat:`, parche (patch) en los demás casos, y mayor
(major) con un `!` después del tipo (`feat!:`) o un pie `BREAKING CHANGE:` — la misma lógica que usa
`bun run verify:release` para previsualizarlo sin publicar nada. Recibes el desglose de cada commit y
su clasificación, y después una única pregunta:

```
Release 1.10.0? [Y/n, or type a different version]:
```

Enter o `y` la acepta y pasa directo a publicar — esa única respuesta ya es la confirmación del
lanzamiento, así que nunca vuelve a preguntar «¿continuar?» justo después. `n` aborta. Escribir
otra versión en su lugar se toma como una decisión deliberada de sustituirla, que sí tiene su propia
confirmación explícita después (ver abajo) — cambiar lo sugerido es una decisión distinta y más
deliberada que aceptarlo, y merece su propia puerta; aceptarlo no necesita dos. Sin interacción (sin TTY),
usa la sugerencia de inmediato y sin preguntar nada — lo que permite correrlo sin supervisión.

Todavía puedes pasar una versión explícita para saltarte todo eso: `bun run release 1.9.0`
(`release:cut` es el mismo script, conservado como alias) — pero escribir un número no significa que
se acepte a ciegas. En ambos casos, antes de tocar nada, valida la versión contra el historial real de
lanzamientos — `git tag`, no el campo actual de `package.json`, porque un intento anterior puede dejar
ese archivo ya subido de versión sin haber etiquetado ni publicado nada (justo lo que pasó al
cortar v1.9.0 la primera vez):

- rechaza cualquier cosa que no sea `X.Y.Z`
- rechaza una versión que no sea más nueva que la mayor que reclame cualquier etiqueta existente
- rechaza una versión cuya etiqueta (`vX.Y.Z`) ya exista — sin lanzamientos duplicados
- si lo que escribiste (como argumento, o sustituyendo la sugerencia de la pregunta) no coincide con
  lo que los commits sugieren de verdad — por ejemplo pedir `5.0.0` cuando nada justifica más que un
  salto menor — muestra la diferencia y te pide confirmar que ese número es intencional, en lugar de
  aceptar en silencio cualquier número escrito; en caso contrario (una versión explícita que ya coincide con lo
  esperado) muestra el resumen habitual de versión/etiqueta/publicación y pide confirmar eso

Una vez confirmado: sube la versión de `package.json`, sincroniza el `productVersion` de
`docs/notion-map.json` para que coincida (lo revisa `verify:docs`, así que los dos no pueden volver a
desalinearse en silencio), corre las pruebas y el chequeo de tipos, hace el commit, la etiqueta y el push.

El push de la etiqueta dispara `.github/workflows/release.yml`, que compila y prueba con humo el
binario de cada plataforma en su propio runner nativo de GitHub Actions (incluida una máquina Windows
real) y publica el lanzamiento de GitHub con todos los archivos. Luego el script encuentra esa
ejecución y muestra su progreso en vivo, trabajo por trabajo, en la misma terminal (`gh run watch`) en
lugar de dejarte revisar a mano — y solo informa la URL real del lanzamiento cuando la ejecución
termina bien, o la URL de la ejecución fallida si no. Si `gh` no está instalado o autenticado, vuelve a
imprimir el enlace de la página de Actions — en ese punto la etiqueta ya está subida de cualquier
forma, así que esto no puede hacer fallar el lanzamiento en sí.

`bun run release:bundle` (`scripts/release-bundle.mjs`) también está disponible para compilar todos los
destinos en local, por ejemplo para probar `install.sh`/`install.ps1` contra un archivo local antes de
cortar un lanzamiento real.
