/**
 * Survival HUD: health (with absorption, poison/withering/frozen variants, low-health shake and
 * regeneration wave), armor, hunger, air bubbles, experience bar and level, off-hand slot,
 * attack-strength indicator, active effect icons and screen overlays (freezing, low health).
 */
import { h, clear } from './dom';
import { heartIcon, foodIcon, armorIcon, bubbleIcon, effectIcon, HeartKind } from './hudicons';
import type { IconRenderer } from './icons';
import type { LocalPlayer } from '../player';
import type { ClientEntities } from '../entities';
import { EFFECTS } from '../../common/effect/effects';
import { getItem } from '../../common/item/items';
import { t } from '../../common/lang/i18n';
import { renderStack } from './slotview';

export class StatusHud {
  readonly root: HTMLDivElement;
  private readonly hearts: HTMLDivElement;
  private readonly armor: HTMLDivElement;
  private readonly food: HTMLDivElement;
  private readonly air: HTMLDivElement;
  private readonly xpBar: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpText: HTMLDivElement;
  private readonly offhand: HTMLDivElement;
  private readonly attack: HTMLDivElement;
  private readonly attackFill: HTMLDivElement;
  private readonly effects: HTMLDivElement;
  private readonly frost: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private lastKey = '';
  private lastEffects = '';
  private lastHealth = 20;
  private blinkUntil = 0;
  private offKey = '-';
  hardcore = false;

  constructor(private readonly icons: IconRenderer) {
    this.frost = h('div', { class: 'overlay-frost' });
    this.vignette = h('div', { class: 'overlay-vignette' });
    this.hearts = h('div', { class: 'stat-row hearts' });
    this.armor = h('div', { class: 'stat-row armor' });
    this.food = h('div', { class: 'stat-row food' });
    this.air = h('div', { class: 'stat-row air' });
    this.xpFill = h('div', { class: 'fill' });
    this.xpBar = h('div', { class: 'xp-bar' }, this.xpFill);
    this.xpText = h('div', { class: 'xp-level' });
    this.offhand = h('div', { class: 'offhand slot' });
    this.attackFill = h('div', { class: 'fill' });
    this.attack = h('div', { class: 'attack-indicator' }, this.attackFill);
    this.effects = h('div', { class: 'effects' });
    this.root = h('div', { class: 'status' }, this.frost, this.vignette, this.hearts, this.armor, this.food, this.air, this.xpBar, this.xpText, this.offhand, this.attack, this.effects);
  }

