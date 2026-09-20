# 00. Forge614 Engines: resumen y guía rápida

## La analogía: el inspector del taller

Imagina un taller donde hay varias máquinas de IA. Forge614 Engines es el inspector que mira cuáles máquinas realmente están disponibles, dónde guardan sus ajustes y qué trabajo pueden hacer. No toma las decisiones del dueño del taller ni cambia una máquina por sorpresa: prepara una ficha clara para que Forge614 Shell la muestre y una persona la apruebe.

## Qué resuelve

Los agentes de programación con IA no se instalan ni se configuran igual. Engines unifica tres preguntas: “¿está instalado?”, “¿dónde está su configuración?” y “¿puede conectarse a un servidor MCP o trabajar sin pantalla?”. MCP (un protocolo, o forma acordada, para conectar una IA con otra herramienta) permite añadir servicios como memoria, búsqueda o datos.

Actualmente reconoce Claude Code, Codex y Cursor. Devuelve JSON (texto estructurado y legible por programas) con `schemaVersion: 1`, para que Shell y Atlas puedan entender el resultado sin leer carpetas privadas entre productos.

## Ruta rápida

Engines es una dependencia interna. Shell lo instala bajo `~/.forge614/engines/`; no se añade al PATH (la lista de comandos que una terminal encuentra por nombre). Los productos consumidores llaman su binario por ruta conocida:

```text
~/.forge614/engines/bin/forge614-engines detect
```

El resultado describe cada agente, por ejemplo su identificador, nombre visible, si se encontró un ejecutable y si existe su carpeta de ajustes. El siguiente paso normal es Shell: muestra las opciones, prepara un cambio y pide confirmación.

## Lo que no hace

- No ofrece una interfaz visual ni un chat.
- No instala Engines directamente para una persona.
- No decide qué servidor MCP usar.
- No escribe una configuración al calcular un plan.
- No sustituye las credenciales ni perfiles propios de Claude Code, Codex o Cursor.

## Dónde seguir

Lee [01](01-instalacion-interna-y-limites.md) para conocer sus límites, [02](02-deteccion-de-agentes-y-capacidades.md) para la detección y [05](05-referencia-del-cli-publico.md) para todos los contratos de línea de comandos.
