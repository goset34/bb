/**
 * Item sprites (16×16), painted procedurally from STRATA's own pixel masks and parametric
 * shapes. Resolved by item id; used for inventory icons and for dropped/held items.
 */
import { Painter, RGB, RGBA, hex, mix, shade } from './painter';
import { DYE } from './blocktex';

// ---------------------------------------------------------------------------------------------
// Masks. Legend: '.' empty · o outline · d dark · m mid · l light · w highlight (material colour)
//                k handle dark · h handle · a/b/c/x/y accent colours given per recipe.
// ---------------------------------------------------------------------------------------------
const M: Record<string, string[]> = {
  sword: [
    '..............oo',
    '.............owo',
    '............owlo',
    '...........owlo.',
    '..........owlo..',
    '.........owlo...',
    '........owlo....',
    '..oo...owlo.....',
    '..odo.owlo......',
    '...odowlo.......',
    '....odlo........',
    '...khodo........',
    '..khk.odo.......',
    '.khk...oo.......',
    'okk.............',
    'oo..............',
  ],
  pickaxe: [
    '....oooooo......',
    '...owllllmo.....',
    '....oddddlmo....',
    '.........okdmo..',
    '........okhodmo.',
    '.......okho.odmo',
    '......okho...olo',
    '.....okho....olo',
    '....okho......oo',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okho............',
    'oko.............',
    '.o..............',
    '................',
  ],
  axe: [
    '.......oo.......',
    '......owlo......',
    '.....owllmo.....',
    '....owlllmoo....',
    '....omllmokho...',
    '....oddmokho....',
    '.....oddkho.....',
    '......okho......',
    '.....okho.......',
    '....okho........',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okho............',
    'oko.............',
    '.o..............',
  ],
  shovel: [
    '............ooo.',
    '...........owlmo',
    '..........owllmo',
    '..........olldmo',
    '.........okomdo.',
    '........okho.o..',
    '.......okho.....',
    '......okho......',
    '.....okho.......',
    '....okho........',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okho............',
    'oko.............',
    '.o..............',
  ],
  hoe: [
    '.......oooo.....',
    '......owllmo....',
    '.......oodmko...',
    '..........okho..',
    '.........okho...',
    '........okho....',
    '.......okho.....',
    '......okho......',
    '.....okho.......',
    '....okho........',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okho............',
    'oko.............',
    '.o..............',
  ],
  helmet: [
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...owllllllmo...',
    '..owllmmmmmmdo..',
    '..olmmddddddmo..',
    '..omdo....odmo..',
    '..omdo....odmo..',
    '..oddo....oddo..',
    '..oooo....oooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '..ooo......ooo..',
    '.owlmo....owlmo.',
    '.olmmooooooommo.',
    '.ommmlllllmmmdo.',
    '..oommlllmmmoo..',
    '....omllmmmo....',
    '....omlmmmdo....',
    '....omlmmmdo....',
    '....ommmmmdo....',
    '....ommmmddo....',
    '....ommmmddo....',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '....oooooooo....',
    '....owlllmmo....',
    '....olmmmmdo....',
    '....olmoomdo....',
    '....olmoomdo....',
    '....olmoomdo....',
    '....olmoomdo....',
    '....olmoomdo....',
    '....olmoomdo....',
    '....oddooddo....',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...ooo....ooo...',
    '...olo....olo...',
    '...olo....olo...',
    '...olo....olo...',
    '..oolo....oloo..',
    '.owlmo....omlwo.',
    '.olmdo....odmlo.',
    '.ooooo....ooooo.',
    '................',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......oooooo...',
    '.....oowwllllo..',
    '...oowllllmmdo..',
    '..owllllmmmddo..',
    '..olmmmmmddoo...',
    '..oddddddoo.....',
    '..oooooooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  nugget: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '.....oowlmo.....',
    '....owllmmdo....',
    '....olmmmddo....',
    '.....odddoo.....',
    '......ooo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  raw: [
    '................',
    '................',
    '................',
    '......ooo.......',
    '....oowlmoo.....',
    '...owlmmmddo....',
    '..owlmdmmmdoo...',
    '..olmmmmdmmddo..',
    '..omdmmmmmmddo..',
    '..oodmmdmmddo...',
    '...oddddmddo....',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....owwllmmo....',
    '...owllllmmdo...',
    '..owllllmmmddo..',
    '..olllmmmmmddo..',
    '...ollmmmmddo...',
    '....olmmmddo....',
    '.....olmddo.....',
    '......omdo......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ],
  lump: [
    '................',
    '................',
    '................',
    '................',
    '.....oooo.......',
    '...oowlmmoo.....',
    '..owlmmmmddo....',
    '..olmmdmmmddo...',
    '.olmmmmmdmmdo...',
    '.ommdmmmmmddo...',
    '..oddmmmdddo....',
    '...ooddddoo.....',
    '.....oooo.......',
    '................',
    '................',
    '................',
  ],
  shard: [
    '................',
    '................',
    '...........oo...',
    '..........owo...',
    '.........owlo...',
    '........owlmo...',
    '.......owlmo....',
    '......owlmdo....',
    '.....owlmdo.....',
    '....owlmdo......',
    '...olmmdo.......',
    '...omddo........',
    '...oooo.........',
    '................',
    '................',
    '................',
  ],
  rod: [
    '................',
    '............oo..',
    '...........owo..',
    '..........owmo..',
    '.........owmo...',
    '........olmo....',
    '.......olmo.....',
    '......olmo......',
    '.....olmo.......',
    '....olmo........',
    '...olmo.........',
    '..odmo..........',
    '..odo...........',
    '..oo............',
    '................',
    '................',
  ],
  dust: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.........l......',
    '......l.....m...',
    '....m..lm.l.....',
    '...l.mlmmld.m...',
    '..m.lmmmmmdl....',
    '...mlmmmmmmd.d..',
    '..dmmmmmmmmdd...',
    '.d.dmmmdmdmd.d..',
    '...d.d.d.d.d....',
    '................',
    '................',
  ],
  ball: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oowwlmoo....',
    '...owwllmmmdo...',
    '...owllmmmmdo...',
    '..olllmmmmmddo..',
    '..olmmmmmmmddo..',
    '...ommmmmmddo...',
    '...oddmmmdddo...',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
  ],
  bottle: [
    '................',
    '......oooo......',
    '......ohho......',
    '.......oo.......',
    '......owao......',
    '.....owaaao.....',
    '....owaaaaao....',
    '...owbbbbbbao...',
    '...owbbbbbbbo...',
    '...olbbbbbbbo...',
    '...olbbbbbbbo...',
    '...oabbbbbbao...',
    '....oabbbbao....',
    '.....oooooo.....',
    '................',
    '................',
  ],
  bucket: [
    '................',
    '................',
    '.....oooooo.....',
    '....o......o....',
    '...o........o...',
    '...owbbbbbbmo...',
    '...olbbbbbbdo...',
    '...olmmmmmmdo...',
    '...olmmmmmmdo...',
    '....olmmmmdo....',
    '....olmmmmdo....',
    '....olmmmmdo....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
  bowl: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..obbbbbbbbbbo..',
    '..ohbbbbbbbbho..',
    '...ohhhhhhhho...',
    '....ohhhhhko....',
    '.....okkkko.....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  disc: [
    '................',
    '................',
    '....oooooooo....',
    '...oxxxxxxxxo...',
    '..oxxyyxxxxxxo..',
    '..oxyxxxxxxxxo..',
    '..oxxxxaaxxxxo..',
    '..oxxxaaaaxxxo..',
    '..oxxxaaaaxxxo..',
    '..oxxxxaaxxxxo..',
    '..oxxxxxxxxyxo..',
    '..oxxxxxxxyyxo..',
    '...oxxxxxxxxo...',
    '....oooooooo....',
    '................',
    '................',
  ],
  book: [
    '................',
    '................',
    '...ooooooooo....',
    '..oaaaaaaaaao...',
    '..oabbbbbbbaso..',
    '..oabaaaaabaso..',
    '..oabbbbbbbaso..',
    '..oaaaaaaaaaso..',
    '..oaaaaaaaaaso..',
    '..oaaaaaaaaaso..',
    '..oaaaaaaaaaso..',
    '..oaaaaaaaaaso..',
    '..oaaaaaaaaaso..',
    '..odddddddddoo..',
    '...ooooooooo....',
    '................',
  ],
  paper: [
    '................',
    '................',
    '....oooooooo....',
    '....owwwwwwo....',
    '...owwwwwwwlo...',
    '...owllllllwo...',
    '...owwwwwwwwo...',
    '..owllllllllo...',
    '..owwwwwwwwwo...',
    '..owllllllwwo...',
    '..owwwwwwwwo....',
    '..owwwwwwwwo....',
    '..oooooooooo....',
    '................',
    '................',
    '................',
  ],
  seeds: [
    '................',
    '................',
    '................',
    '................',
    '.........mo.....',
    '.....om...md....',
    '....omd.......m.',
    '.........om..md.',
    '...md...omd.....',
    '..omd...........',
    '.......md..om...',
    '.....omd..omd...',
    '................',
    '...om...........',
    '..omd...........',
    '................',
  ],
  blob: [
    '................',
    '................',
    '................',
    '.....ooooo......',
    '...oowwlmmoo....',
    '..owlllmmmmdo...',
    '..olmmmmmmmddo..',
    '..ommmmmmmmmdo..',
    '..ommmmmmmmddo..',
    '...omdmmmmddo...',
    '...oddmmdddoo...',
    '....ooddddo.....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  feather: [
    '................',
    '..........ooo...',
    '.........owwlo..',
    '........owwllo..',
    '.......owwlllo..',
    '......owwllldo..',
    '.....owwlllddo..',
    '....owwllldddo..',
    '...owwlllddoo...',
    '...owllddoo.....',
    '..owdddoo.......',
    '..okoo..........',
    '.oko............',
    'oko.............',
    'oo..............',
    '................',
  ],
  bone: [
    '................',
    '..........oo....',
    '.........owwoo..',
    '..........owwlo.',
    '.........owllo..',
    '........owlo....',
    '.......owlo.....',
    '......owlo......',
    '.....owlo.......',
    '....owlo........',
    '..oowlo.........',
    '.owlldo.........',
    '..odo.o.........',
    '..oo............',
    '................',
    '................',
  ],
  string: [
    '................',
    '................',
    '..........oo....',
    '.........owwo...',
    '........owo.o...',
    '.......owo..o...',
    '......owo..ow...',
    '.....owo..ow....',
    '....owo..owo....',
    '...owo..owo.....',
    '..owo..owo......',
    '..oo..owo.......',
    '.....owo........',
    '.....oo.........',
    '................',
    '................',
  ],
  hide: [
    '................',
    '................',
    '...oo......oo...',
    '..owlo....olmo..',
    '..olmoooooommo..',
    '...olmmmmmmmdo..',
    '...ommlmmmmmdo..',
    '....ommmmmmdo...',
    '....ommmmmmdo...',
    '...ommmmmmmmdo..',
    '...olmmmmmmmdo..',
    '..oomdo..odmoo..',
    '..ooo......ooo..',
    '................',
    '................',
    '................',
  ],
  meat: [
    '................',
    '................',
    '................',
    '.....ooooo......',
    '...oollllloo....',
    '..olwlmmmmmdo...',
    '..olmmmmmmmmdo..',
    '..olmmdmmmmmdo..',
    '..ommmmmmdmmdo..',
    '...ommmmmmmmmdo.',
    '...oommmmmmddoao',
    '.....oommdddoaao',
    '.......ooooaaao.',
    '............ooo.',
    '................',
    '................',
  ],
  fish: [
    '................',
    '................',
    '................',
    '................',
    '.........ooo....',
    '..oo...oolllo...',
    '.olmo.olwllmmo..',
    '.ommmoolmmmmmmo.',
    '..ommmmmmmmmxmo.',
    '.ommmodmmmmmmmo.',
    '.odmo.oddmmmmo..',
    '..oo...ooddoo...',
    '.........oo.....',
    '................',
    '................',
    '................',
  ],
  apple: [
    '................',
    '.......ok.......',
    '......okaa......',
    '.....ooko.......',
    '...oollmloo.....',
    '..owlmmmmmmdo...',
    '..olmmmmmmmdo...',
    '.olmmmmmmmmmdo..',
    '.ommmmmmmmmmdo..',
    '.ommmmmmmmmmdo..',
    '..ommmmmmmmddo..',
    '..oddmmmmmddo...',
    '...ooddddddo....',
    '.....oooooo.....',
    '................',
    '................',
  ],
  carrot: [
    '................',
    '...........aa...',
    '.........aaba...',
    '..........ab.aa.',
    '.........oob....',
    '........olmo....',
    '.......olmdo....',
    '......olmmdo....',
    '.....olmmdo.....',
    '....olmmdo......',
    '...olmmdo.......',
    '..olmddo........',
    '..omdo..........',
    '..oo............',
    '................',
    '................',
  ],
  potato: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oowllmoo....',
    '...owllmmdmmo...',
    '..olmmmmmmmmdo..',
    '..omdmmmmmdmdo..',
    '..ommmmmmmmmdo..',
    '...oddmmmmddo...',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  bread: [
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '..oowlwlwlwloo..',
    '.owllmlmlmlmmdo.',
    '.olmmmmmmmmmmdo.',
    '.ommmmmmmmmmmdo.',
    '.oddmmmmmmmmddo.',
    '..oodddddddoo...',
    '....oooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  cookie: [
    '................',
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....olmmmmmo....',
    '...olmammmmdo...',
    '...ommmmmammo...',
    '...omammmmmdo...',
    '...ommmmammdo...',
    '....odmmmmdo....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  slice: [
    '................',
    '................',
    '................',
    '................',
    '..oo............',
    '..oaoo..........',
    '..oaaaoo........',
    '..obmmaaoo......',
    '..obmxmmaaoo....',
    '..obmmmmxmaaoo..',
    '..obmxmmmmmmaoo.',
    '..obbbbbbbbbbbo.',
    '..ooooooooooooo.',
    '................',
    '................',
    '................',
  ],
  berries: [
    '................',
    '................',
    '......aa........',
    '.....a..aa......',
    '....a.....a.....',
    '...oo......oo...',
    '..owlo....owlo..',
    '..ommo.oo.ommo..',
    '...oo.owlo.oo...',
    '......ommo......',
    '....oo.oo.oo....',
    '...owlo..owlo...',
    '...ommo..ommo...',
    '....oo....oo....',
    '................',
    '................',
  ],
  pie: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '..oowlwlwlwloo..',
    '.owlmmmmmmmmmdo.',
    '.oaaaaaaaaaaaao.',
    '.obbbbbbbbbbbbo.',
    '..oddddddddddo..',
    '...oooooooooo...',
    '................',
    '................',
    '................',
    '................',
  ],
  kelp: [
    '................',
    '................',
    '....oooooo......',
    '...olmdlmdo.....',
    '..olmdlmddlo....',
    '..omdlmddlmdo...',
    '...odlmddlmdo...',
    '....olmddlmddo..',
    '.....omddlmddo..',
    '......odlmddo...',
    '.......odddo....',
    '........ooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  arrow: [
    '................',
    '...........ooo..',
    '..........owlo..',
    '.........owmo...',
    '........okkoo...',
    '.......okko.....',
    '......okko......',
    '.....okko.......',
    '....okko........',
    '...okko.........',
    '.aoko...........',
    '.aaoo...........',
    'aaba............',
    '.ab.............',
    '................',
    '................',
  ],
  bow: [
    '................',
    '.........oooo...',
    '.......oohhko...',
    '......ohko.os...',
    '.....ohko..os...',
    '....ohko...os...',
    '...ohko....os...',
    '...ohko...os....',
    '..ohko...os.....',
    '..ohko..os......',
    '..ohko.os.......',
    '..ohkoos........',
    '..ohkos.........',
    '...oos..........',
    '................',
    '................',
  ],
  shield: [
    '................',
    '..oooooooooooo..',
    '..ohhhhhhhhhko..',
    '..ohmmmmmmmmko..',
    '..ohmhhhhhhmko..',
    '..ohmhhhhhhmko..',
    '..ohmhhhhhhmko..',
    '..ohmhhhhhhmko..',
    '..ohmhhhhhhmko..',
    '...ohmhhhhmko...',
    '...ohmmmmmmko...',
    '....ohhhhhko....',
    '.....okkkko.....',
    '......oooo......',
    '................',
    '................',
  ],
  shears: [
    '................',
    '................',
    '..........oo....',
    '.........owlo...',
    '........owlo....',
    '...oo..owlo.....',
    '..owlooowo......',
    '...ollwlo.......',
    '....ooao........',
    '...oaaoao.......',
    '..oaoooaao......',
    '..oao..oao......',
    '..oaao.oao......',
    '...ooo..oo......',
    '................',
    '................',
  ],
  compass: [
    '................',
    '................',
    '.....oooooo.....',
    '....oaaaaaao....',
    '...oaxxxxxxao...',
    '..oaxxxbxxxxao..',
    '..oaxxxbbxxxao..',
    '..oaxxxbbxxxao..',
    '..oaxxxccxxxao..',
    '..oaxxxccxxxao..',
    '..oaxxxxcxxxao..',
    '...oaxxxxxxao...',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
  ],
  boat: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..o..........o..',
    '..oo........oo..',
    '..ohoooooooohk..',
    '..ohhHHHHHHhhk..',
    '..ohhhhhhhhhhk..',
    '...ohhhhhhhhk...',
    '....okkkkkkk....',
    '.....ooooooo....',
    '................',
    '................',
    '................',
  ],
  minecart: [
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..owllllllllmo..',
    '..olddddddddmo..',
    '..olddddddddmo..',
    '..olmmmmmmmmmo..',
    '..ommmmmmmmmdo..',
    '...oddddddddo...',
    '...oo.oo.oo.o...',
    '..okko...okko...',
    '...oo.....oo....',
    '................',
    '................',
  ],
  template: [
    '................',
    '..oooooooooooo..',
    '..ommmmmmmmmmo..',
    '..omaaaaaaaamo..',
    '..omabbbbbbamo..',
    '..omabaaaabamo..',
    '..omabaxxabamo..',
    '..omabaxxabamo..',
    '..omabaaaabamo..',
    '..omabbbbbbamo..',
    '..omaaaaaaaamo..',
    '..ommmmmmmmmmo..',
    '..oddddddddddo..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  sherd: [
    '................',
    '................',
    '..oooooooo......',
    '..ommmmmmmoo....',
    '..omaaaaammmo...',
    '..omaxxxammmdo..',
    '..omaxxxammmdo..',
    '..omaaaaammmdo..',
    '..ommmmmmmmddo..',
    '..ommmmmmmdddo..',
    '..odmmmmmddoo...',
    '..oodddddoo.....',
    '...ooooooo......',
    '................',
    '................',
    '................',
  ],
  pattern: [
    '................',
    '...oooooooooo...',
    '...owwwwwwwwo...',
    '...owaaaaaawo...',
    '...owaxxxxawo...',
    '...owaxxxxawo...',
    '...owaaaaaawo...',
    '...owwwwwwwwo...',
    '...owwwwwwwwo...',
    '...owwwwwwwwo...',
    '...olllllllllo..',
    '...oooooooooo...',
    '................',
    '................',
    '................',
    '................',
  ],
  star: [
    '................',
    '.......oo.......',
    '......owlo......',
    '......owlo......',
    '..ooooowlooooo..',
    '..owwwwlllllmo..',
    '...ollllmmmmo...',
    '....olmmmmdo....',
    '....olmmmmdo....',
    '...olmmoommdo...',
    '...olmo..omdo...',
    '..olmo....odo...',
    '..ooo......oo...',
    '................',
    '................',
    '................',
  ],
  pearl: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooaaaaoo....',
    '...oaaxxxxaao...',
    '...oaxxbbxxao...',
    '...oaxbbbbxao...',
    '...oaxxbbxxao...',
    '...oaaxxxxaao...',
    '....ooaaaaoo....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  frame: [
    '................',
    '..oooooooooooo..',
    '..ohhhhhhhhhko..',
    '..ohkkkkkkkhko..',
    '..ohkxxxxxxhko..',
    '..ohkxxxxxxhko..',
    '..ohkxxxxxxhko..',
    '..ohkxxxxxxhko..',
    '..ohkxxxxxxhko..',
    '..ohkxxxxxxhko..',
    '..ohhhhhhhhhko..',
    '..okkkkkkkkkko..',
    '..oooooooooooo..',
    '................',
    '................',
    '................',
  ],
  horse_armor: [
    '................',
    '................',
    '..oo............',
    '.owlo...........',
    '.olmoo..........',
    '..olmmoooooooo..',
    '...olmmllllllmo.',
    '...ommmmmmmmmdo.',
    '...ommmmmmmmmdo.',
    '...ommoooooommo.',
    '...odo......odo.',
    '...odo......odo.',
    '...ooo......ooo.',
    '................',
    '................',
    '................',
  ],
  elytra: [
    '................',
    '...oo......oo...',
    '..owlo....olmo..',
    '..owllooooomdo..',
    '..olllmmmmmmdo..',
    '..olmmmmmmmmdo..',
    '..olmmmmmmmmdo..',
    '..olmmmdmmmmdo..',
    '..olmmdodmmmdo..',
    '..olmdo.odmmdo..',
    '..olmo...omddo..',
    '..olmo...odddo..',
    '..ooo.....ooo...',
    '................',
    '................',
    '................',
  ],
  totem: [
    '................',
    '.....oooooo.....',
    '....owllllmo....',
    '....olaolamo....',
    '....olmmmmmo....',
    '..ooommxxmmooo..',
    '.owlmmmmmmmmdo..',
    '..oooommmmooo...',
    '....olmmmmdo....',
    '....olmmmmdo....',
    '....olmdomdo....',
    '....oldo.odo....',
    '....ooo..ooo....',
    '................',
    '................',
    '................',
  ],
  key: [
    '................',
    '................',
    '...oooo.........',
    '..owllmo........',
    '..olaalmo.......',
    '..olaalmooooooo.',
    '..ommmmmmmmmmmo.',
    '...odmmoooommo..',
    '....oooo..oddo..',
    '...........oo...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  map: [
    '................',
    '..oooooooooooo..',
    '..owwwwwwwwwwo..',
    '..owaaawwwwwwo..',
    '..owaaaaawwbwo..',
    '..owwaaaawbbwo..',
    '..owwwaawwbwwo..',
    '..owbbwwwwwwwo..',
    '..owbbbwwaawwo..',
    '..owwbwwaaaawo..',
    '..owwwwwwaawwo..',
    '..owwwwwwwwwwo..',
    '..oooooooooooo..',
    '................',
    '................',
    '................',
  ],
  saddle: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '...oowllllmoo...',
    '..owllmmmmmmdo..',
    '..olmmmmmmmmdo..',
    '..ommdddddddmo..',
    '..oddo.aa.oddo..',
    '...oo..aa..oo...',
    '.......aa.......',
    '......oaao......',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  lead: [
    '................',
    '................',
    '.....oooo.......',
    '....oaaaao......',
    '...oao..oao.....',
    '...oao..oao.....',
    '....oaaaaao.....',
    '.....ooooaao....',
    '.........oaao...',
    '..........oaao..',
    '...........oao..',
    '..........oao...',
    '.........oao....',
    '..........o.....',
    '................',
    '................',
  ],
  tag: [
    '................',
    '................',
    '..........oo....',
    '.........oso....',
    '........os.o....',
    '....oooooooo....',
    '...owwwwwwwwo...',
    '..owllllllllo...',
    '..owwwwwwwwwo...',
    '..owllllllwo....',
    '...owwwwwwo.....',
    '....oooooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  horn: [
    '................',
    '................',
    '................',
    '..oo............',
    '.owlo...........',
    '.olmmo..........',
    '..olmmoo........',
    '...ommmmoo......',
    '....oddmmmoo....',
    '.....ooddmmmoo..',
    '.......ooddmlo..',
    '.........oodmo..',
    '...........oo...',
    '................',
    '................',
    '................',
  ],
  crossbow: [
    '................',
    '.ooo............',
    '.oaoo...........',
    '.oaako..........',
    '.ookhko.........',
    '...okhko........',
    '....okhko.......',
    '.....okhko..oo..',
    '......okhkoowo..',
    '.......okhkwo...',
    '........okoko...',
    '.......oowoko...',
    '......oo..ok....',
    '..........o.....',
    '................',
    '................',
  ],
  trident: [
    '..........o.o.o.',
    '...........owlo.',
    '..........owlo..',
    '.........owlo.o.',
    '........owlmolo.',
    '.......owlo.oo..',
    '......owlo......',
    '.....owlo.......',
    '....owlo........',
    '...owlo.........',
    '..owlo..........',
    '.owlo...........',
    'owlo............',
    'olo.............',
    'oo..............',
    '................',
  ],
  mace: [
    '................',
    '........ooooo...',
    '.......owlllmo..',
    '......owlmmmmdo.',
    '......olmmxmmdo.',
    '......omxmmmxdo.',
    '......odmmxmddo.',
    '.......oddddoo..',
    '......okho......',
    '.....okho.......',
    '....okho........',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okko............',
    'oo..............',
  ],
  flint_steel: [
    '................',
    '................',
    '..oooo..........',
    '.owllmo.........',
    '.olmmmdo........',
    '..oddddo........',
    '...oooo..ooo....',
    '........oaaao...',
    '.......oaxxxao..',
    '.......oaxxxao..',
    '........oaaao...',
    '.........ooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  rocket: [
    '................',
    '..........oo....',
    '.........owwo...',
    '........owaao...',
    '.......oaaaao...',
    '......oaaaao....',
    '.....owwwwo.....',
    '....oaaaaao.....',
    '...oaaaaao......',
    '...oaaaao.......',
    '..okooo.........',
    '.oko............',
    'oko.............',
    'oo..............',
    '................',
    '................',
  ],
  spyglass: [
    '................',
    '.............oo.',
    '............owlo',
    '...........owlmo',
    '..........oaamo.',
    '.........oaaao..',
    '........owlmo...',
    '.......owlmo....',
    '......owlmo.....',
    '.....oaaao......',
    '....oaaao.......',
    '...owlmo........',
    '..owlmo.........',
    '..omdo..........',
    '..oo............',
    '................',
  ],
  brush: [
    '................',
    '............oo..',
    '...........owwo.',
    '..........owllo.',
    '.........owllo..',
    '........oaamo...',
    '.......okhao....',
    '......okho......',
    '.....okho.......',
    '....okho........',
    '...okho.........',
    '..okho..........',
    '.okho...........',
    'okko............',
    'oo..............',
    '................',
  ],
  bundle: [
    '................',
    '................',
    '.......oo.......',
    '......oaao......',
    '......oooo......',
    '....oommmmoo....',
    '...owllmmmmdo...',
    '..owlmmmmmmmdo..',
    '..olmmmmmmmmdo..',
    '..ommmmmmmmmdo..',
    '..ommmmmmmmddo..',
    '...oddmmmmddo...',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  stand: [
    '................',
    '.......oo.......',
    '......ohho......',
    '......ohho......',
    '...oooohhoooo...',
    '...ohhhhhhhho...',
    '...oooohhoooo...',
    '......ohho......',
    '....ooohhooo....',
    '....ohhhhhho....',
    '....ooohhooo....',
    '......ohho......',
    '..oooohhhhoooo..',
    '..okkkkkkkkkko..',
    '..oooooooooooo..',
    '................',
  ],
  eye: [
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooaaaaoo....',
    '...oaaxxxxaao...',
    '..oaxxxbbxxxao..',
    '..oaxxbbbbxxao..',
    '..oaxxbbbbxxao..',
    '..oaxxxbbxxxao..',
    '...oaaxxxxaao...',
    '....ooaaaaoo....',
    '......oooo......',
    '................',
    '................',
    '................',
  ],
  crystal: [
    '................',
    '.......oo.......',
    '......owlo......',
    '.....owllmo.....',
    '....owlaamdo....',
    '...owlaxxamdo...',
    '...olaxxxxamo...',
    '...omaxxxxado...',
    '....omaxxado....',
    '.....omaado.....',
    '...ooommmdooo...',
    '..oyyyyyyyyyyo..',
    '..oyyyyyyyyyyo..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  heart: [
    '................',
    '................',
    '................',
    '...ooo....ooo...',
    '..owllo..omldo..',
    '.owllmmoommmddo.',
    '.olmmmmmmmmmddo.',
    '.ommmmmmmmmmddo.',
    '..ommmmmmmmmdo..',
    '...ommmmmmmdo...',
    '....ommmmmdo....',
    '.....ommmdo.....',
    '......omdo......',
    '.......oo.......',
    '................',
    '................',
  ],
  shell: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '...oowlllmmoo...',
    '..owllmomlmmdo..',
    '..olmmmommmmdo..',
    '.ollmomommomddo.',
    '.olmmommmommddo.',
    '.ommommmmmoomdo.',
    '..odddddddddoo..',
    '...ooooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  membrane: [
    '................',
    '................',
    '..oo........oo..',
    '..owo......owo..',
    '..olwoo..oowlo..',
    '..olllwwwwllmo..',
    '..olmmllllmmmo..',
    '...olmmmmmmmo...',
    '...olmmmmmmdo...',
    '....olmmmmdo....',
    '.....olmmdo.....',
    '......oddo......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ],
  wheat: [
    '................',
    '........o.......',
    '.......omo..o...',
    '......omlmoolo..',
    '.......omlomlo..',
    '..o.....oomlo...',
    '.olo...oomlo....',
    '.olmoo.omlo.....',
    '..olmmoomo......',
    '...oomlmo.......',
    '....oommo.......',
    '.....omo........',
    '....omo.........',
    '...omo..........',
    '...oo...........',
    '................',
  ],
  potion_flask: [
    '................',
    '......oooo......',
    '......ohho......',
    '.......oo.......',
    '......owwo......',
    '.....owbbao.....',
    '....owbbbbao....',
    '...owbbbbbbao...',
    '...owbbbbbbao...',
    '...olbbbbbbao...',
    '...oabbbbbbao...',
    '....oabbbbao....',
    '.....oaaaao.....',
    '......oooo......',
    '................',
    '................',
  ],
  splash_flask: [
    '................',
    '......oooo......',
    '......ohho......',
    '......owwo......',
    '.....owbbao.....',
    '.....owbbao.....',
    '....owbbbbao....',
    '....owbbbbao....',
    '...owbbbbbbao...',
    '...olbbbbbbao...',
    '...oabbbbbbao...',
    '....oaaaaaao....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
};

// ---------------------------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------------------------

type Pal = Record<string, RGB | RGBA>;

function ramp(base: RGB, handle: RGB = WOOD): Pal {
  return {
    o: shade(base, 0.32), d: shade(base, 0.68), m: base, l: shade(base, 1.22), w: mix(base, [255, 255, 255], 0.55),
    k: shade(handle, 0.6), h: handle, H: shade(handle, 1.25),
  };
}

function drawMask(p: Painter, rows: string[], pal: Pal, dx = 0, dy = 0): void {
  for (let v = 0; v < 16; v++) {
    const row = rows[v]!;
    for (let u = 0; u < 16; u++) {
      const ch = row[u]!;
      if (ch === '.') continue;
      const c = pal[ch];
      if (!c) continue;
      const x = u + dx, y = v + dy;
      if (x < 0 || x > 15 || y < 0 || y > 15) continue;
      p.px(x, y, c);
    }
  }
}

function mask(p: Painter, shape: string, pal: Pal): void {
  drawMask(p, M[shape]!, pal);
}

/** Tint the non-transparent pixels whose colour is close to `from`. */
function colorize(p: Painter, fn: (c: RGBA, x: number, y: number) => RGBA | null): void {
  p.each((x, y) => {
    const c = p.get(x, y);
    if (c[3] === 0) return;
    const r = fn(c, x, y);
    if (r) p.set(x, y, r);
  });
}

const WOOD = hex('#8a6438');
const MAT: Record<string, RGB> = {
  wooden: hex('#a07a45'), stone: hex('#8d8d8d'), copper: hex('#d0784c'), iron: hex('#d4d4d4'), golden: hex('#f4d449'),
  diamond: hex('#46e2d3'), infernium: hex('#5a4b52'), leather: hex('#8e5a33'), chainmail: hex('#9b9fa3'), turtle: hex('#4b9a3f'),
};

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------

type Recipe = (p: Painter, m: RegExpMatchArray) => void;
const exact = new Map<string, (p: Painter) => void>();
const rules: Array<[RegExp, Recipe]> = [];
const def = (id: string, fn: (p: Painter) => void) => exact.set(id, fn);
const rule = (re: RegExp, fn: Recipe) => rules.push([re, fn]);

const simple = (shape: string, color: string | RGB, extra: Pal = {}) => (p: Painter) => mask(p, shape, { ...ramp(typeof color === 'string' ? hex(color) : color), ...extra });

// Tools and armor by material
rule(/^(wooden|stone|copper|iron|golden|diamond|infernium)_(sword|pickaxe|axe|shovel|hoe)$/, (p, m) => {
  const base = MAT[m[1]!]!;
  mask(p, m[2]!, ramp(base));
  if (m[1] === 'infernium') colorize(p, (c, x, y) => (p.rnd(x, y, 5) < 0.12 && c[0] < 120 ? [c[0] + 18, c[1] + 6, c[2] + 26, 255] : null));
});
rule(/^(leather|copper|chainmail|iron|golden|diamond|infernium)_(helmet|chestplate|leggings|boots)$/, (p, m) => {
  const base = MAT[m[1]!]!;
  mask(p, m[2]!, ramp(base));
  if (m[1] === 'chainmail') colorize(p, (c, x, y) => ((x + y) % 2 === 0 && c[0] > 90 ? [c[0] - 40, c[1] - 40, c[2] - 40, 255] : null));
});
def('turtle_helmet', simple('helmet', MAT.turtle!));
rule(/^(leather|iron|golden|diamond)_horse_armor$/, (p, m) => mask(p, 'horse_armor', ramp(MAT[m[1]!]!)));
def('wolf_armor', simple('horse_armor', '#9b7b6a'));

// Weapons & tools
def('mace', (p) => mask(p, 'mace', { ...ramp(hex('#9a9aa6')), x: hex('#5b5b66') }));
def('trident', simple('trident', '#3f9f8e'));
def('bow', (p) => mask(p, 'bow', { ...ramp(WOOD), s: hex('#e7e7e7') }));
def('crossbow', (p) => mask(p, 'crossbow', { ...ramp(hex('#8c8c8c')), a: hex('#6e5534'), w: hex('#dcdcdc') }));
def('shield', (p) => mask(p, 'shield', { ...ramp(hex('#8d8d8d'), hex('#8a6438')) }));
def('shears', (p) => mask(p, 'shears', { ...ramp(hex('#d0d0d0')), a: hex('#4a4a4a') }));
def('flint_and_steel', (p) => mask(p, 'flint_steel', { ...ramp(hex('#555555')), a: hex('#b0b0b0'), x: hex('#e8e8e8') }));
def('fishing_rod', (p) => mask(p, 'bow', { ...ramp(WOOD), s: hex('#dddddd') }));
def('carrot_on_a_stick', (p) => {
  mask(p, 'rod', ramp(WOOD));
  drawMask(p, M.carrot!, ramp(hex('#ef8b1d')), 4, 5);
});
def('warped_fungus_on_a_stick', (p) => {
  mask(p, 'rod', ramp(WOOD));
  p.disc(4, 12, 2.5, (x, y) => p.set(x, y, hex('#2a9d8f')));
});
def('brush', (p) => mask(p, 'brush', { ...ramp(hex('#f0e2c6')), a: hex('#c47d4d') }));
def('spyglass', (p) => mask(p, 'spyglass', { ...ramp(hex('#c8744a')), a: hex('#8a4f30') }));
def('compass', (p) => mask(p, 'compass', { o: hex('#333333'), a: hex('#9a9a9a'), x: hex('#595959'), b: hex('#d0342c'), c: hex('#e8e8e8') }));
def('recovery_compass', (p) => mask(p, 'compass', { o: hex('#10222a'), a: hex('#2c5664'), x: hex('#0c3a44'), b: hex('#3be2d6'), c: hex('#9ff5ef') }));
def('clock', (p) => mask(p, 'compass', { o: hex('#5a4213'), a: hex('#f4d449'), x: hex('#2c3e6e'), b: hex('#f5f5f5'), c: hex('#f0c040') }));
def('lead', (p) => mask(p, 'lead', { o: hex('#3e2a1a'), a: hex('#b5895a') }));
def('name_tag', (p) => mask(p, 'tag', { ...ramp(hex('#e6d7b5')), s: hex('#8a8a8a') }));
def('goat_horn', simple('horn', '#c9bca3'));
def('elytra', simple('elytra', '#8f89a8'));
def('saddle', (p) => mask(p, 'saddle', { ...ramp(hex('#8b4f2c')), a: hex('#b5b5b5') }));
def('totem_of_undying', (p) => mask(p, 'totem', { ...ramp(hex('#e0c145')), a: hex('#1e8f3a'), x: hex('#1e8f3a') }));
def('wind_charge', (p) => mask(p, 'ball', ramp(hex('#b8c7f0'))));
def('bundle', (p) => mask(p, 'bundle', { ...ramp(hex('#a06a3e')), a: hex('#e0c58d') }));
rule(/^(.+)_bundle$/, (p, m) => mask(p, 'bundle', { ...ramp(DYE[m[1]!] ?? hex('#a06a3e')), a: hex('#e0c58d') }));

// Buckets
const bucketMetal = ramp(hex('#cfcfcf'));
def('bucket', (p) => mask(p, 'bucket', { ...bucketMetal, b: shade(hex('#cfcfcf'), 0.5) }));
const bucketWith = (c: RGB) => (p: Painter) => mask(p, 'bucket', { ...bucketMetal, b: c });
def('water_bucket', bucketWith(hex('#3b6fe0')));
def('lava_bucket', bucketWith(hex('#ff7a12')));
def('milk_bucket', bucketWith(hex('#f5f5f0')));
def('powder_snow_bucket', bucketWith(hex('#e8f0ff')));
for (const [f, c] of [['cod', '#b09668'], ['salmon', '#b3403a'], ['pufferfish', '#e0c440'], ['tropical_fish', '#f07f25'], ['axolotl', '#f19ec3'], ['tadpole', '#5b4b3a']] as const) {
  def(`${f}_bucket`, (p) => {
    mask(p, 'bucket', { ...bucketMetal, b: hex('#3b6fe0') });
    p.px(7, 5, hex(c)); p.px(8, 5, hex(c)); p.px(6, 6, hex(c)); p.px(9, 6, hex(c));
  });
}

// Projectiles & throwables
def('arrow', (p) => mask(p, 'arrow', { ...ramp(hex('#8e8e8e')), k: hex('#5e4424'), a: hex('#e5e5e5'), b: hex('#bdbdbd') }));
def('spectral_arrow', (p) => mask(p, 'arrow', { ...ramp(hex('#f6d349')), k: hex('#b0892b'), a: hex('#fff2a8'), b: hex('#e0c060') }));
def('tipped_arrow', (p) => mask(p, 'arrow', { ...ramp(hex('#8e8e8e')), k: hex('#5e4424'), a: hex('#e5e5e5'), b: hex('#bdbdbd'), w: hex('#c040c0'), l: hex('#a030a0') }));
def('snowball', (p) => mask(p, 'ball', ramp(hex('#eef4ff'))));
def('egg', (p) => mask(p, 'ball', ramp(hex('#e9dcc0'))));
def('blue_egg', (p) => mask(p, 'ball', ramp(hex('#8fb6d8'))));
def('brown_egg', (p) => mask(p, 'ball', ramp(hex('#a9784c'))));
def('void_pearl', (p) => mask(p, 'pearl', { o: hex('#0b2b27'), a: hex('#1f6b5e'), x: hex('#2d9d88'), b: hex('#0c3a33') }));
def('void_eye', (p) => mask(p, 'eye', { o: hex('#0b2b27'), a: hex('#1f6b5e'), x: hex('#8fd46a'), b: hex('#0c1a10') }));
def('experience_bottle', (p) => mask(p, 'bottle', { o: hex('#335533'), h: hex('#8a6438'), w: hex('#ffffff'), l: hex('#e0ffe0'), a: hex('#a4d98c'), b: hex('#5ce040') }));
def('fire_charge', (p) => mask(p, 'ball', { ...ramp(hex('#4a2a12')), w: hex('#ffd24a'), l: hex('#ff8a1a') }));
def('firework_rocket', (p) => mask(p, 'rocket', { o: hex('#3a1010'), a: hex('#c2342c'), w: hex('#e8e8e8'), k: hex('#6b4a2a') }));
def('firework_star', (p) => mask(p, 'ball', ramp(hex('#707070'))));

// Materials
def('coal', (p) => mask(p, 'lump', ramp(hex('#2d2d30'))));
def('charcoal', (p) => mask(p, 'lump', ramp(hex('#3a3026'))));
def('diamond', (p) => mask(p, 'gem', ramp(MAT.diamond!)));
def('emerald', (p) => mask(p, 'gem', ramp(hex('#2dd06a'))));
def('lapis_lazuli', (p) => mask(p, 'lump', ramp(hex('#2c4fb5'))));
def('cinder_quartz', (p) => mask(p, 'shard', ramp(hex('#ece6dc'))));
def('amethyst_shard', (p) => mask(p, 'shard', ramp(hex('#a46de0'))));
def('echo_shard', (p) => mask(p, 'shard', ramp(hex('#0f4b56'))));
def('prismarine_shard', (p) => mask(p, 'shard', ramp(hex('#5aa89b'))));
def('prismarine_crystals', (p) => mask(p, 'gem', ramp(hex('#a9dfd0'))));
for (const [m, c] of [['iron', '#d8d8d8'], ['gold', '#f4d449'], ['copper', '#d0784c'], ['infernium', '#4d4046']] as const) {
  def(`${m}_ingot`, (p) => mask(p, 'ingot', ramp(hex(c))));
  def(`${m}_nugget`, (p) => mask(p, 'nugget', ramp(hex(c))));
}
def('infernium_scrap', (p) => mask(p, 'raw', ramp(hex('#6a4a3c'))));
def('raw_iron', (p) => mask(p, 'raw', ramp(hex('#d0a88a'))));
def('raw_gold', (p) => mask(p, 'raw', ramp(hex('#e8b830'))));
def('raw_copper', (p) => mask(p, 'raw', ramp(hex('#c86a44'))));
def('stick', (p) => mask(p, 'rod', ramp(WOOD)));
def('blaze_rod', (p) => mask(p, 'rod', ramp(hex('#f2b41c'))));
def('breeze_rod', (p) => mask(p, 'rod', ramp(hex('#9fb0e6'))));
def('bowl', (p) => mask(p, 'bowl', { ...ramp(WOOD), b: shade(WOOD, 0.45) }));
def('string', (p) => mask(p, 'string', { o: hex('#6a6a6a'), w: hex('#f2f2f2') }));
def('feather', (p) => mask(p, 'feather', { ...ramp(hex('#e8e8e8')), k: hex('#8a8a8a') }));
def('gunpowder', (p) => mask(p, 'dust', ramp(hex('#5b5b5b'))));
def('glowstone_dust', (p) => mask(p, 'dust', ramp(hex('#f7d56b'))));
def('flux_dust', (p) => mask(p, 'dust', ramp(hex('#d0241c'))));
def('sugar', (p) => mask(p, 'dust', ramp(hex('#f4f4f4'))));
def('blaze_powder', (p) => mask(p, 'dust', ramp(hex('#f29c1c'))));
def('bone_meal', (p) => mask(p, 'dust', ramp(hex('#eeeee0'))));
def('flint', (p) => mask(p, 'lump', ramp(hex('#4a4a4a'))));
def('leather', (p) => mask(p, 'hide', ramp(MAT.leather!)));
def('rabbit_hide', (p) => mask(p, 'hide', ramp(hex('#b08e68'))));
def('turtle_scute', (p) => mask(p, 'shell', ramp(hex('#4b9a3f'))));
def('armadillo_scute', (p) => mask(p, 'shell', ramp(hex('#b07a6a'))));
def('bone', (p) => mask(p, 'bone', ramp(hex('#e8e3cf'))));
def('ghast_tear', (p) => mask(p, 'gem', ramp(hex('#d6ecee'))));
def('magma_cream', (p) => mask(p, 'ball', { ...ramp(hex('#c65314')), w: hex('#ffcc40') }));
def('slime_ball', (p) => mask(p, 'ball', ramp(hex('#6cc251'))));
def('paper', (p) => mask(p, 'paper', ramp(hex('#e8e4d4'))));
def('book', (p) => mask(p, 'book', { o: hex('#3d2415'), a: hex('#7a4a2b'), b: hex('#c49a5c'), s: hex('#efe6d2'), d: hex('#4d2e19') }));
def('writable_book', (p) => {
  mask(p, 'book', { o: hex('#3d2415'), a: hex('#7a4a2b'), b: hex('#c49a5c'), s: hex('#efe6d2'), d: hex('#4d2e19') });
  p.line(9, 2, 14, 7, hex('#333333'));
  p.px(14, 7, hex('#e8e8e8'));
});
def('written_book', (p) => mask(p, 'book', { o: hex('#3d2415'), a: hex('#7a4a2b'), b: hex('#f4d449'), s: hex('#efe6d2'), d: hex('#4d2e19') }));
def('enchanted_book', (p) => mask(p, 'book', { o: hex('#2a1540'), a: hex('#6a3a8a'), b: hex('#f4d449'), s: hex('#efe6d2'), d: hex('#3c1f58') }));
def('knowledge_book', (p) => mask(p, 'book', { o: hex('#0f2a40'), a: hex('#2a6aa0'), b: hex('#f4d449'), s: hex('#efe6d2'), d: hex('#123d5e') }));
def('clay_ball', (p) => mask(p, 'ball', ramp(hex('#a3a8b8'))));
def('brick', (p) => mask(p, 'ingot', ramp(hex('#9a4a36'))));
def('cinder_brick', (p) => mask(p, 'ingot', ramp(hex('#4a2226'))));
def('resin_brick', (p) => mask(p, 'ingot', ramp(hex('#d86a1c'))));
def('resin_clump', (p) => mask(p, 'blob', ramp(hex('#e8781c'))));
def('nautilus_shell', (p) => mask(p, 'shell', ramp(hex('#e8dccb'))));
def('heart_of_the_sea', (p) => mask(p, 'pearl', { o: hex('#0c2a44'), a: hex('#2a6ad0'), x: hex('#4ec8f0'), b: hex('#bff4ff') }));
def('disc_fragment', (p) => mask(p, 'shard', ramp(hex('#3f3f46'))));
def('phantom_membrane', (p) => mask(p, 'membrane', ramp(hex('#cfc8b0'))));
def('popped_chorus_fruit', (p) => mask(p, 'blob', ramp(hex('#b58bc2'))));
def('lurker_shell', (p) => mask(p, 'shell', ramp(hex('#8e62a2'))));
def('blight_star', (p) => mask(p, 'star', ramp(hex('#f3f0e0'))));
def('dragon_breath', (p) => mask(p, 'bottle', { o: hex('#3a2040'), h: hex('#8a6438'), w: hex('#ffffff'), l: hex('#f0d8f0'), a: hex('#c79ad0'), b: hex('#e27ac8') }));
def('honeycomb', (p) => mask(p, 'blob', ramp(hex('#e8a53a'))));
def('ink_sac', (p) => mask(p, 'blob', ramp(hex('#3a3040'))));
def('glow_ink_sac', (p) => mask(p, 'blob', ramp(hex('#2fc5b5'))));
def('wheat', (p) => mask(p, 'wheat', ramp(hex('#d9b64a'))));
def('wheat_seeds', (p) => mask(p, 'seeds', ramp(hex('#6fa338'))));
def('beetroot_seeds', (p) => mask(p, 'seeds', ramp(hex('#c7b58a'))));
def('melon_seeds', (p) => mask(p, 'seeds', ramp(hex('#2e2a22'))));
def('pumpkin_seeds', (p) => mask(p, 'seeds', ramp(hex('#e8dca0'))));
def('torchflower_seeds', (p) => mask(p, 'seeds', ramp(hex('#7a8a3a'))));
def('pitcher_pod', (p) => mask(p, 'carrot', { ...ramp(hex('#5e8c4a')), a: hex('#3b6e2a'), b: hex('#6a4a2a') }));
def('cocoa_beans', (p) => mask(p, 'seeds', ramp(hex('#6a3a1c'))));
def('glistering_melon_slice', (p) => mask(p, 'slice', { o: hex('#4a3a10'), a: hex('#f4d449'), b: hex('#e8c030'), m: hex('#f07070'), x: hex('#30200a') }));
def('fermented_spider_eye', (p) => mask(p, 'blob', ramp(hex('#b05050'))));
def('rabbit_foot', (p) => mask(p, 'feather', { ...ramp(hex('#d0b48c')), k: hex('#8a6a4a') }));
def('trial_key', (p) => mask(p, 'key', { ...ramp(hex('#d0784c')), a: hex('#3a8a8a') }));
def('ominous_trial_key', (p) => mask(p, 'key', { ...ramp(hex('#4a4a52')), a: hex('#c04a3a') }));
rule(/^(.+)_dye$/, (p, m) => mask(p, 'blob', ramp(DYE[m[1]!] ?? hex('#808080'))));
def('glass_bottle', (p) => mask(p, 'bottle', { o: hex('#3a4a5a'), h: hex('#8a6438'), w: [255, 255, 255, 200], l: [230, 240, 255, 160], a: [200, 220, 240, 120], b: [200, 220, 240, 70] }));
def('honey_bottle', (p) => mask(p, 'bottle', { o: hex('#5a3a10'), h: hex('#8a6438'), w: hex('#ffffff'), l: hex('#ffe9a8'), a: hex('#f0c040'), b: hex('#f0a020') }));
def('ominous_bottle', (p) => mask(p, 'bottle', { o: hex('#10202a'), h: hex('#555555'), w: hex('#c8e0e8'), l: hex('#6a8a9a'), a: hex('#2a4a5a'), b: hex('#1a3040') }));
def('armor_stand', (p) => mask(p, 'stand', { o: hex('#3a2a1a'), h: hex('#9a7448'), k: hex('#7a7a7a') }));
def('painting', (p) => mask(p, 'frame', { o: hex('#3a2a1a'), h: hex('#9a7448'), k: hex('#6a4a2a'), x: hex('#4a8ad0') }));
def('item_frame', (p) => mask(p, 'frame', { o: hex('#3a2a1a'), h: hex('#9a7448'), k: hex('#6a4a2a'), x: hex('#8a6a4a') }));
def('glow_item_frame', (p) => mask(p, 'frame', { o: hex('#10302a'), h: hex('#3fc0a0'), k: hex('#2a8a74'), x: hex('#8a6a4a') }));
def('verge_crystal', (p) => mask(p, 'crystal', { ...ramp(hex('#d8b4f0')), a: hex('#c080f0'), x: hex('#f0e0ff'), y: hex('#3a2a4a') }));

rule(/^(.+)_pottery_sherd$/, (p, m) => {
  mask(p, 'sherd', { ...ramp(hex('#a4553a')), a: hex('#6a3020'), x: hex('#6a3020') });
  // unique motif per sherd
  const h = [...m[1]!].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  for (let i = 0; i < 5; i++) p.px(5 + (h >> (i * 3)) % 3, 5 + (h >> (i * 2 + 1)) % 3, hex('#3a1a10'));
});
def('infernium_upgrade_smithing_template', (p) => mask(p, 'template', { ...ramp(hex('#3a3440')), a: hex('#5a4a5a'), b: hex('#8a6a50'), x: hex('#c09060') }));
rule(/^(.+)_armor_trim_smithing_template$/, (p, m) => {
  const h = [...m[1]!].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 11);
  const hue = hex(['#4a8a8a', '#c0a060', '#6a9ad0', '#6aa04a', '#8a6ab0', '#b04a4a', '#c0c0c0', '#3a6ad0'][h % 8]!);
  mask(p, 'template', { ...ramp(hex('#4a4a52')), a: shade(hue, 0.7), b: hue, x: shade(hue, 1.3) });
});
rule(/^(.+)_banner_pattern$/, (p) => mask(p, 'pattern', { ...ramp(hex('#e8e4d4')), a: hex('#6a6a6a'), x: hex('#3a3a3a') }));