  update(p: LocalPlayer, entities: ClientEntities, gameTick: number): void {
    const mode = p.gameMode;
    const survival = mode === 'survival' || mode === 'adventure';
    this.root.classList.toggle('creative', !survival);
    // Blink hearts on damage
    if (p.health < this.lastHealth) this.blinkUntil = gameTick + 20;
    this.lastHealth = p.health;
    const fx = entities.localEffects;
    const has = (id: string) => fx.some((e) => e.id === id);
    const kind: HeartKind = has('withering') ? 'wither' : has('poison') ? 'poison' : p.frozen >= 140 ? 'frozen' : 'normal';
    const blink = gameTick < this.blinkUntil && Math.floor(gameTick / 3) % 2 === 0;
    const regen = has('regeneration');
    const low = p.health <= 4;
    const armorVal = this.armorValue(p);
    const hungerFx = has('hunger');
    const key = [p.health.toFixed(1), p.maxHealth, p.absorption.toFixed(1), kind, blink, low ? gameTick : 0, regen ? gameTick % 30 : -1, armorVal, p.food, hungerFx, p.saturation <= 0 ? gameTick % 20 : -1, p.air, p.maxAir, this.hardcore, survival].join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.renderHearts(p, kind, blink, regen, low, gameTick);
      this.renderArmor(armorVal);
      this.renderFood(p, hungerFx, gameTick);
      this.renderAir(p);
    }
    // Experience
    this.xpFill.style.width = `${Math.max(0, Math.min(1, p.xpProgress)) * 100}%`;
    this.xpText.textContent = p.xpLevel > 0 ? String(p.xpLevel) : '';
    this.xpBar.style.display = mode === 'spectator' ? 'none' : '';
    // Off hand
    const off = p.inventory.offHand;
    const offKey = off.isEmpty() ? '' : `${off.id}:${off.count}:${off.damage}`;
    if (offKey !== this.offKey) {
      this.offKey = offKey;
      this.offhand.style.display = off.isEmpty() ? 'none' : '';
      renderStack(this.offhand, off, this.icons);
    }
    // Attack strength indicator (weapons have slower attack speeds)
    const speed = attackSpeedOf(p);
    const strength = Math.min(1, (p.attackTicker + 0.5) / (20 / speed));
    const showAttack = strength < 1 && mode !== 'spectator';
    this.attack.style.display = showAttack ? '' : 'none';
    this.attackFill.style.width = `${strength * 100}%`;
    // Effects
    const ekey = fx.map((e) => `${e.id}:${e.amp}:${e.dur > 0 && e.dur < 200 ? Math.floor(gameTick / 8) % 2 : 1}`).join(',');
    if (ekey !== this.lastEffects) {
      this.lastEffects = ekey;
      clear(this.effects);
      for (const e of fx) {
        const def = EFFECTS.get(e.id);
        if (!def) continue;
        const fading = e.dur > 0 && e.dur < 200 && Math.floor(gameTick / 8) % 2 === 0;
        const el = h('div', { class: `effect ${def.category === 'harmful' ? 'bad' : 'good'}`, title: `${t('effect.' + e.id)} ${roman(e.amp + 1)}` },
          h('img', { src: effectIcon(e.id, def.color), alt: '', draggable: 'false' }));
        if (fading) el.style.opacity = '0.35';
        this.effects.appendChild(el);
      }
    }
    // Overlays
    this.frost.style.opacity = String(Math.min(1, p.frozen / 140));
    this.vignette.style.opacity = survival && p.health <= 6 && !p.dead ? String(0.25 + 0.25 * Math.sin(gameTick / 4) ** 2) : '0';
    this.hearts.style.visibility = this.armor.style.visibility = this.food.style.visibility = survival ? '' : 'hidden';
    this.air.style.visibility = survival ? '' : 'hidden';
  }

  private armorValue(p: LocalPlayer): number {
    let v = 0;
    for (let i = 36; i < 40; i++) {
      const s = p.inventory.get(i);
      const a = getItem(s.id)?.armor;
      if (a && !s.isEmpty()) v += a.defense;
    }
    return v;
  }

  private renderHearts(p: LocalPlayer, kind: HeartKind, blink: boolean, regen: boolean, low: boolean, tick: number): void {
    clear(this.hearts);
    const containers = Math.ceil(p.maxHealth / 2);
    const absorbHearts = Math.ceil(p.absorption / 2);
    const total = containers + absorbHearts;
    const rows = Math.ceil(total / 10);
    const rowGap = Math.max(10 - (rows - 2), 3);
    const health = Math.ceil(p.health);
    const regenIdx = regen ? tick % (containers + 5) : -1;
    const seed = (i: number) => ((Math.sin(i * 12.9898 + tick * 78.233) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < total; i++) {
      const row = Math.floor(i / 10), col = i % 10;
      let src: string;
      if (i < containers) {
        const hv = health - i * 2;
        const fill: 0 | 1 | 2 = hv >= 2 ? 2 : hv === 1 ? 1 : 0;
        src = heartIcon(kind, fill, this.hardcore, blink);
      } else {
        const av = Math.ceil(p.absorption) - (i - containers) * 2;
        src = heartIcon('absorb', av >= 2 ? 2 : 1, this.hardcore, false);
      }
      let dy = 0;
      if (low) dy += Math.floor(seed(i) * 2);
      if (i === regenIdx) dy -= 2;
      const el = h('i', { style: { left: `${col * 8 * 0.125}em`, bottom: `${(row * rowGap - dy) * 0.125}em`, backgroundImage: `url(${src})` } });
      this.hearts.appendChild(el);
    }
    this.hearts.dataset['rows'] = String(rows);
    const extra = (rows - 1) * rowGap * 0.125;
    this.armor.style.transform = `translateY(-${extra}em)`;
  }

  private renderArmor(v: number): void {
    clear(this.armor);
    if (v <= 0) return;
    for (let i = 0; i < 10; i++) {
      const fill: 0 | 1 | 2 = v >= i * 2 + 2 ? 2 : v === i * 2 + 1 ? 1 : 0;
      this.armor.appendChild(h('i', { style: { left: `${i * 8 * 0.125}em`, backgroundImage: `url(${armorIcon(fill)})` } }));
    }
  }

  private renderFood(p: LocalPlayer, hunger: boolean, tick: number): void {
    clear(this.food);
    const shake = p.saturation <= 0 && tick % (p.food * 3 + 1) === 0;
    for (let i = 0; i < 10; i++) {
      const v = p.food - i * 2;
      const fill: 0 | 1 | 2 = v >= 2 ? 2 : v === 1 ? 1 : 0;
      const dy = shake ? ((i + tick) % 3) - 1 : 0;
      // Food fills from the right
      this.food.appendChild(h('i', { style: { right: `${i * 8 * 0.125}em`, bottom: `${-dy * 0.125}em`, backgroundImage: `url(${foodIcon(fill, hunger)})` } }));
    }
  }

  private renderAir(p: LocalPlayer): void {
    clear(this.air);
    if (p.air >= p.maxAir) return;
    const full = Math.ceil(((p.air - 2) * 10) / p.maxAir);
    const partial = Math.ceil((p.air * 10) / p.maxAir) - full;
    for (let i = 0; i < full + partial && i < 10; i++) {
      this.air.appendChild(h('i', { style: { right: `${i * 8 * 0.125}em`, backgroundImage: `url(${bubbleIcon(i >= full)})` } }));
    }
  }
}

function attackSpeedOf(p: LocalPlayer): number {
  const tool = getItem(p.inventory.mainHand.id)?.tool;
  return tool ? tool.attackSpeed : 4;
}

export function roman(n: number): string {
  const r: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, c] of r) while (n >= v) { s += c; n -= v; }
  return s;
}
