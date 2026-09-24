/**
 * Display names for blocks and items. English names are derived from ids; Spanish names are built
 * by a rule-based translator (noun-first order, gender agreement for colours and materials).
 */
import { getLang } from '../../common/lang/i18n';

const EN_OVERRIDES: Record<string, string> = {
  tnt: 'TNT', flux_dust: 'Flux Dust', void_eye: 'Void Eye', infernium_ingot: 'Infernium Ingot',
};

export function englishName(id: string): string {
  if (EN_OVERRIDES[id]) return EN_OVERRIDES[id]!;
  return id.split('_').map((w) => (w === 'of' || w === 'the' || w === 'on' || w === 'a' ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

// ---- Spanish ----------------------------------------------------------------------------------
type G = 'm' | 'f';
interface Noun { s: string; g: G; pl?: boolean }

/** Nouns (the head of the compound). Keys are id suffixes, longest match wins. */
const NOUNS: Record<string, Noun> = {
  planks: { s: 'tablones', g: 'm', pl: true }, log: { s: 'tronco', g: 'm' }, wood: { s: 'madera', g: 'f' }, leaves: { s: 'hojas', g: 'f', pl: true },
  sapling: { s: 'brote', g: 'm' }, stairs: { s: 'escaleras', g: 'f', pl: true }, slab: { s: 'losa', g: 'f' }, fence: { s: 'valla', g: 'f' },
  fence_gate: { s: 'puerta de valla', g: 'f' }, door: { s: 'puerta', g: 'f' }, trapdoor: { s: 'trampilla', g: 'f' }, button: { s: 'botón', g: 'm' },
  pressure_plate: { s: 'placa de presión', g: 'f' }, sign: { s: 'cartel', g: 'm' }, hanging_sign: { s: 'cartel colgante', g: 'm' },
  wall: { s: 'muro', g: 'm' }, wool: { s: 'lana', g: 'f' }, carpet: { s: 'alfombra', g: 'f' }, concrete: { s: 'hormigón', g: 'm' },
  concrete_powder: { s: 'cemento', g: 'm' }, terracotta: { s: 'terracota', g: 'f' }, glazed_terracotta: { s: 'terracota esmaltada', g: 'f' },
  stained_glass: { s: 'cristal tintado', g: 'm' }, stained_glass_pane: { s: 'panel de cristal tintado', g: 'm' }, glass: { s: 'cristal', g: 'm' },
  glass_pane: { s: 'panel de cristal', g: 'm' }, candle: { s: 'vela', g: 'f' }, bed: { s: 'cama', g: 'f' }, banner: { s: 'estandarte', g: 'm' },
  shell_box: { s: 'caja de concha', g: 'f' }, ore: { s: 'mena', g: 'f' }, block: { s: 'bloque', g: 'm' }, bricks: { s: 'ladrillos', g: 'm', pl: true },
  tiles: { s: 'baldosas', g: 'f', pl: true }, stone: { s: 'piedra', g: 'f' }, sandstone: { s: 'arenisca', g: 'f' }, pillar: { s: 'pilar', g: 'm' },
  coral: { s: 'coral', g: 'm' }, coral_block: { s: 'bloque de coral', g: 'm' }, coral_fan: { s: 'abanico de coral', g: 'm' },
  stem: { s: 'tallo', g: 'm' }, hyphae: { s: 'hifas', g: 'f', pl: true }, nylium: { s: 'nilio', g: 'm' }, fungus: { s: 'hongo', g: 'm' },
  roots: { s: 'raíces', g: 'f', pl: true }, mushroom: { s: 'champiñón', g: 'm' }, mushroom_block: { s: 'bloque de champiñón', g: 'm' },
  head: { s: 'cabeza', g: 'f' }, skull: { s: 'calavera', g: 'f' }, anvil: { s: 'yunque', g: 'm' }, torch: { s: 'antorcha', g: 'f' },
  lantern: { s: 'farol', g: 'm' }, chain: { s: 'cadena', g: 'f' }, bars: { s: 'barrotes', g: 'm', pl: true }, grate: { s: 'rejilla', g: 'f' },
  bulb: { s: 'bombilla', g: 'f' }, chest: { s: 'cofre', g: 'm' }, shelf: { s: 'estante', g: 'm' }, rail: { s: 'raíl', g: 'm' },
  bud: { s: 'brote', g: 'm' }, cluster: { s: 'racimo', g: 'm' }, froglight: { s: 'luz de rana', g: 'f' }, egg: { s: 'huevo', g: 'm' },
  pot: { s: 'maceta', g: 'f' }, cake: { s: 'tarta', g: 'f' }, table: { s: 'mesa', g: 'f' }, cauldron: { s: 'caldero', g: 'm' },
};

const ADJ: Record<string, [string, string, string?, string?]> = {
  // [m, f, mpl, fpl]
  white: ['blanco', 'blanca', 'blancos', 'blancas'], orange: ['naranja', 'naranja', 'naranjas', 'naranjas'], magenta: ['magenta', 'magenta', 'magentas', 'magentas'],
  light_blue: ['azul claro', 'azul claro', 'azules claros', 'azules claras'], yellow: ['amarillo', 'amarilla', 'amarillos', 'amarillas'],
  lime: ['lima', 'lima', 'lima', 'lima'], pink: ['rosa', 'rosa', 'rosas', 'rosas'], gray: ['gris', 'gris', 'grises', 'grises'],
  light_gray: ['gris claro', 'gris claro', 'grises claros', 'grises claras'], cyan: ['cian', 'cian', 'cian', 'cian'],
  purple: ['morado', 'morada', 'morados', 'moradas'], blue: ['azul', 'azul', 'azules', 'azules'], brown: ['marrón', 'marrón', 'marrones', 'marrones'],
  green: ['verde', 'verde', 'verdes', 'verdes'], red: ['rojo', 'roja', 'rojos', 'rojas'], black: ['negro', 'negra', 'negros', 'negras'],
  polished: ['pulido', 'pulida', 'pulidos', 'pulidas'], mossy: ['musgoso', 'musgosa', 'musgosos', 'musgosas'], cracked: ['agrietado', 'agrietada', 'agrietados', 'agrietadas'],
  chiseled: ['cincelado', 'cincelada', 'cincelados', 'cinceladas'], smooth: ['liso', 'lisa', 'lisos', 'lisas'], cut: ['cortado', 'cortada', 'cortados', 'cortadas'],
  stripped: ['descortezado', 'descortezada', 'descortezados', 'descortezadas'], dead: ['muerto', 'muerta', 'muertos', 'muertas'],
  exposed: ['expuesto', 'expuesta', 'expuestos', 'expuestas'], weathered: ['desgastado', 'desgastada', 'desgastados', 'desgastadas'],
  oxidized: ['oxidado', 'oxidada', 'oxidados', 'oxidadas'], waxed: ['encerado', 'encerada', 'encerados', 'enceradas'],
  infested: ['infestado', 'infestada', 'infestados', 'infestadas'], raw: ['en bruto', 'en bruto', 'en bruto', 'en bruto'],
  tinted: ['ahumado', 'ahumada', 'ahumados', 'ahumadas'], powered: ['propulsor', 'propulsora', 'propulsores', 'propulsoras'],
  detector: ['detector', 'detectora', 'detectores', 'detectoras'], activator: ['activador', 'activadora', 'activadores', 'activadoras'],
  sticky: ['pegajoso', 'pegajosa', 'pegajosos', 'pegajosas'], trapped: ['trampa', 'trampa', 'trampa', 'trampa'],
  red_sand: ['roja', 'roja'], chipped: ['astillado', 'astillada'], damaged: ['dañado', 'dañada'], weighted: ['por peso', 'por peso'],
};

/** Materials used as "de X" complements. */
const OF: Record<string, string> = {
  oak: 'roble', spruce: 'abeto', birch: 'abedul', jungle: 'jungla', acacia: 'acacia', dark_oak: 'roble oscuro', mangrove: 'mangle',
  cherry: 'cerezo', pale_oak: 'roble pálido', bamboo: 'bambú', crimson: 'carmesí', warped: 'distorsionado', stone: 'piedra', cobblestone: 'roca',
  mossy_cobblestone: 'roca musgosa', granite: 'granito', diorite: 'diorita', andesite: 'andesita', deepslate: 'pizarra profunda',
  cobbled_deepslate: 'pizarra profunda labrada', tuff: 'toba', brick: 'ladrillo', stone_brick: 'ladrillos de piedra', mud_brick: 'ladrillos de barro',
  sandstone: 'arenisca', red_sandstone: 'arenisca roja', prismarine: 'prismarina', quartz: 'cuarzo', purpur: 'púrpur', verge_stone_brick: 'ladrillos del Confín',
  cinder_brick: 'ladrillos cinéreos', red_cinder_brick: 'ladrillos cinéreos rojos', blackstone: 'piedra negra', polished_blackstone: 'piedra negra pulida',
  polished_blackstone_brick: 'ladrillos de piedra negra pulida', resin_brick: 'ladrillos de resina', copper: 'cobre', iron: 'hierro', gold: 'oro',
  diamond: 'diamante', emerald: 'esmeralda', lapis: 'lapislázuli', coal: 'carbón', flux: 'flujo', infernium: 'infernio', tube: 'tubo',
  brain: 'cerebro', bubble: 'burbuja', fire: 'fuego', horn: 'cuerno', skeleton: 'esqueleto', blight_skeleton: 'esqueleto marchito',
  zombie: 'zombi', player: 'jugador', hisser: 'siseador', dragon: 'dragón', swinekin: 'porcino', amethyst: 'amatista', sea: 'mar',
  soul: 'almas', cut_copper: 'cobre cortado', tuff_brick: 'ladrillos de toba', deepslate_brick: 'ladrillos de pizarra profunda',
  deepslate_tile: 'baldosas de pizarra profunda', polished_deepslate: 'pizarra profunda pulida', polished_tuff: 'toba pulida',
  polished_granite: 'granito pulido', polished_diorite: 'diorita pulida', polished_andesite: 'andesita pulida', smooth_stone: 'piedra lisa',
  smooth_sandstone: 'arenisca lisa', smooth_red_sandstone: 'arenisca roja lisa', smooth_quartz: 'cuarzo liso', cut_sandstone: 'arenisca cortada',
  cut_red_sandstone: 'arenisca roja cortada', dark_prismarine: 'prismarina oscura', prismarine_brick: 'ladrillos de prismarina',
  bamboo_mosaic: 'mosaico de bambú', mossy_stone_brick: 'ladrillos de piedra musgosos', red_mushroom: 'champiñón rojo', brown_mushroom: 'champiñón marrón',
  cinder: 'cinérea', verge: 'Confín', light: 'ligera', heavy: 'pesada', raw_iron: 'hierro en bruto', raw_copper: 'cobre en bruto', raw_gold: 'oro en bruto',
};

const EXACT_ES: Record<string, string> = {
  air: 'Aire', stone: 'Piedra', granite: 'Granito', diorite: 'Diorita', andesite: 'Andesita', deepslate: 'Pizarra profunda', cobblestone: 'Roca',
  dirt: 'Tierra', coarse_dirt: 'Tierra estéril', rooted_dirt: 'Tierra enraizada', grass_block: 'Bloque de césped', podzol: 'Podsol', mycelium: 'Micelio',
  mud: 'Barro', packed_mud: 'Barro compacto', clay: 'Arcilla', gravel: 'Grava', sand: 'Arena', red_sand: 'Arena roja', snow: 'Nieve',
  snow_block: 'Bloque de nieve', ice: 'Hielo', packed_ice: 'Hielo compacto', blue_ice: 'Hielo azul', bedrock: 'Lecho de roca', obsidian: 'Obsidiana',
  crying_obsidian: 'Obsidiana llorona', water: 'Agua', lava: 'Lava', glowstone: 'Piedra luminosa', cinderrack: 'Roca cinérea', soul_sand: 'Arena de almas',
  soul_soil: 'Tierra de almas', magma_block: 'Bloque de magma', tnt: 'Dinamita', bookshelf: 'Librería', crafting_table: 'Mesa de trabajo',
  furnace: 'Horno', blast_furnace: 'Alto horno', smoker: 'Ahumador', chest: 'Cofre', barrel: 'Barril', torch: 'Antorcha', ladder: 'Escalera de mano',
  cactus: 'Cactus', sugar_cane: 'Caña de azúcar', pumpkin: 'Calabaza', melon: 'Sandía', short_grass: 'Hierba', tall_grass: 'Hierba alta', fern: 'Helecho',
  large_fern: 'Helecho grande', dead_bush: 'Arbusto muerto', dandelion: 'Diente de león', poppy: 'Amapola', calcite: 'Calcita', tuff: 'Toba',
  dripstone_block: 'Bloque de espeleotema', pointed_dripstone: 'Espeleotema puntiagudo', moss_block: 'Bloque de musgo', sponge: 'Esponja',
  wet_sponge: 'Esponja mojada', flux_lamp: 'Lámpara de flujo', flux_torch: 'Antorcha de flujo', repeater: 'Repetidor', comparator: 'Comparador',
  piston: 'Pistón', sticky_piston: 'Pistón pegajoso', observer: 'Observador', hopper: 'Tolva', dispenser: 'Dispensador', dropper: 'Soltador',
  lever: 'Palanca', note_block: 'Bloque musical', jukebox: 'Tocadiscos', beacon: 'Faro', anvil: 'Yunque', enchanting_table: 'Mesa de encantamientos',
  brewing_stand: 'Soporte para pociones', cauldron: 'Caldero', grindstone: 'Afiladora', loom: 'Telar', stonecutter: 'Cortapiedras',
  composter: 'Compostera', lectern: 'Atril', bell: 'Campana', campfire: 'Fogata', soul_campfire: 'Fogata de almas', lodestone: 'Magnetita',
  respawn_anchor: 'Nexo de reaparición', scaffolding: 'Andamio', slime_block: 'Bloque de slime', honey_block: 'Bloque de miel',
  target: 'Diana', daylight_detector: 'Sensor de luz solar', tripwire_hook: 'Gancho de cuerda trampa', crafter: 'Fabricador', lantern: 'Farol',
  soul_lantern: 'Farol de almas', soul_torch: 'Antorcha de almas', echo_moss: 'Musgo de eco', echo_sensor: 'Sensor de eco', echo_shrieker: 'Chillador de eco',
  echo_catalyst: 'Catalizador de eco', echo_vein: 'Vena de eco', verge_stone: 'Piedra del Confín', verge_rod: 'Vara del Confín', dragon_egg: 'Huevo de dragón',
  glowcap: 'Brillohongo', ancient_debris: 'Restos ancestrales', spawner: 'Generador de criaturas', hay_block: 'Fardo de heno', bone_block: 'Bloque de hueso',
  glow_lichen: 'Liquen luminoso', vine: 'Enredadera', lily_pad: 'Nenúfar', kelp: 'Alga', seagrass: 'Pasto marino', sea_pickle: 'Pepino de mar',
  bamboo: 'Bambú', cake: 'Tarta', flower_pot: 'Maceta', iron_bars: 'Barrotes de hierro', chain: 'Cadena', heavy_core: 'Núcleo denso',
  trial_spawner: 'Generador de desafío', vault: 'Bóveda', decorated_pot: 'Vasija decorada', chiseled_bookshelf: 'Librería cincelada',
  sea_lantern: 'Linterna marina', prismarine: 'Prismarina', purpur_block: 'Bloque de púrpur', quartz_block: 'Bloque de cuarzo',
  jack_o_lantern: 'Calabaza iluminada', carved_pumpkin: 'Calabaza tallada', farmland: 'Tierra de cultivo', dirt_path: 'Camino de tierra',
  powder_snow: 'Nieve en polvo', frogspawn: 'Huevas de rana', resin_block: 'Bloque de resina', creaking_heart: 'Corazón crujidor',
};

export function spanishName(id: string): string {
  if (EXACT_ES[id]) return EXACT_ES[id]!;
  const parts = id.split('_');
  // find the longest noun suffix
  let noun: Noun | null = null;
  let nounLen = 0;
  for (let n = Math.min(4, parts.length); n >= 1; n--) {
    const key = parts.slice(parts.length - n).join('_');
    if (NOUNS[key]) { noun = NOUNS[key]!; nounLen = n; break; }
  }
  if (!noun) return capitalize(englishName(id));
  const rest = parts.slice(0, parts.length - nounLen);
  const adjs: string[] = [];
  const ofParts: string[] = [];
  // leading adjectives (colours, states)
  let i = 0;
  while (i < rest.length) {
    const two = rest.slice(i, i + 2).join('_');
    if (ADJ[two]) { adjs.push(adjForm(ADJ[two]!, noun)); i += 2; continue; }
    const one = rest[i]!;
    if (ADJ[one]) { adjs.push(adjForm(ADJ[one]!, noun)); i++; continue; }
    break;
  }
  const matKey = rest.slice(i).join('_');
  if (matKey) ofParts.push(OF[matKey] ?? matKey.replace(/_/g, ' '));
  let s = noun.s;
  if (ofParts.length) s += ' de ' + ofParts.join(' ');
  if (adjs.length) s += ' ' + adjs.join(' ');
  return capitalize(s);
}

function adjForm(a: [string, string, string?, string?], n: Noun): string {
  if (n.pl) return n.g === 'm' ? a[2] ?? a[0] : a[3] ?? a[1];
  return n.g === 'm' ? a[0] : a[1];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const extraNames: Record<'es' | 'en', Record<string, string>> = { es: {}, en: {} };

/** Explicit names registered by item/entity definitions. */
export function registerNames(es: Record<string, string>, en: Record<string, string>): void {
  Object.assign(extraNames.es, es);
  Object.assign(extraNames.en, en);
}

export function itemName(id: string): string {
  const lang = getLang();
  const explicit = extraNames[lang][id];
  if (explicit) return explicit;
  return lang === 'es' ? spanishName(id) : englishName(id);
}