def('map', (p) => mask(p, 'map', { o: hex('#4a3a2a'), w: hex('#e8dcc0'), a: hex('#c8b890'), b: hex('#c8b890') }));
def('filled_map', (p) => mask(p, 'map', { o: hex('#4a3a2a'), w: hex('#e8dcc0'), a: hex('#6aa04a'), b: hex('#4a7ad0') }));
def('debug_stick', (p) => mask(p, 'rod', ramp(hex('#b070d0'))));
def('potion', (p) => mask(p, 'potion_flask', { o: hex('#2a2a3a'), h: hex('#8a6438'), w: hex('#ffffff'), a: hex('#b0c0d0'), b: hex('#385dc6') }));
def('splash_potion', (p) => mask(p, 'splash_flask', { o: hex('#2a2a3a'), h: hex('#8a6438'), w: hex('#ffffff'), a: hex('#b0c0d0'), b: hex('#385dc6') }));
def('lingering_potion', (p) => mask(p, 'splash_flask', { o: hex('#2a2a3a'), h: hex('#8a6438'), w: hex('#ffffff'), a: hex('#d0d0e0'), b: hex('#6a7dd6') }));

const PLANK_COLORS: Record<string, string> = {
  oak: '#b0894f', spruce: '#6f4f2e', birch: '#c9b77a', jungle: '#a4724c', acacia: '#ad5d32', dark_oak: '#4a2f17',
  mangrove: '#773431', cherry: '#e2b2ab', pale_oak: '#e4dbd1', bamboo: '#c9b156',
};
rule(/^(.+?)_(chest_)?(boat|raft)$/, (p, m) => {
  const wood = hex(PLANK_COLORS[m[1]!] ?? '#b0894f');
  mask(p, 'boat', { o: shade(wood, 0.35), h: wood, H: shade(wood, 1.25), k: shade(wood, 0.6) });
  if (m[2]) {
    p.fillRect(6, 5, 10, 8, hex('#8a6438'));
    p.fillRect(7, 6, 9, 7, hex('#3a3a3a'));
  }
});
const cartOverlay: Record<string, (p: Painter) => void> = {
  chest_minecart: (p) => { p.fillRect(4, 1, 12, 5, hex('#a07a45')); p.fillRect(7, 3, 9, 4, hex('#3a3a3a')); },
  furnace_minecart: (p) => { p.fillRect(4, 1, 12, 5, hex('#6a6a6a')); p.fillRect(6, 3, 10, 5, hex('#2a2a2a')); },
  hopper_minecart: (p) => { p.fillRect(4, 1, 12, 3, hex('#4a4a4a')); p.fillRect(6, 3, 10, 5, hex('#5a5a5a')); },
  tnt_minecart: (p) => { p.fillRect(4, 0, 12, 5, hex('#c83a2a')); p.fillRect(4, 2, 12, 3, hex('#e8e8e8')); },
  command_block_minecart: (p) => { p.fillRect(4, 0, 12, 5, hex('#c0875a')); p.fillRect(6, 2, 10, 3, hex('#2a2a2a')); },
};
rule(/^((chest|furnace|hopper|tnt|command_block)_)?minecart$/, (p, m) => {
  mask(p, 'minecart', { ...ramp(hex('#8a8a8a')), k: hex('#3a3a3a') });
  if (m[1]) cartOverlay[`${m[2]}_minecart`]!(p);
});

