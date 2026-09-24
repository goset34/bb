# STRATA — Hitos

Cada hito deja el proyecto compilando (`npm run typecheck`), con los tests en verde (`npm test`,
`npm run test:e2e`) y jugable con `npm run dev`.

| Hito | Estado | Contenido |
|---|---|---|
| H1 | ✅ | Motor: RHI WebGPU + WebGL2, chunks, mallado, cámara, física, servidor integrado |
| H2 | ⏳ | Generación del mundo y biomas (+ WASM) |
| H3 | ⏳ | Jugador, inventario, crafteo, supervivencia |
| H4 | ⏳ | Criaturas e IA |
| H5 | ⏳ | Redstone, fluidos y bloques funcionales |
| H6 | ⏳ | Ínfero y estructuras |
| H7 | ⏳ | El Confín, dragón, créditos y poema final |
| H8 | ⏳ | Aldeanos, comercio, asaltos, encantamientos, pociones |
| H9 | ⏳ | Gráficos ultra y audio |
| H10 | ⏳ | Multijugador, pulido, pruebas y auditoría de contenido |

## H1 — Motor

**Criterio de aceptación:** caminar por un mundo generado, romper y colocar bloques; los dos
backends gráficos producen la misma imagen.

Incluye:

- **Registro de bloques** con ~1150 bloques y ~29 000 estados contiguos (paleta de propiedades,
  tablas planas de flags/luz/opacidad/forma), comportamientos de colocación (escaleras, vallas,
  muros, puertas, trampillas, camas, cofres dobles, antorchas, faroles, plantas con soporte…) y
  actualizaciones de forma/vecinos con orden de referencia.
- **Chunks** 16×384×16 (Y −64…320) en secciones 16³ con paleta (uniforme / 8 bits / 16 bits),
  luz cielo+bloque por BFS, biomas 4×4×4, mapas de altura y entidades de bloque.
- **Servidor integrado** en un Web Worker a 20 TPS: tickets de carga, pipeline de generación
  (ruido en workers → decoración 3×3 → luz → completo), ticks programados y aleatorios, eventos de
  bloque, tiempo y clima, guardado en regiones tipo Anvil en IndexedDB con deflate y autoguardado.
- **Protocolo binario** común para Worker, WebSocket y WebRTC; movimiento autoritativo en el
  servidor con predicción y reconciliación por número de secuencia en el cliente.
- **Física** tipo referencia (colisión con escalón, gravedad/arrastre, fricción por bloque, agua y
  lava, escaleras de mano, vuelo, élitros, borde al agacharse, telarañas, nieve polvo, columnas de
  burbujas, miel).
- **Mallado** en workers: caras voraces con AO por vértice y luz suave, modelos no cúbicos,
  líquidos con alturas por esquina, grafo de visibilidad para *cave culling*.
- **Render** con RHI propio (WebGPU con *fallback* automático a WebGL2): pipelines sólido/recorte/
  translúcido, cielo con sol/luna/estrellas, niebla, contorno de selección, *frustum* + *cave
  culling*, texturas procedurales 16×16 con normal y material en arrays de texturas (empaquetadas
  en páginas cuando el dispositivo limita las capas).
- **Interfaz**: menú principal, selección/creación de mundos, carga, pausa, opciones, HUD con
  hotbar, chat con sugerencias de comandos y pantalla de depuración F3; español e inglés.
- **Pruebas**: Vitest (matemática determinista, registro, secciones, E/S de chunks y regiones,
  ZIP, protocolo, mallador, empaquetado del atlas, física) y Playwright (arranque y render con
  WebGL2 y WebGPU).

## H2 — Generación del mundo y biomas

Ruido climático multiparámetro (temperatura, humedad, continentalidad, erosión, rareza,
profundidad), *splines* de densidad, cuevas queso/espagueti/fideo, acuíferos, túneles y
barrancos, menas con distribución por altura, árboles y vegetación por bioma, todos los biomas
del Mundo Superior, tipos de mundo (normal, plano, amplificado, grandes biomas, un solo bioma) y
núcleo de ruido/mallado en Rust→WASM (SIMD) con pruebas de paridad.

## H3 — Jugador, inventario, crafteo, supervivencia

Objetos, herramientas y armaduras, inventario y contenedores, mesa de crafteo y libro de recetas,
hornos (normal, alto, ahumador), salud, hambre, experiencia, daño, muerte y reaparición, drops y
tablas de botín, modos de juego y sistema de comandos.

## H4 — Criaturas e IA

ECS de mobs con metas de IA, *pathfinding*, generación natural, animales (cría, domesticación),
hostiles, neutrales, acuáticos, animaciones procedurales, sonidos y drops.

## H5 — Redstone, fluidos y bloques funcionales

Polvo, antorchas, repetidores, comparadores, observadores, pistones (incluido BUD/QC), tolvas,
dispensadores, soltadores, raíles, fluidos con flujo y mezcla, y el resto de bloques funcionales.

## H6 — Ínfero y estructuras

Dimensión Ínfero con sus biomas y portal; estructuras del Mundo Superior y del Ínfero con botín.

## H7 — El Confín, dragón y final

Ojos del vacío, fortalezas, portal del Confín, Dragón del Confín con fases, portales de salida,
ciudades del Confín, créditos y poema final original con música; logros y estadísticas.

## H8 — Aldeanos, comercio, asaltos, encantamientos, pociones

Profesiones y comercio, reputación, aldeas vivas, patrullas y asaltos, mesa de encantamientos,
yunque, afilador, soporte para pociones y efectos de estado.

## H9 — Gráficos ultra y audio

Preajustes Bajo → Sin límites: sombras en cascada, GI, reflejos, agua realista, nubes
volumétricas, PBR, posprocesado; audio procedural con HRTF, reverberación y música generativa.

## H10 — Multijugador, pulido y auditoría

Servidor dedicado Node (WebSocket) y P2P WebRTC, compensación de latencia, mando y controles
táctiles, perfilado, pruebas ampliadas y auditoría de contenido frente a la referencia
(`docs/AUDIT.md`).
