# STRATA

Sandbox de vóxeles para navegador escrito en TypeScript estricto, con renderizado WebGPU y
*fallback* automático a WebGL2. Todas las texturas, sonidos, textos y nombres se generan de forma
procedural o se han creado desde cero (ver [docs/GLOSSARY.md](docs/GLOSSARY.md)).

## Requisitos

- Node.js 20 o superior
- Un navegador con WebGPU (Chrome/Edge 113+) o WebGL2 (cualquier navegador moderno)

## Ejecutar

```bash
npm install
npm run dev          # http://localhost:5173
```

Compilación estática (carpeta `dist/`, servible desde cualquier hosting estático):

```bash
npm run build
npm run preview
```

Forzar un backend gráfico: `http://localhost:5173/?gfx=webgl2` o `?gfx=webgpu`.

## Controles

| Acción | Tecla |
|---|---|
| Moverse | W A S D |
| Saltar / nadar hacia arriba | Espacio |
| Agacharse | Mayús izq. |
| Correr | Ctrl izq. o doble W |
| Romper / usar | Clic izquierdo / derecho |
| Elegir bloque (creativo) | Clic central |
| Barra rápida | 1–9, rueda del ratón |
| Chat / comando | T, / |
| Cambiar cámara | F5 |
| Depuración | F3 |
| Pausa | Esc |

## Pruebas

```bash
npm run typecheck    # tsc --noEmit
npm test             # Vitest (unitarias)
npm run test:e2e     # Playwright (arranque y render con WebGL2 y WebGPU)
```

Las pruebas E2E usan Chromium con SwiftShader, por lo que funcionan sin GPU. Si tu Chromium de
Playwright está en otra ruta, defínela con `STRATA_CHROMIUM=/ruta/a/chrome`.

Capturas de pantalla automáticas (con `npm run dev` en marcha):

```bash
npm run shot -- webgpu captura.png debug_simple 4000
```

## Núcleo nativo (opcional)

El ruido de generación tiene un núcleo en Rust compilado a WebAssembly con SIMD. El binario ya
está incluido en `src/native/strata.wasm`; para recompilarlo:

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

Si el navegador no admite WebAssembly SIMD, el juego usa la implementación TypeScript, que da
exactamente el mismo mundo.

Herramientas de generación:

```bash
npm run map -- <semilla> mapa.png          # mapa de biomas/alturas
npm run genview -- <semilla> /tmp/vista 6  # vista cenital y corte vertical reales
```

## Documentación

- [docs/DESIGN.md](docs/DESIGN.md) — arquitectura, hilos, flujo de datos y formato de guardado
- [docs/MILESTONES.md](docs/MILESTONES.md) — plan y estado por hitos
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — nombres originales del juego

## Estructura

```
src/common   lógica compartida (matemática, bloques, mundo, entidades, red, generación, idiomas)
src/server   servidor autoritativo (chunks, ticks, jugadores, guardado)
src/client   cliente (render, entrada, interfaz, predicción)
src/workers  workers de servidor, generación y mallado
tests        unitarias (Vitest) y E2E (Playwright)
```