const DISC_COLORS = ['#e05a3a', '#3a8ad0', '#f0c040', '#6ac04a', '#c04ab0', '#4ac0c0', '#e0e0e0', '#f08a2a', '#8a4ad0', '#2a6a4a', '#d04a6a', '#7a5a3a', '#5a5a6a', '#40e0a0', '#a03030', '#9ad0f0', '#f0a0c0', '#b0b040', '#304080', '#e8c8a0', '#ff6030'];
rule(/^disc_(.+)$/, (p) => {
  const i = Math.abs([...p.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) % DISC_COLORS.length;
  mask(p, 'disc', { o: hex('#101014'), x: hex('#2a2a30'), y: hex('#505058'), a: hex(DISC_COLORS[i]!) });
});

// Food
def('apple', (p) => mask(p, 'apple', { ...ramp(hex('#d8342c')), k: hex('#5a3a1a'), a: hex('#4a9a3a') }));
def('golden_apple', (p) => mask(p, 'apple', { ...ramp(hex('#f4d449')), k: hex('#5a3a1a'), a: hex('#4a9a3a') }));
def('enchanted_golden_apple', (p) => mask(p, 'apple', { ...ramp(hex('#f4d449')), k: hex('#5a3a1a'), a: hex('#c080f0') }));
def('melon_slice', (p) => mask(p, 'slice', { o: hex('#1a3a10'), a: hex('#4a8a2a'), b: hex('#6ab04a'), m: hex('#e0443a'), x: hex('#20100a') }));
def('sweet_berries', (p) => mask(p, 'berries', { ...ramp(hex('#b8233a')), a: hex('#3a6a2a') }));
def('glow_berries', (p) => mask(p, 'berries', { ...ramp(hex('#f0a030')), a: hex('#3a6a2a') }));
def('carrot', (p) => mask(p, 'carrot', { ...ramp(hex('#ef8b1d')), a: hex('#4aa03a'), b: hex('#2a7a2a') }));
def('golden_carrot', (p) => mask(p, 'carrot', { ...ramp(hex('#f4d449')), a: hex('#e8c030'), b: hex('#c0a020') }));
def('potato', (p) => mask(p, 'potato', ramp(hex('#d0a05a'))));
def('baked_potato', (p) => mask(p, 'potato', ramp(hex('#c8843a'))));
def('poisonous_potato', (p) => mask(p, 'potato', ramp(hex('#a8b04a'))));
def('beetroot', (p) => mask(p, 'apple', { ...ramp(hex('#9a2a3a')), k: hex('#3a6a2a'), a: hex('#4a9a3a') }));
const soup = (c: string) => (p: Painter) => mask(p, 'bowl', { ...ramp(WOOD), b: hex(c) });
def('beetroot_soup', soup('#a8243a'));
def('mushroom_stew', soup('#c89a6a'));
def('rabbit_stew', soup('#a86a3a'));
def('suspicious_stew', soup('#b08a5a'));
def('bread', (p) => mask(p, 'bread', ramp(hex('#c8904a'))));
def('cookie', (p) => mask(p, 'cookie', { ...ramp(hex('#c88a4a')), a: hex('#4a2a1a') }));
def('pumpkin_pie', (p) => mask(p, 'pie', { ...ramp(hex('#e0a86a')), a: hex('#e87a1a'), b: hex('#c0803a') }));
const meat = (raw: string, cooked: string) => {
  return [(p: Painter) => mask(p, 'meat', { ...ramp(hex(raw)), a: hex('#f0ece0') }), (p: Painter) => mask(p, 'meat', { ...ramp(hex(cooked)), a: hex('#f0ece0') })] as const;
};
for (const [raw, cooked, rc, cc] of [['beef', 'cooked_beef', '#c8343a', '#7a4a2a'], ['porkchop', 'cooked_porkchop', '#f09090', '#c89a6a'], ['mutton', 'cooked_mutton', '#c84a3a', '#8a5a3a'], ['rabbit', 'cooked_rabbit', '#e8a090', '#b87a4a']] as const) {
  const [a, b] = meat(rc, cc);
  def(raw, a);
  def(cooked, b);
}
def('chicken', (p) => mask(p, 'meat', { ...ramp(hex('#f2c8b0')), a: hex('#f0ece0') }));
def('cooked_chicken', (p) => mask(p, 'meat', { ...ramp(hex('#c8904a')), a: hex('#f0ece0') }));
for (const [f, c] of [['cod', '#b09668'], ['salmon', '#c0503a'], ['tropical_fish', '#f07f25'], ['pufferfish', '#e0c440']] as const) {
  def(f, (p) => mask(p, 'fish', { ...ramp(hex(c)), x: hex('#101010') }));
  if (f === 'cod' || f === 'salmon') def(`cooked_${f}`, (p) => mask(p, 'fish', { ...ramp(shade(hex(c), 0.75)), x: hex('#101010') }));
}
def('rotten_flesh', (p) => mask(p, 'meat', { ...ramp(hex('#8a6a3a')), a: hex('#6a8a3a') }));
def('spider_eye', (p) => mask(p, 'eye', { o: hex('#3a0a14'), a: hex('#8a1a2a'), x: hex('#c83a4a'), b: hex('#1a0a0a') }));
def('dried_kelp', (p) => mask(p, 'kelp', ramp(hex('#3a4a2a'))));
def('chorus_fruit', (p) => mask(p, 'blob', ramp(hex('#8a5a9a'))));

// ---------------------------------------------------------------------------------------------

export function paintItemTexture(p: Painter, id: string): boolean {
  p.clear();
  p.material({ smooth: 0.2, tint: 0, bump: 0.3 });
  const e = exact.get(id);
  if (e) {
    e(p);
    p.heightFromLuma(0.4);
    return true;
  }
  for (const [re, fn] of rules) {
    const m = re.exec(id);
    if (m) {
      fn(p, m);
      p.heightFromLuma(0.4);
      return true;
    }
  }
  return false;
}

export function hasItemTexture(id: string): boolean {
  return exact.has(id) || rules.some(([re]) => re.test(id));
}
