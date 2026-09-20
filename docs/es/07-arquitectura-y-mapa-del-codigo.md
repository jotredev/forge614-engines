# 07. Arquitectura y mapa del código

## La analogía: una oficina de recepción con áreas separadas

La interfaz recibe una petición; el área de coordinación decide el trabajo; las herramientas especializadas hablan con archivos y el sistema; y las reglas básicas describen lo que existe. Separar esas áreas evita que un botón de terminal conozca detalles privados de un archivo de configuración.

## Capas

| Carpeta | Responsabilidad | Ejemplos |
| --- | --- | --- |
| `src/modules/` | conceptos y reglas estables | `agents/types.ts`, `config-writer/decide.ts` |
| `src/infrastructure/` | sistema operativo, archivos y formatos | detección, JSON, TOML, planes y copias |
| `src/app/` | casos de uso | detectar, planear, aplicar, capacidades, actualización |
| `src/interfaces/cli/` | contrato visible | análisis de argumentos y respuesta JSON |

Una prueba de arquitectura revisa importaciones relativas. Una capa interna no puede importar una capa exterior: `modules` no conoce infraestructura, y la infraestructura no conoce la interfaz CLI. Esta dirección mantiene las decisiones reutilizables y testeables.

## Piezas principales

- `AgentRegistry` registra adaptadores y valida sus promesas de capacidad.
- Los adaptadores de `infrastructure/agents/` traducen cada agente a rutas, formato y órdenes seguras.
- `detect-agent.ts` combina búsqueda en PATH, rutas conocidas y presencia de la carpeta de configuración.
- `config-io/` lee y modifica JSON/TOML; JSON conserva ediciones mediante `jsonc-parser` y TOML vuelve a serializar el documento mediante `smol-toml`.
- `plan-store.ts` persiste propuestas con permisos privados; `snapshot.ts` respalda archivos; `atomic-write.ts` realiza escrituras verificadas.
- `main.ts` acepta solo los comandos públicos y convierte errores a códigos estables.

## Pruebas y mantenimiento

Las pruebas viven junto a la unidad que protegen. `src/smoke.test.ts` comprueba el recorrido completo; `tests/architecture/` protege las fronteras. Ejecuta:

```text
bun test
bun run typecheck
bun run verify:docs
```

Cuando cambie un contrato público, actualiza la página ES/EN correspondiente, el espejo de Notion, `notion-map.json` y sus huellas. No cambies esta documentación para describir una intención futura como si ya fuera comportamiento actual.
