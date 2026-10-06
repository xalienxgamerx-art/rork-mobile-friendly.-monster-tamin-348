import { advance, creatureAt, newGame, previewStarter } from "../src/game/sim";
import { BIOMES, ITEMS } from "../src/game/data";
import { createTerritory } from "../src/game/territory";
import { partyMonAt } from "../src/game/combat";
import { makeReproProfile, wildReproMode } from "../src/game/reproduction";
import { wildGenotypeFromSeed } from "../src/game/genetics";
import { getWorld } from "../src/game/world";
import type { WildCreature } from "../src/game/types";

const g = newGame("WILD-1", "R", "wanderer", "#e8742a", previewStarter("WILD-1", "slimekin"));
g.party[0].level = 12;
g.party[0].hp = 999;
const w = getWorld(g.seed);
let base: { x: number; y: number } | null = null;
for (let r = 500; r < 1600 && !base; r += 40) {
  for (let a = 0; a < 16 && !base; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const x = Math.round(g.player.x + Math.cos(ang) * r);
    const y = Math.round(g.player.y + Math.sin(ang) * r);
    const b = w.inBounds(x, y) ? BIOMES[w.tile(x, y).biome] : null;
    if (b && b.passable && b.forage.some(([it]) => ITEMS[it].diets.includes("omnivore")) && !w.siteAt(x, y)) base = { x, y };
  }
}
if (!base) throw new Error("no base");
console.log("base biome:", w.tile(base.x, base.y).biome);
for (const id of Object.keys(g.creatures)) delete g.creatures[id];
g.player.x = base.x;
g.player.y = base.y;
const cheb2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const mkWild = (id: string, speciesId: string, near: { x: number; y: number }, maxR = 6, satiety = 80): WildCreature => {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = near.x + dx;
        const y = near.y + dy;
        if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y) || (x === g.player.x && y === g.player.y)) continue;
        const c: WildCreature = {
          id, speciesId, level: 6, x, y, homeX: x, homeY: y, hpFrac: 1, satiety,
          disposition: "calm", activity: "Wandering", personality: "gentle", geneSeed: 777,
          genes: wildGenotypeFromSeed(777, speciesId), gen: 1, lineageId: `L:${id}`,
          repro: makeReproProfile(wildReproMode(id, speciesId), 6, 0), calmUntil: g.tick + 100000, alpha: false,
          affection: 0, stalking: false,
        };
        g.creatures[id] = c;
        return c;
      }
    }
  }
  throw new Error("no spot for " + id);
};

// A: hungry
const hungry = mkWild("p:hungry", "slimekin", base, 6, 10);
const s0 = hungry.satiety;
for (let i = 0; i < 14; i++) {
  advance(g, 10);
  const t = w.tile(hungry.x, hungry.y);
  console.log("A", { i, alive: !!g.creatures["p:hungry"], sat: Math.round(hungry.satiety), x: hungry.x - base.x, y: hungry.y - base.y, biome: t.biome, act: hungry.activity, dep: g.depleted[`${hungry.x},${hungry.y}`] !== undefined });
  if (!g.creatures["p:hungry"]) break;
}

// B: homing
const t = createTerritory(g, "cragjaw", base.x + 30, base.y + 30);
const homing = mkWild("p:home", "cragjaw", { x: base.x + 46, y: base.y + 30 }, 6, 80);
homing.territoryId = t.id;
console.log("B start d:", cheb2(homing, t), "biome:", w.tile(homing.x, homing.y).biome);
for (let i = 0; i < 12; i++) {
  advance(g, 1);
  console.log("B", { i, d: cheb2(homing, t), act: homing.activity, moves: w.tile(homing.x, homing.y).biome });
}

// C: hawk/snack
const hawk = mkWild("p:hawk", "zephyr_hawk", base, 5, 20);
hawk.level = 8;
const snack = mkWild("p:snack", "slimekin", hawk, 3, 80);
console.log("C start d:", cheb2(hawk, snack));
for (let i = 0; i < 10; i++) {
  advance(g, 2);
  console.log("C", { i, alive: !!g.creatures["p:snack"], d: cheb2(hawk, snack), hawkAct: hawk.activity, snackAct: snack.activity });
  if (!g.creatures["p:snack"]) break;
}
