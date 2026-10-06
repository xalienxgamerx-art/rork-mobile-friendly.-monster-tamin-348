/* Headless sanity check for the knowledge/perception/mapview systems + live combat. */
import { discoveredList, ensureKnowledge, tileVisibility, anyExplored, exploredWorldCells, isRegionSeen } from "../src/game/knowledge";
import { aggrOf, avOf, dvOf, engage, hitInfo, initField, partyFighter, partyMonAt, queueSkill, setAggr, setOrder, setTarget, terrainAt, wildFighter } from "../src/game/combat";
import { CHUNK, advance, chunkKey, creatureAt, loadChunks, newGame, movePlayer, previewStarter, requestBreeding, spawnLairPack, waitTurn, wildToMonster } from "../src/game/sim";
import { BIOMES, DAY_TICKS, ITEMS, SCARVES, SPECIES, footprintOf, developmentTypeFor } from "../src/game/data";
import { abandonNestsOf, advanceDevelopment, beginBreeding, destroyNest, migrateBreeding, offspringSpecies, planChild, previewBreeding } from "../src/game/breeding";
import { Factions, getFactions, migrateFactionKnowledge } from "../src/game/factions";
import { GENE_KEYS, driftGenome, expressGene, getGeneGrade, getMonsterFootprint, inheritGene, inheritGenome, migrateBiology, migrateCreatureBio, migrateMonsterBio, migrateMonsterGenes, mutateDelta, mutateGene, sanitizeGenome, sizeToFootprint, wildGenotypeFromSeed } from "../src/game/genetics";
import { createMonster, displayName, migrateMonsterSex, rollSex, statOf, statsOf } from "../src/game/monster";
import { canMate } from "../src/game/mating";
import { BREED_COOLDOWN_TICKS, DEVELOP_TICKS, MATURITY_LEVEL, advanceReproduction, beginReproduction, canReproduce, isBreedingAvailable, makeReproProfile, migrateRepro, migrateReproCreature, migrateReproMon, maturityFor, reproStateOf, wildReproMode } from "../src/game/reproduction";
import { Rng, hashString } from "../src/game/rng";
import { hasLOS } from "../src/game/perception";
import { sampleCell } from "../src/game/mapview";
import { getWorld, seedFromText, type Feature } from "../src/game/world";
import type { ChildBlueprint, Disposition, DistantRegion, GameState, GeneKey, GenePair, Genes, Genome, ItemId, Monster, ReproductiveDevelopment, Sex, WildCreature } from "../src/game/types";
import { childrenOf, lineageSummary, migrateLineages, recordLineageBirth, relatedness } from "../src/game/lineage";
import { profileOf, seizeTerritory } from "../src/game/wildlife";
import { DISTANT_INTERVAL, MAT_CAP_REGION, advanceDistantEcosystem, distantKey, migrateDistant, stepRegion } from "../src/game/distant";
import { CARRION_CAP, CARRION_DAYS, migrateCarrion, spawnCarrion } from "../src/game/carrion";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { HERO_ASPECT, isScarfPixel, parseHex, scarfShade } from "../src/game/scarf";
import { defringeEdges, stripBlackBackground, type RawImage } from "../src/game/spritebg";
import { ensureTerritory, homeAnchor, migrateTerritories, releaseTerritoryOwner, territoryAt } from "../src/game/territory";
import { decodePng } from "./sprites";
import {
  CAVE_UPPER, NEWBORN_TICKS, bodyFootprint, foodDemand, footprintClass, growthSpan, matureAgeOf, migrateGrowth, physicalSize, stageOf,
} from "../src/game/growth";
import {
  CREATURE_CAP, ECOLOGY_INTERVAL, adultMortalityChance, allowsBreeding, assessTerritory, buildCensus, ecoOnBirth, ecoOnDeath, ecologyTick,
  juvenileMortalityChance, migrateEcology, resolveGrowth, spawnAllowedByEcology,
} from "../src/game/ecology";
import { attachNest, createTerritory } from "../src/game/territory";
import { createNest } from "../src/game/breeding";
import {
  CAVE_DEEP, CAVE_FAUNA, CAVE_SIGHT, CAVE_UPPER, PIN_CORE, PIN_RAMP, PLAYER_MOVER, SURFACE, bodyLevelOk, fallDamage, fallLevels, groundInfo, heightEdge,
  heightLOS, heightOf, layerOf, migrateHeight, moverOf, stepRule, walkable,
} from "../src/game/height";
import { changeLayer } from "../src/game/sim";
import { World, findPath } from "../src/game/world";
import { sightRadius } from "../src/game/perception";

let fails = 0;
const ok = (cond: boolean, label: string): void => {
  if (!cond) {
    fails++;
    console.log(`FAIL ${label}`);
  } else console.log(`ok   ${label}`);
};

const cheb = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** Places a synthetic hostile creature on a free tile adjacent to the player. */
const placeAdjacent = (gs: GameState, id: string, speciesId: string, level: number): WildCreature | null => {
  const world = getWorld(gs.seed);
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (const [dx, dy] of dirs) {
    const x = gs.player.x + dx;
    const y = gs.player.y + dy;
    if (!world.inBounds(x, y) || !world.passable(x, y) || world.siteAt(x, y)?.wall || creatureAt(gs, x, y) || partyMonAt(gs, x, y)) continue;
    const c: WildCreature = {
      id, speciesId, level, x, y, homeX: x, homeY: y,
      hpFrac: 1, satiety: 60, disposition: "aggressive", activity: "Wandering", personality: "fierce",
      geneSeed: 424242, genes: wildGenotypeFromSeed(424242, speciesId), gen: 1, lineageId: `L:${id}`,
      repro: makeReproProfile(wildReproMode(id, speciesId), level, 0),
      calmUntil: 0, alpha: false, affection: 0, stalking: false,
    };
    gs.creatures[id] = c;
    return c;
  }
  return null;
};

const gs = newGame("MAPCHECK-1", "Rook", "ranger", "#e8742a", previewStarter("MAPCHECK-1", "mossback"));
// the walker needs a party that can survive random live encounters
gs.party[0].level = 20;
gs.party[0].hp = statOf(gs.party[0], "hp");
ok(gs.party.length === 1, "party has starter");
ok(gs.field[gs.party[0].uid] !== undefined, "starter deployed beside the player at start");
ok(!!gs.knowledge && Object.keys(gs.knowledge.explored).length >= 2, "start area revealed");
ok(discoveredList(gs.knowledge).some((d) => d.kind === "hamlet"), "home hamlet discovered");
ok(isRegionSeen(gs.knowledge, gs.player.x, gs.player.y), "start region seen");

const world = getWorld(gs.seed);
const before = Object.keys(gs.knowledge.explored).length;
ok(tileVisibility(gs, gs.player.x, gs.player.y) === "visible", "player tile visible");
ok(tileVisibility(gs, gs.player.x + 200, gs.player.y + 200) === "fog", "far tile is fog");

// Adaptive walk: rotate direction when terrain/creatures block the way.
const startX = gs.player.x;
const startY = gs.player.y;
let minX = startX;
let maxX = startX;
let minY = startY;
let maxY = startY;
let midPos: { x: number; y: number } | null = null;
const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
let di = 0;
let guard = 0;
while (gs.stats.steps < 150 && guard < 500) {
  guard++;
  const [dx, dy] = dirs[di % dirs.length];
  const px0 = gs.player.x;
  const py0 = gs.player.y;
  movePlayer(gs, dx, dy);
  if (gs.player.x === px0 && gs.player.y === py0) di++;
  else {
    di = 0;
    minX = Math.min(minX, gs.player.x);
    maxX = Math.max(maxX, gs.player.x);
    minY = Math.min(minY, gs.player.y);
    maxY = Math.max(maxY, gs.player.y);
    if (!midPos && gs.stats.steps >= 75) midPos = { x: gs.player.x, y: gs.player.y };
  }
}
const steps = gs.stats.steps;
ok(steps >= 100, `walked ${steps} steps`);
const after = Object.keys(gs.knowledge.explored).length;
const bboxCells = Math.max(2, Math.floor(((maxX - minX + 1) * (maxY - minY + 1)) / 64));
ok(after > before, `exploration grows (${before} -> ${after}, bbox ≈ ${bboxCells} cells)`);
ok(after >= bboxCells * 0.7, `explored covers walked bbox (${after} vs ${bboxCells})`);
ok(gs.knowledge.route.length >= 8, `route breadcrumbs (${gs.knowledge.route.length} for ${steps} steps)`);
ok(tileVisibility(gs, gs.player.x, gs.player.y) === "visible", "current tile visible after walk");

// memory: where the player came from is remembered, not fog
const far = Math.max(Math.abs(startX - gs.player.x), Math.abs(startY - gs.player.y));
if (far > 15) ok(tileVisibility(gs, startX, startY) === "memory", `left-behind area is memory (${far} tiles away)`);
else console.log(`skip left-behind check (wandered back, ${far} tiles)`);

// no leak: every discovery was made within sight of somewhere the player traveled
ok(
  discoveredList(gs.knowledge).every((d) =>
    [[startX, startY], ...gs.knowledge.route].some(([rx, ry]) => Math.max(Math.abs(d.x - rx), Math.abs(d.y - ry)) <= 30),
  ),
  "all discoveries near traveled route",
);

// LOS sanity
ok(hasLOS(world, 10, 10, 12, 10), "flat LOS true");

// map aggregation: cached and stable per seed
const s1 = sampleCell("region", world, gs.player.x, gs.player.y);
const s2 = sampleCell("world", world, gs.player.x, gs.player.y);
ok(!!s1 && !!s2, "samples exist");
ok(sampleCell("region", world, gs.player.x, gs.player.y).biome === s1.biome, "region sample cached & stable");
ok(sampleCell("world", world, gs.player.x, gs.player.y).biome === s2.biome, "world sample cached & stable");

// explored roll-up
const wc = exploredWorldCells(gs.knowledge);
ok(wc.size > 0 && anyExplored(gs.knowledge, gs.player.x - 8, gs.player.y - 8, gs.player.x + 8, gs.player.y + 8), "explored roll-up works");

// ---- Physical landmark sites (walls, floors, doors) ----
const kindsNear = (kind: string): Feature | null => {
  const fs = world.featuresNear(gs.player.x, gs.player.y, 900).filter((f) => f.kind === kind);
  return fs[0] ?? null;
};

const hamlet = kindsNear("hamlet");
ok(!!hamlet, "a hamlet exists nearby");
if (hamlet) {
  const center = world.siteAt(hamlet.x, hamlet.y);
  ok(!!center && !center.wall, "hamlet center is open plaza");
  let walls = 0;
  let doors = 0;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const s = world.siteAt(hamlet.x + dx, hamlet.y + dy);
      if (!s) continue;
      if (s.wall) walls++;
      if (s.door) doors++;
    }
  }
  ok(walls > 8, `hamlet has hut walls (${walls})`);
  ok(doors >= 2, `hamlet has doorways (${doors})`);
  ok(!world.passable(hamlet.x - 4, hamlet.y - 4), "hut wall blocks movement (passable=false)");
  const npcs = world.hamletNpcs(hamlet);
  ok(npcs.length === 3, `hamlet has three folk (${npcs.length})`);
  ok(npcs.every((n) => world.passable(n.x, n.y)), "folk stand on walkable tiles");
  ok(npcs.every((n) => !world.siteAt(n.x, n.y)?.wall && !world.siteAt(n.x, n.y)?.door), "folk stand clear of walls and doorways");
  ok(!!world.npcAt(npcs[0].x, npcs[0].y) && world.npcAt(npcs[0].x, npcs[0].y)!.name === npcs[0].name, "npcAt finds folk at their post");
  ok(world.npcAt(npcs[0].x + 3, npcs[0].y + 3) === null, "no folk on empty tiles");
  const w3 = new (world.constructor as new (seed: number) => typeof world)(world.seed);
  ok(w3.hamletNpcs(hamlet)[0].name === npcs[0].name, "folk are seed-deterministic");
}

const ruin = kindsNear("ruin");
ok(!!ruin, "a ruin exists nearby");
if (ruin) {
  let rw = 0;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (world.siteAt(ruin.x + dx, ruin.y + dy)?.wall) rw++;
  ok(rw > 5, `ruin has broken walls (${rw})`);
}

const lair = kindsNear("lair");
ok(!!lair, "a lair exists nearby");
if (lair) {
  ok(!!world.siteAt(lair.x, lair.y) && !world.siteAt(lair.x, lair.y)!.wall, "lair den floor is open");
  let ring = 0;
  for (let a = 0; a < 24; a++) {
    const x = lair.x + Math.round(Math.cos((a / 24) * Math.PI * 2) * 4.4);
    const y = lair.y + Math.round(Math.sin((a / 24) * Math.PI * 2) * 4.4);
    if (world.siteAt(x, y)?.wall) ring++;
  }
  ok(ring >= 13, `lair enclosed by rock walls (${ring}/24 ring samples)`);
  // live combat samples real site walls 1:1 as blocking terrain
  let wallTerrain = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const tx = lair.x + dx;
      const ty = lair.y + dy;
      if (world.siteAt(tx, ty)?.wall && terrainAt(gs, tx, ty) === "wall") wallTerrain++;
    }
  }
  ok(wallTerrain > 5, `combat terrain matches the real den walls (${wallTerrain})`);
}

// determinism across World instances
if (hamlet) {
  const w2 = new (world.constructor as new (seed: number) => typeof world)(world.seed);
  ok(!!w2.siteAt(hamlet.x - 4, hamlet.y - 4) === !!world.siteAt(hamlet.x - 4, hamlet.y - 4), "sites are seed-deterministic across instances");
}

// LOS is cut by site walls
if (ruin) {
  outerWall: for (let y = ruin.y - 4; y <= ruin.y + 4; y++) {
    for (let x = ruin.x - 3; x <= ruin.x + 2; x++) {
      if (world.siteAt(x, y)?.wall && !world.siteAt(x + 1, y)?.wall && !world.siteAt(x - 1, y)?.wall) {
        ok(!hasLOS(world, x - 1, y, x + 1, y), "site wall blocks line of sight");
        break outerWall;
      }
    }
  }
}

// movement into a wall is refused
if (hamlet) {
  seek: for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const wx = hamlet.x + dx;
      const wy = hamlet.y + dy;
      if (world.siteAt(wx, wy)?.wall && world.passable(wx, wy - 1) && !world.siteAt(wx, wy - 1)?.door) {
        gs.player.x = wx;
        gs.player.y = wy + 1;
        const before2 = gs.stats.steps;
        const r = movePlayer(gs, 0, -1);
        ok(!r.ok && gs.stats.steps === before2, "movePlayer refuses to walk into a wall");
        break seek;
      }
    }
  }
  gs.player.x = gs.player.homeX;
  gs.player.y = gs.player.homeY;
}

// size tiers: Titanic (4×4), Huge (3×3), Large (2×2), normal (1×1)
ok(
  footprintOf(SPECIES["sunwyrm"]) === 4 && footprintOf(SPECIES["ironfang_tyrant"]) === 4,
  "titanic tier is 4×4 (sunwyrm, tyrant)",
);
ok(
  footprintOf(SPECIES["crystal_golem"]) === 3 && footprintOf(SPECIES["stormmane_drake"]) === 3,
  "huge tier is 3×3 (golem, stormmane)",
);
ok(
  footprintOf(SPECIES["skyhorn_dragon"]) === 2 && footprintOf(SPECIES["mandrake_maw"]) === 2 && footprintOf(SPECIES["jade_spikeon"]) === 2,
  "large tier is 2×2 (skyhorn, mandrake, spikeon)",
);
ok(
  footprintOf(SPECIES["mossback"]) === 1 && footprintOf(SPECIES["cindermaw"]) === 1 && footprintOf(SPECIES["tidefin_toad"]) === 1,
  "starters and small species stay 1×1",
);

// a huge wild creature blocks every tile of its footprint on the local map
{
  let spot: [number, number] | null = null;
  seekBig: for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const x = gs.player.homeX + dx;
      const y = gs.player.homeY + dy;
      let clear = true;
      for (let oy = 0; oy < 3 && clear; oy++) {
        for (let ox = 0; ox < 4; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (!world.passable(tx, ty) || world.siteAt(tx, ty)?.wall || world.npcAt(tx, ty) || creatureAt(gs, tx, ty)) {
            clear = false;
            break;
          }
        }
      }
      if (clear) {
        spot = [x, y];
        break seekBig;
      }
    }
  }
  ok(!!spot, "found open ground for a huge creature test");
  if (spot) {
    const [sx, sy] = spot;
    const px0 = gs.player.x;
    const py0 = gs.player.y;
    gs.player.x = sx;
    gs.player.y = sy;
    const big: WildCreature = {
      id: "big:1", speciesId: "crystal_golem", level: 6, x: sx + 1, y: sy, homeX: sx + 1, homeY: sy,
      hpFrac: 1, satiety: 60, disposition: "calm", activity: "Wandering", personality: "gentle",
      geneSeed: 999, calmUntil: gs.tick + 1000, alpha: false, affection: 0, stalking: false,
    };
    gs.creatures["big:1"] = big;
    const r1 = movePlayer(gs, 1, 0);
    ok(!r1.ok && gs.player.x === sx && gs.player.y === sy, "player blocked by huge creature's anchor tile");
    const r2 = movePlayer(gs, 1, 0);
    ok(!r2.ok && gs.player.x === sx && gs.player.y === sy, "player blocked by huge creature's covered tile");
    delete gs.creatures["big:1"];
    // a Huge (3×3) creature blocks all nine tiles of its body
    const big3: WildCreature = {
      id: "big:3", speciesId: "stormmane_drake", level: 7, x: sx + 1, y: sy, homeX: sx + 1, homeY: sy,
      hpFrac: 1, satiety: 60, disposition: "calm", activity: "Wandering", personality: "gentle",
      geneSeed: 998, calmUntil: gs.tick + 1000, alpha: false, affection: 0, stalking: false,
    };
    gs.creatures["big:3"] = big3;
    const rows3 = [0, 1, 2].map((k) => {
      gs.player.x = sx;
      gs.player.y = sy + k;
      const r = movePlayer(gs, 1, 0);
      return !r.ok && gs.player.x === sx && gs.player.y === sy + k;
    });
    ok(rows3.every(Boolean), "player blocked by Huge creature's full 3×3 body");
    ok(
      ([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const).every(
        ([ox, oy]) => creatureAt(gs, sx + 1 + ox, sy + oy) === big3,
      ),
      "creatureAt covers all nine Huge tiles",
    );
    delete gs.creatures["big:3"];
    gs.player.x = px0;
    gs.player.y = py0;
  }
}

/* ------------------------------ LIVE COMBAT ---------------------------------- */

// bumping a hostile creature engages it live (no arena handoff)
{
  const g = newGame("ENGAGE-1", "Rook", "ranger", "#e8742a", previewStarter("ENGAGE-1", "mossback"));
  const foe = placeAdjacent(g, "t:1", "slimekin", 3);
  ok(!!foe, "placed a hostile beside the player");
  if (foe) {
    const r = movePlayer(g, foe.x - g.player.x, foe.y - g.player.y);
    ok(!!r.engaged && r.engaged === "t:1", "bumping a hostile engages it live");
    ok(g.target === "t:1" && g.creatures["t:1"]?.stalking === true, "engagement marks the party target");
    ok(g.stats.battles === 1, "engagement counted");
  }
}

// autonomous exchange: the fight resolves over ticks and kills pay out
{
  const g = newGame("FIGHT-1", "Rook", "ranger", "#e8742a", previewStarter("FIGHT-1", "mossback"));
  const foe = placeAdjacent(g, "f:1", "slimekin", 3);
  ok(!!foe, "fight: hostile placed");
  if (foe) {
    movePlayer(g, foe.x - g.player.x, foe.y - g.player.y);
    const gold0 = g.player.gold;
    const xp0 = g.party[0].xp + g.party[0].level;
    for (let i = 0; i < 60 && g.creatures["f:1"]; i++) waitTurn(g, 1);
    ok(!g.creatures["f:1"], "the engaged creature was defeated autonomously");
    ok(g.removed["f:1"] !== undefined, "defeat recorded in removed");
    ok(g.player.gold > gold0 || Object.values(g.bag).some((n) => (n ?? 0) > 0), "kill paid out gold or drops");
    ok(g.party[0].xp + g.party[0].level > xp0, "kill granted XP");
    ok(g.log.some((l) => l.kind === "combat"), "combat strikes were logged");
  }
}

// determinism: same seed + same actions replay the exact same fight
{
  const run = (): string => {
    const g = newGame("DETERMIN-1", "Rook", "ranger", "#e8742a", previewStarter("DETERMIN-1", "mossback"));
    const foe = placeAdjacent(g, "d:1", "slimekin", 3);
    if (!foe) return "skip";
    movePlayer(g, foe.x - g.player.x, foe.y - g.player.y);
    for (let i = 0; i < 40 && g.creatures["d:1"]; i++) waitTurn(g, 1);
    return JSON.stringify({ hp: g.party.map((m) => m.hp), gold: g.player.gold, tick: g.tick, gone: !g.creatures["d:1"] });
  };
  const r1 = run();
  const r2 = run();
  ok(r1 === r2 && r1 !== "skip", "same seed and actions reproduce the identical fight");
}

// party follow: monsters trail the player at arm's length
{
  const g = newGame("FOLLOW-1", "Rook", "ranger", "#e8742a", previewStarter("FOLLOW-1", "mossback"));
  const uid = g.party[0].uid;
  for (let i = 0; i < 6; i++) movePlayer(g, 1, 0);
  const pos = g.field[uid]!;
  const d = cheb(pos.x, pos.y, g.player.x, g.player.y);
  ok(d <= 3, `follower keeps pace (${d} tiles behind)`);
}

// hold order: a holding monster keeps its ground while the player moves away
{
  const g = newGame("HOLD-1", "Rook", "ranger", "#e8742a", previewStarter("HOLD-1", "mossback"));
  const uid = g.party[0].uid;
  setOrder(g, uid, "hold");
  const before = { ...g.field[uid]! };
  waitTurn(g, 12);
  const pos = g.field[uid]!;
  ok(pos.x === before.x && pos.y === before.y, "hold order keeps the monster in place");
}

// tap-target orders: an attacker-order monster converges on the marked creature
{
  const g = newGame("TARGET-1", "Rook", "ranger", "#e8742a", previewStarter("TARGET-1", "mossback"));
  const uid = g.party[0].uid;
  const w = getWorld(g.seed);
  let foe: WildCreature | null = null;
  for (let dx = 4; dx <= 8 && !foe; dx++) {
    for (let dy = -2; dy <= 2 && !foe; dy++) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y)) continue;
      foe = {
        id: "tg:1", speciesId: "slimekin", level: 2, x, y, homeX: x, homeY: y,
        hpFrac: 1, satiety: 80, disposition: "calm", activity: "Wandering", personality: "gentle",
        geneSeed: 777, calmUntil: g.tick + 500, alpha: false, affection: 0, stalking: false,
      };
      g.creatures[foe.id] = foe;
    }
  }
  ok(!!foe, "target: placed a calm creature nearby");
  if (foe) {
    setOrder(g, uid, "attack");
    setTarget(g, foe.id);
    const d0 = cheb(g.field[uid]!.x, g.field[uid]!.y, foe.x, foe.y);
    for (let i = 0; i < 14 && g.creatures["tg:1"]; i++) waitTurn(g, 1);
    const d1 = g.creatures["tg:1"] ? cheb(g.field[uid]!.x, g.field[uid]!.y, g.creatures["tg:1"].x, g.creatures["tg:1"].y) : 0;
    ok(d1 < d0 || !g.creatures["tg:1"], `attacker converged on its target (${d0} -> ${d1})`);
  }
}

// ordered skill: the monster paths into range, unleashes it, and provokes the mark
{
  const g = newGame("SKILLQ-1", "Rook", "ranger", "#e8742a", previewStarter("SKILLQ-1", "mossback"));
  const uid = g.party[0].uid;
  g.party[0].skills = ["ember", "bite"];
  const w = getWorld(g.seed);
  let foe: WildCreature | null = null;
  for (let dx = 5; dx <= 8 && !foe; dx++) {
    for (let dy = -2; dy <= 2 && !foe; dy++) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y)) continue;
      foe = {
        id: "sq:1", speciesId: "slimekin", level: 2, x, y, homeX: x, homeY: y,
        hpFrac: 1, satiety: 80, disposition: "calm", activity: "Wandering", personality: "gentle",
        geneSeed: 31, calmUntil: g.tick + 500, alpha: false, affection: 0, stalking: false,
      };
      g.creatures[foe.id] = foe;
    }
  }
  ok(!!foe, "skill order: placed a creature just out of range");
  if (foe) {
    queueSkill(g, uid, "ember", foe.id);
    ok(g.skillQ[uid]?.skill === "ember", "skill order queued");
    let fired = false;
    for (let i = 0; i < 12 && !fired; i++) {
      waitTurn(g, 1);
      fired = g.log.some((l) => l.text.includes("spits embers"));
    }
    ok(fired, "ordered skill fired once the monster closed in");
    ok(!g.skillQ[uid], "skill order cleared after use");
    ok(!!g.creatures["sq:1"]?.stalking, "the struck creature turns to fight back");
  }
}

// ordered self-heal: mend resolves on the monster's very next turn
{
  const g = newGame("SKILLQ-2", "Rook", "ranger", "#e8742a", previewStarter("SKILLQ-2", "mossback"));
  const uid = g.party[0].uid;
  g.party[0].skills = ["mend", "bite"];
  g.party[0].hp = 5;
  queueSkill(g, uid, "mend", uid);
  waitTurn(g, 1);
  ok(g.party[0].hp > 5, "ordered mend heals the hurt monster");
  ok(!g.skillQ[uid], "mend order cleared after use");
}

// aggression: a passive monster never starts fights, neutral retaliates
{
  const g = newGame("AGGR-1", "Rook", "ranger", "#e8742a", previewStarter("AGGR-1", "mossback"));
  const uid = g.party[0].uid;
  g.party[0].skills = ["bite"];
  setAggr(g, uid, "passive");
  ok(aggrOf(g, uid) === "passive", "aggression set to passive");
  const foe = placeAdjacent(g, "ag:1", "slimekin", 3);
  ok(!!foe, "aggression: hostile placed");
  if (foe) {
    movePlayer(g, foe.x - g.player.x, foe.y - g.player.y);
    const bite = `${displayName(g.party[0])} bites`;
    const hp0 = g.creatures["ag:1"] ? g.creatures["ag:1"].hpFrac : 1;
    for (let i = 0; i < 4; i++) waitTurn(g, 1);
    const hurt = !!g.creatures["ag:1"] && g.creatures["ag:1"].hpFrac < hp0 - 1e-9;
    const bites = g.log.some((l) => l.text.includes(bite));
    ok(!hurt && !bites, "passive monster never strikes on its own");
    setAggr(g, uid, "neutral");
    let fought = false;
    for (let i = 0; i < 6 && !fought; i++) {
      waitTurn(g, 1);
      fought = !g.creatures["ag:1"] || g.creatures["ag:1"].hpFrac < hp0 || g.log.some((l) => l.text.includes(bite));
    }
    ok(fought, "neutral monster retaliates once allowed");
  }
}

// aggressive monsters seek out hostiles further afield, unbidden
{
  const g = newGame("AGGR-2", "Rook", "ranger", "#e8742a", previewStarter("AGGR-2", "mossback"));
  const uid = g.party[0].uid;
  g.party[0].skills = ["bite"];
  setAggr(g, uid, "aggressive");
  const w = getWorld(g.seed);
  let placed = false;
  for (let dx = 8; dx <= 9 && !placed; dx++) {
    for (let dy = -1; dy <= 1 && !placed; dy++) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y)) continue;
      g.creatures["ah:1"] = {
        id: "ah:1", speciesId: "slimekin", level: 2, x, y, homeX: x, homeY: y,
        hpFrac: 1, satiety: 80, disposition: "aggressive", activity: "Wandering", personality: "fierce",
        geneSeed: 97, calmUntil: g.tick, alpha: false, affection: 0, stalking: false,
      };
      placed = true;
    }
  }
  ok(placed, "aggressive hunt: hostile placed 8 tiles out");
  const marks: string[] = [];
  const hp0: Record<string, number> = {};
  for (const c of Object.values(g.creatures)) {
    const hostile = c.stalking || (c.disposition === "aggressive" && c.calmUntil <= g.tick);
    if (hostile && cheb(c.x, c.y, g.field[uid]!.x, g.field[uid]!.y) <= 10) {
      marks.push(c.id);
      hp0[c.id] = c.hpFrac;
    }
  }
  ok(marks.includes("ah:1"), "the placed hostile is within the aggressive monster's reach");
  let provoked = false;
  for (let i = 0; i < 14 && !provoked; i++) {
    waitTurn(g, 1);
    provoked = marks.some((id) => !g.creatures[id] || g.creatures[id].stalking || g.creatures[id].hpFrac < hp0[id]);
  }
  ok(provoked, "aggressive monster hunted a hostile unbidden");
}

// a Huge (3×3) party monster deploys with a full 3×3 body on the live map
{
  const g = newGame("BIGP-1", "Rook", "ranger", "#e8742a", previewStarter("BIGP-1", "mossback"));
  const big = createMonster(g, "crystal_golem", 6, { origin: "Test", seed: 7, skills: ["crunch"] });
  big.hp = statOf(big, "hp");
  g.party.push(big);
  initField(g);
  ok(footprintOf(SPECIES["crystal_golem"]) === 3, "huge party member has a 3×3 footprint");
  const pos = g.field[big.uid]!;
  ok(
    ([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const).every(
      ([ox, oy]) => partyMonAt(g, pos.x + ox, pos.y + oy) === big,
    ),
    "partyMonAt covers the whole 3×3 party body",
  );
  ok(!(pos.x === g.player.x && pos.y === g.player.y), "huge body does not overlap the player");
}

// a Titanic (4×4) party monster deploys with a full 4×4 body; a wild titan covers all 16 tiles
{
  const g = newGame("TITAN-1", "Rook", "ranger", "#e8742a", previewStarter("TITAN-1", "mossback"));
  const titan = createMonster(g, "sunwyrm", 8, { origin: "Test", seed: 11, skills: ["bite"] });
  titan.hp = statOf(titan, "hp");
  g.party.push(titan);
  initField(g);
  ok(footprintOf(SPECIES["sunwyrm"]) === 4, "sunwyrm is Titanic (4×4)");
  const pos = g.field[titan.uid]!;
  const tiles: [number, number][] = [];
  for (let oy = 0; oy < 4; oy++) for (let ox = 0; ox < 4; ox++) tiles.push([ox, oy]);
  ok(
    tiles.every(([ox, oy]) => partyMonAt(g, pos.x + ox, pos.y + oy) === titan),
    "partyMonAt covers the whole 4×4 party body",
  );
  ok(
    !(pos.x <= g.player.x && g.player.x < pos.x + 4 && pos.y <= g.player.y && g.player.y < pos.y + 4),
    "titanic body does not overlap the player",
  );
  const w = getWorld(g.seed);
  let spot: [number, number] | null = null;
  seekT: for (let dy = -9; dy <= 9 && !spot; dy++) {
    for (let dx = -9; dx <= 9 && !spot; dx++) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      let clear = true;
      for (let oy = 0; oy < 4 && clear; oy++) {
        for (let ox = 0; ox < 4; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (!w.inBounds(tx, ty) || !w.passable(tx, ty) || w.siteAt(tx, ty)?.wall || creatureAt(g, tx, ty) || partyMonAt(g, tx, ty) || (tx === g.player.x && ty === g.player.y)) {
            clear = false;
            break;
          }
        }
      }
      if (clear) spot = [x, y];
    }
  }
  ok(!!spot, "found open ground for a wild titanic creature");
  if (spot) {
    const [sx, sy] = spot;
    g.creatures["titan:1"] = {
      id: "titan:1", speciesId: "ironfang_tyrant", level: 9, x: sx, y: sy, homeX: sx, homeY: sy,
      hpFrac: 1, satiety: 70, disposition: "calm", activity: "Wandering", personality: "fierce",
      geneSeed: 4242, calmUntil: g.tick + 1000, alpha: true, affection: 0, stalking: false,
    };
    ok(
      tiles.every(([ox, oy]) => creatureAt(g, sx + ox, sy + oy)?.id === "titan:1"),
      "creatureAt covers all 16 tiles of a wild titan",
    );
    delete g.creatures["titan:1"];
  }
}

// lairs: the den holds an alpha with a loyal pack that fights for it
{
  const g = newGame("LAIR-1", "Rook", "ranger", "#e8742a", previewStarter("LAIR-1", "mossback"));
  // a sturdy party: the sub-tests must not end in a wipe (which would teleport the player home)
  g.party[0].level = 40;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  const lairs = w.featuresNear(g.player.x, g.player.y, 4096).filter((f) => f.kind === "lair" && f.speciesId);
  ok(lairs.length > 0, "lair pack: a lair exists in the world");
  let alpha: WildCreature | null = null;
  for (const f of lairs) {
    spawnLairPack(g, w, f);
    const a = g.creatures[`l:${f.x}:${f.y}`];
    if (a) {
      alpha = a;
      break;
    }
  }
  ok(!!alpha && alpha.alpha, "the lair's alpha stands in its den");
  const pack = alpha ? Object.values(g.creatures).filter((o) => o.pack === alpha!.id) : [];
  ok(pack.length >= 2 && pack.length <= 5, `the alpha has a loyal pack (${pack.length})`);
  ok(pack.every((o) => o.speciesId === alpha!.speciesId && o.level < alpha!.level), "packmates share the species and rank below their alpha");
  if (alpha && pack.length) {
    // engaging one minion calls the alpha and the rest of the pack
    engage(g, pack[0].id, false);
    ok(alpha.stalking && pack.slice(1).some((o) => o.stalking), "engaging one minion calls the alpha and the rest of the pack");
    for (const o of [alpha, ...pack]) o.stalking = false;
    g.target = null;
    // protection: an intruder at the den draws the guards (clear of the home hamlet so wild AI runs)
    seekOpen: for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const tx0 = g.player.x + dx;
        const ty0 = g.player.y + dy;
        if (w.inBounds(tx0, ty0) && w.passable(tx0, ty0) && !w.tile(tx0, ty0).feature && !creatureAt(g, tx0, ty0)) {
          g.player.x = tx0;
          g.player.y = ty0;
          break seekOpen;
        }
      }
    }
    // no bystanders: a stray predator would spook the alpha before it commands
    for (const id in g.creatures) {
      const o = g.creatures[id];
      if (o === alpha || o.pack === alpha.id) continue;
      if (cheb(o.x, o.y, g.player.x, g.player.y) <= 12) delete g.creatures[id];
    }
    alpha.x = g.player.x + 2;
    alpha.y = g.player.y;
    for (const o of pack) {
      o.x = g.player.x + 3;
      o.y = g.player.y;
      o.satiety = 12;
    }
    alpha.satiety = 12;
    alpha.disposition = "aggressive";
    waitTurn(g, 1);
    const guarded = pack.some((o) => o.stalking);
    waitTurn(g, 5);
    ok(guarded && g.log.some((l) => l.text.includes("bellows") || l.kind === "combat"), "the pack guards its alpha and fights for it");
    // loyalty ends with the alpha
    delete g.creatures[alpha.id];
    delete g.removed[alpha.id];
    const stray = pack[0];
    stray.x = g.player.x + 2;
    stray.y = g.player.y;
    advance(g, 2);
    ok(!stray.pack && stray.disposition === "skittish", "a minion whose alpha falls loses its loyalty and scatters");
  }
}

// fire burns out to ash on the live map
{
  const g = newGame("FIRE-1", "Rook", "ranger", "#e8742a", previewStarter("FIRE-1", "mossback"));
  let k: string | null = null;
  scan: for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const x = g.player.x + dx;
      const y = g.player.y + dy;
      if (["grass", "tallgrass", "flowers"].includes(terrainAt(g, x, y))) {
        k = `${x},${y}`;
        break scan;
      }
    }
  }
  if (k) {
    g.ground[k] = { fire: 1 };
    waitTurn(g, 1);
    ok(!g.ground[k]?.fire, "fire burns out after its fuel is spent");
    ok(g.ground[k]?.t === "ash", "burnt ground turns to ash");
  } else console.log("skip fire check (no flammable ground near the start)");
}

// balance parity: the ported arena formulas produce the same numbers
{
  const g = newGame("PARITY-1", "Rook", "scholar", "#e8742a", previewStarter("PARITY-1", "mossback"));
  const mon = g.party[0];
  const f = partyFighter(g, mon);
  const st = statsOf(mon);
  const dvBase = 6 + Math.floor(st.agi / 4);
  const dv = dvOf(g, f);
  ok(dv === dvBase || dv === dvBase + 2, `DV formula intact (base ${dvBase}, got ${dv})`);
  ok(avOf(g, f) === Math.floor(st.def / 5), "AV formula intact (mossback has no AV traits)");
  const foe = placeAdjacent(g, "p:1", "slimekin", 5);
  if (foe) {
    const ff = wildFighter(g, foe);
    const hi = hitInfo(g, f, ff, "shell_bash");
    let n = 1;
    for (let r = 2; r <= 19; r++) if (r + hi.bonus >= hi.dv) n++;
    ok(Math.abs(hi.chance - n / 20) < 1e-9, "hit chance follows the d20 formula");
  }
}

// save round trip: live-combat state persists
const json = JSON.stringify(gs);
const loaded = JSON.parse(json);
ok(loaded.version === 19, "save version 19");
ok(loaded.field && loaded.orders && loaded.ground && loaded.fighters && loaded.aggr && loaded.skillQ && "target" in loaded, "live-combat state persists");
ok(Object.keys(loaded.knowledge.explored).length === after, "explored persists exactly");

// v4 → v5 migration: old saves deploy the party at the player's side
{
  const v4 = JSON.parse(json) as GameState & { version: number };
  delete v4.field;
  delete v4.orders;
  delete v4.target;
  delete v4.ground;
  delete v4.fighters;
  (v4 as unknown as { field: GameState["field"] }).field = {};
  (v4 as unknown as { orders: GameState["orders"] }).orders = {};
  (v4 as unknown as { target: null }).target = null;
  (v4 as unknown as { ground: GameState["ground"] }).ground = {};
  (v4 as unknown as { fighters: GameState["fighters"] }).fighters = {};
  v4.version = 4;
  initField(v4);
  ok(v4.party.every((m) => !!v4.field[m.uid]), "v4 migration deploys the party at the player's side");
  ok(Object.values(v4.field).every((p) => cheb(p.x, p.y, v4.player.x, v4.player.y) <= 8), "migrated party placed near the player");
}

// v5 → v6 migration: commanded skills and aggression backfill (same normalization loadSave applies)
{
  const v5 = JSON.parse(json) as GameState & { version: number };
  delete v5.aggr;
  delete v5.skillQ;
  v5.version = 5;
  v5.aggr = v5.aggr ?? {};
  v5.skillQ = v5.skillQ ?? {};
  v5.version = 6;
  ok(aggrOf(v5, v5.party[0].uid) === "neutral", "v5 migration defaults aggression to neutral");
  v5.party[0].skills = ["bite", ...v5.party[0].skills];
  queueSkill(v5, v5.party[0].uid, "bite", v5.party[0].uid);
  ok(v5.skillQ[v5.party[0].uid]?.skill === "bite", "v5 migration accepts skill orders");
}

// v6 → v7 migration: scalar genes become allele pairs with a genetic size gene
{
  const v6 = JSON.parse(json) as GameState & { version: number };
  for (const m of v6.party) {
    const g = m.genes as unknown as Record<string, GenePair>;
    m.genes = { vigor: g.vigor.a, might: g.might.a, guard: g.guard.a, swift: g.swift.a, wit: g.wit.a } as unknown as GameState["party"][number]["genes"];
  }
  v6.version = 6;
  for (const m of v6.party) migrateMonsterGenes(m);
  const m0 = v6.party[0];
  ok(typeof m0.genes.vigor.a === "number" && typeof m0.genes.size.a === "number", "v6 migration converts scalar genes into allele pairs");
  ok(getMonsterFootprint(m0) === footprintOf(SPECIES[m0.speciesId]), "migrated size genes express the species' body footprint");
}

// v7 → v8 migration: monsters gain a sex (asexual species stay asexual)
{
  const v7 = JSON.parse(json) as GameState & { version: number };
  for (const m of v7.party) delete (m as { sex?: string }).sex;
  v7.version = 7;
  for (const m of v7.party) migrateMonsterSex(m);
  ok(v7.party.every((m) => ["male", "female", "asexual"].includes(m.sex)), "v7 migration gives every monster a sex");
  const m0 = v7.party[0];
  ok(SPECIES[m0.speciesId].sexed === false ? m0.sex === "asexual" : m0.sex !== "asexual", "migrated sex matches the species' biology");
  const s0 = m0.sex;
  migrateMonsterSex(m0);
  ok(m0.sex === s0, "sex migration is idempotent");
}

// v8 → v9 migration: loaded chunks respawn, so lairs field their packs
{
  const v8 = JSON.parse(json) as GameState & { version: number };
  v8.version = 8;
  v8.loadedChunks = [];
  loadChunks(v8);
  const w8 = getWorld(v8.seed);
  let lairsFound = 0;
  let packed = 0;
  for (const key of v8.loadedChunks) {
    const [cx, cy] = key.split(",").map(Number);
    for (const f of w8.featuresNear(cx * 16 + 8, cy * 16 + 8, 8)) {
      if (f.kind !== "lair" || !f.speciesId) continue;
      if (Math.floor(f.x / 16) !== cx || Math.floor(f.y / 16) !== cy) continue;
      lairsFound++;
      if (v8.creatures[`l:${f.x}:${f.y}`]) {
        const n = Object.values(v8.creatures).filter((o) => o.pack === `l:${f.x}:${f.y}`).length;
        if (n >= 2) packed++;
      }
    }
  }
  ok(lairsFound > 0 && packed >= 1, `v9 migration fields packs at live lairs (${packed}/${lairsFound})`);
}

// v9 → v10 migration: faction knowledge backfilled, home banner resolved
{
  const v9 = JSON.parse(json) as GameState & { version: number };
  delete v9.knowledge.nationsSeen;
  delete v9.knowledge.assocSeen;
  delete (v9 as { lastNation?: string }).lastNation;
  v9.version = 9;
  migrateFactionKnowledge(v9);
  ok(typeof v9.lastNation === "string", "v10 migration resolves the player's banner");
  ok(!!v9.knowledge.nationsSeen && !!v9.knowledge.assocSeen, "v10 migration backfills faction knowledge");
  const nat = getFactions(v9.seed).nationAt(v9.player.x, v9.player.y);
  ok(!nat || v9.knowledge.nationsSeen[nat.id] === 1, "migrated save learns the nation it stands in");
}

// v3 migration path
const v3 = JSON.parse(json) as typeof gs & { version: number };
delete v3.knowledge;
v3.version = 3;
ensureKnowledge(v3, true);
ok(!!v3.knowledge && Object.keys(v3.knowledge.explored).length > 0, "v3 migration backfills explored");
ok(Object.keys(v3.knowledge.regionsSeen).length > 0 && v3.knowledge.route.length === 1, "v3 migration seeds region + route");

/* ------------------------------- Genetics ----------------------------------- */

// allele pairs, expression and grades: hidden potential exists without showing
{
  const gg = newGame("GEN-1", "Rook", "ranger", "#e8742a", previewStarter("GEN-1", "mossback"));
  ok(expressGene({ a: 90, b: 40 }) === 65, "expression is the allele average (90/40 → 65)");
  ok(getGeneGrade(expressGene({ a: 90, b: 40 })) === "B" && getGeneGrade(90) === "S", "grades come from expressed values, not alleles");
  const lo = createMonster(gg, "cindermaw", 5, { origin: "Test", seed: 43, personality: "loyal", mutations: [], genes: { ...gg.party[0].genes, vigor: { a: 40, b: 40 } } });
  const hi = createMonster(gg, "cindermaw", 5, { origin: "Test", seed: 44, personality: "loyal", mutations: [], genes: { ...gg.party[0].genes, vigor: { a: 90, b: 40 } } });
  ok(statOf(hi, "hp") > statOf(lo, "hp"), "stats follow the expressed gene average, not a single allele");
}

// inheritance: one allele from each parent; every combination can occur
{
  const rng = new Rng(777);
  const combos = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const c = inheritGene({ a: 90, b: 40 }, { a: 85, b: 45 }, rng);
    combos.add(`${c.a}:${c.b}`);
  }
  ok(combos.has("90:85") && combos.has("90:45") && combos.has("40:85") && combos.has("40:45"), "each child takes one allele per parent; all four combinations occur");
}

// drift: symmetric, unbiased, mostly small
{
  const rng = new Rng(2024);
  let up = 0, down = 0, sum = 0, small = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const d = mutateDelta(rng);
    sum += d;
    if (d > 0) up++;
    else if (d < 0) down++;
    if (Math.abs(d) <= 2) small++;
  }
  ok(up > 0 && down > 0, "mutations can increase and decrease gene values");
  ok(Math.abs(sum / N) < 0.25, `drift is centered on zero (mean ${(sum / N).toFixed(3)})`);
  ok(Math.abs(up - down) / N < 0.06, "no upward bias: P(up) ≈ P(down)");
  ok(small / N > 0.55, "most mutations are 0/±1/±2");
}

// mutation modifies the alleles themselves and stays bounded
{
  const rng = new Rng(99);
  let changed = 0, same = 0, bounded = true;
  for (let i = 0; i < 500; i++) {
    const m = mutateGene({ a: 100, b: 5 }, rng);
    if (m.a > 100 || m.a < 5 || m.b > 100 || m.b < 5) bounded = false;
    if (m.a === 100 && m.b === 5) same++;
    else changed++;
  }
  ok(bounded, "alleles stay bounded at 5–100");
  ok(changed > 0 && same > 0, "drift sometimes changes an allele and sometimes leaves it unchanged");
  const parent = mutateGene({ a: 90, b: 50 }, rng);
  const kids = new Set<number>();
  for (let i = 0; i < 200; i++) kids.add(inheritGene(parent, { a: 70, b: 70 }, rng).a);
  ok(kids.has(parent.a) && kids.has(parent.b), "mutated alleles are part of the genome and can be inherited");
}

// size is a gene: inherited, mutable in both directions, thresholds exact
{
  const rng = new Rng(313);
  const kid = inheritGene({ a: 90, b: 94 }, { a: 45, b: 51 }, rng);
  ok((kid.a === 90 || kid.a === 94) && (kid.b === 45 || kid.b === 51), "size genes inherit one allele per parent");
  ok(sizeToFootprint(expressGene(kid)) === 3, "size expression 90/51 → 71 → 3×3 footprint");
  let upS = false, downS = false;
  for (let i = 0; i < 500 && !(upS && downS); i++) {
    const m = mutateGene({ a: 74, b: 74 }, rng);
    if (expressGene(m) > 74) upS = true;
    if (expressGene(m) < 74) downS = true;
  }
  ok(upS && downS, "size can mutate upward and downward across footprint thresholds");
}
ok(
  sizeToFootprint(5) === 1 && sizeToFootprint(24) === 1 && sizeToFootprint(25) === 2 && sizeToFootprint(49) === 2 && sizeToFootprint(50) === 3 && sizeToFootprint(74) === 3 && sizeToFootprint(75) === 4 && sizeToFootprint(100) === 4,
  "size thresholds are exact (5–24, 25–49, 50–74, 75–100)",
);

// genome-driven footprints; starters stay 1×1 (multi-tile support intact)
{
  const gg = newGame("GEN-2", "Rook", "ranger", "#e8742a", previewStarter("GEN-2", "mossback"));
  ok(getMonsterFootprint(gg.party[0]) === 1, "starters stay 1×1");
  const big = createMonster(gg, "sunwyrm", 8, { origin: "Test", seed: 11 });
  big.hp = statOf(big, "hp");
  gg.party.push(big);
  initField(gg);
  ok(getMonsterFootprint(big) === 4, "a party titan's footprint comes from its size genome");
  const pos = gg.field[big.uid]!;
  ok(
    ([[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3]] as const).every(
      ([ox, oy]) => partyMonAt(gg, pos.x + ox, pos.y + oy) === big,
    ),
    "the genomic footprint occupies tiles like any multi-tile body",
  );
}

// size influences stats moderately (wit untouched)
{
  const gg = newGame("GEN-3", "Rook", "ranger", "#e8742a", previewStarter("GEN-3", "mossback"));
  const base = gg.party[0].genes;
  const small = createMonster(gg, "cindermaw", 5, { origin: "Test", seed: 21, personality: "loyal", mutations: [], genes: { ...base, size: { a: 10, b: 14 } } });
  const large = createMonster(gg, "cindermaw", 5, { origin: "Test", seed: 22, personality: "loyal", mutations: [], genes: { ...base, size: { a: 87, b: 87 } } });
  ok(statOf(large, "hp") > statOf(small, "hp") && statOf(large, "atk") > statOf(small, "atk") && statOf(large, "def") > statOf(small, "def"), "larger size raises HP/Might/Guard potential");
  ok(statOf(large, "agi") < statOf(small, "agi"), "larger size lowers Swift");
  ok(statOf(large, "wis") === statOf(small, "wis"), "Wit is not affected by size");
  ok(statOf(large, "hp") < Math.round(statOf(small, "hp") * 1.6), "size scaling stays moderate");
}

// breeding: allele inheritance before drift, genome and lineage intact after
{
  const gg = newGame("GEN-4", "Rook", "ranger", "#e8742a", previewStarter("GEN-4", "mossback"));
  const a = createMonster(gg, "cindermaw", 8, { origin: "Test", seed: 61, sex: "male", genes: { ...gg.party[0].genes, vigor: { a: 90, b: 40 } } });
  const b = createMonster(gg, "mossback", 8, { origin: "Test", seed: 62, sex: "female", genes: { ...gg.party[0].genes, vigor: { a: 85, b: 45 } } });
  const prev = previewBreeding(a, b);
  ok([90, 40].includes(prev.genes.vigor.a) && [85, 45].includes(prev.genes.vigor.b), "the preview shows the inherited allele pair (before drift)");
  ok(GENE_KEYS.every((k) => typeof prev.genes[k].a === "number" && typeof prev.genes[k].b === "number"), "every gene is inherited as an allele pair");
  const out = beginBreeding(gg, a, b, "player");
  ok(out.ok, "breeding creates a reproductive-development record");
  ok(gg.party.length === 1 && gg.pen.length === 0, "no offspring entity exists before development completes");
  if (out.ok) {
    gg.tick = out.development.completeTick;
    advanceDevelopment(gg);
    const child = [...gg.party, ...gg.pen].find((m) => m.parents?.[0] === a.uid) ?? null;
    ok(!!child, "the offspring is created when development completes");
    ok(
      (Object.keys(child!.genes) as GeneKey[]).every((k) => typeof child!.genes[k].a === "number" && typeof child!.genes[k].b === "number"),
      "breeding produces a full allele genome",
    );
    ok([1, 2, 3, 4].includes(getMonsterFootprint(child!)), "the child's footprint derives from its size genome");
    ok(child!.parents?.[0] === a.uid && child!.parents?.[1] === b.uid, "parents are recorded as uids for lineage");
    ok(child!.sex === prev.sex && ["male", "female", "asexual"].includes(child!.sex), "the child's sex matches the preview and its biology");
  }
}

// super lineages: expression can climb across generations
{
  const rng = new Rng(808);
  const flat = (vigor: GenePair): Genome => ({ vigor, might: { a: 50, b: 50 }, guard: { a: 50, b: 50 }, swift: { a: 50, b: 50 }, wit: { a: 50, b: 50 }, size: { a: 14, b: 14 } });
  let improved = false;
  for (let line = 0; line < 12 && !improved; line++) {
    let v: GenePair = { a: 90, b: 42 };
    for (let gen = 0; gen < 20; gen++) v = driftGenome(flat(v), rng).vigor;
    if (expressGene(v) > 66) improved = true;
  }
  ok(improved, "selective breeding can push expression beyond the founding pair");
}

// sex: sexed species are male or female; spirits, slimes, golems and plants are asexual
{
  ok(
    SPECIES["pipwisp"].sexed === false && SPECIES["slimekin"].sexed === false && SPECIES["regalslime"].sexed === false && SPECIES["bloomwisp"].sexed === false && SPECIES["mandrake_maw"].sexed === false && SPECIES["crystal_golem"].sexed === false,
    "spirits, slimes, the plant-beast and the golem have no sex",
  );
  ok(
    SPECIES["cindermaw"].sexed !== false && SPECIES["sunwyrm"].sexed !== false && SPECIES["nimbletuft"].sexed !== false,
    "beasts, birds and dragons come male or female",
  );
  const rng = new Rng(4242);
  const sexes = new Set<string>();
  for (let i = 0; i < 100; i++) sexes.add(rollSex(rng, "cindermaw"));
  ok(sexes.has("male") && sexes.has("female"), "sexed species roll both male and female");
  ok(rollSex(rng, "slimekin") === "asexual" && rollSex(rng, "crystal_golem") === "asexual", "asexual species never roll a sex");
}

/* --------------------------- BIOLOGY: Phase 1 foundation --------------------- */

// genotype integrity: every monster and wild creature carries a full valid genome
{
  const g = newGame("BIO-1", "Rook", "scholar", "#e8742a", previewStarter("BIO-1", "mossback"));
  const valid = (ge: Genome): boolean =>
    GENE_KEYS.every((k) =>
      typeof ge[k].a === "number" && Number.isFinite(ge[k].a) && ge[k].a >= 5 && ge[k].a <= 100 &&
      typeof ge[k].b === "number" && Number.isFinite(ge[k].b) && ge[k].b >= 5 && ge[k].b <= 100);
  ok(valid(g.party[0].genes), "every party monster carries a full six-gene genome within 5–100");
  ok(Object.values(gs.creatures).length > 0, "wild creatures exist for biology checks");
  ok(Object.values(gs.creatures).every((c) => !!c.genes && valid(c.genes)), "wild creatures carry explicit genomes within 5–100");
  ok(gs.party.every((m) => (m.generation ?? 1) >= 1 && !!m.lineageId?.startsWith("L:") && Array.isArray(m.mutHistory)), "party monsters carry lineage metadata");
  ok(Object.values(gs.creatures).every((c) => !!c.lineageId?.startsWith("L:") && c.gen === 1), "wild creatures are founder-lineaged");
  ok(getMonsterFootprint(gs.party[0]) === footprintOf(SPECIES[gs.party[0].speciesId]), "a starter's size gene expresses its species' body tier");
  const bySpecies = new Map<string, Set<number>>();
  for (const c of Object.values(gs.creatures)) {
    if (!c.genes) continue;
    const s = bySpecies.get(c.speciesId) ?? new Set<number>();
    s.add(expressGene(c.genes.size));
    bySpecies.set(c.speciesId, s);
  }
  ok([...bySpecies.values()].some((s) => s.size > 1), "same-species wild individuals differ in size genetics");
}

// genotype validation: clamps recoverable data, rejects structural corruption
{
  const good: Genome = { vigor: { a: 90, b: 40 }, might: { a: 50, b: 50 }, guard: { a: 50, b: 50 }, swift: { a: 50, b: 50 }, wit: { a: 50, b: 50 }, size: { a: 14, b: 14 } };
  const clamped = sanitizeGenome({ ...good, might: { a: 300, b: -20 } });
  ok(clamped?.might.a === 100 && clamped.might.b === 5, "out-of-range alleles are clamped to 5–100");
  ok(sanitizeGenome({ ...good, wit: undefined as unknown as GenePair }) === null, "a missing gene is structurally invalid");
  ok(sanitizeGenome({ ...good, wit: { a: NaN, b: 50 } }) === null, "NaN cannot propagate");
  ok(sanitizeGenome({ ...good, wit: { a: Infinity, b: 50 } }) === null, "Infinity cannot propagate");
  ok(sanitizeGenome(null) === null && sanitizeGenome(42) === null, "non-object genomes are rejected");
}

// lineage: founders, offspring generation and lineage id, structured drift history
{
  const s = newGame("BIO-3", "Rook", "ranger", "#e8742a", previewStarter("BIO-3", "mossback"));
  const a = createMonster(s, "cindermaw", 8, { origin: "Test", seed: 71, sex: "male" });
  const b = createMonster(s, "mossback", 8, { origin: "Test", seed: 72, sex: "female" });
  ok(a.generation === 1 && a.lineageId === `L:${a.uid}` && a.mutHistory?.length === 0, "founders are generation 1 with their own lineage id");
  const run = (seedText: string): Monster | null => {
    const st = newGame(seedText, "Rook", "ranger", "#e8742a", previewStarter(seedText, "mossback"));
    const x = createMonster(st, "cindermaw", 8, { origin: "Test", seed: 71, sex: "male" });
    const y = createMonster(st, "mossback", 8, { origin: "Test", seed: 72, sex: "female" });
    const out = beginBreeding(st, x, y, "player");
    if (!out.ok) return null;
    st.tick = out.development.completeTick;
    advanceDevelopment(st);
    return [...st.party, ...st.pen].find((m) => m.parents?.[0] === x.uid) ?? null;
  };
  const c1 = run("BIO-3");
  const c2 = run("BIO-3");
  ok(c1.generation === Math.max(a.generation ?? 1, b.generation ?? 1) + 1, "offspring generation is max(parents) + 1");
  ok(c1.lineageId === [a.lineageId!, b.lineageId!].sort()[0], "offspring carry a parent lineage id, not a name-derived id");
  ok((c1.parents ?? []).every((p) => /^[mw]/.test(p)), "parent references are stable ids, not display names");
  ok(JSON.stringify(c1.genes) === JSON.stringify(c2.genes) && c1.lineageId === c2.lineageId && JSON.stringify(c1.mutHistory) === JSON.stringify(c2.mutHistory), "identical seed and parents reproduce identical offspring genetics");
  ok(
    (c1.mutHistory ?? []).every((r) => r.to === r.from + r.delta && r.delta !== 0 && r.gen === c1.generation && ((r.dir === "up" && r.to > r.from) || (r.dir === "down" && r.to < r.from))),
    "mutation history is structured data with direction and generation",
  );
  a.nickname = "Renamed Parent";
  const out3 = beginBreeding(s, a, b, "player");
  ok(out3.ok, "renamed parents can still breed");
  if (out3.ok) {
    s.tick = out3.development.completeTick;
    advanceDevelopment(s);
    const c3 = [...s.party, ...s.pen].find((m) => m.parents?.[0] === a.uid) ?? null;
    ok(c3?.lineageId === [a.lineageId!, b.lineageId!].sort()[0], "lineage ids ignore display names");
  }
  const rt = JSON.parse(JSON.stringify(c1)) as Monster;
  migrateMonsterBio(rt);
  ok(rt.lineageId === c1.lineageId && rt.generation === c1.generation && JSON.stringify(rt.mutHistory) === JSON.stringify(c1.mutHistory), "lineage metadata survives save round-trips unchanged");
}

// wild creatures: genotype survives taming; legacy geneSeed migration is deterministic
{
  const g = newGame("BIO-4", "Rook", "ranger", "#e8742a", previewStarter("BIO-4", "mossback"));
  const c = Object.values(gs.creatures).find((x) => x.genes && !x.alpha);
  ok(!!c, "a tameable wild creature exists");
  if (c?.genes) {
    const mon = wildToMonster(g, c);
    ok(JSON.stringify(mon.genes) === JSON.stringify(c.genes), "taming preserves the wild creature's genotype exactly");
    ok(mon.lineageId === c.lineageId && mon.generation === c.gen, "taming preserves the wild creature's lineage identity");
  }
  const fc = Object.values(gs.creatures)[0]!;
  const f = wildFighter(gs, fc);
  ok(f.fp === getMonsterFootprint(f.mon), "a wild creature's combat footprint derives from its own size gene");
  const legacy = JSON.parse(JSON.stringify(fc)) as WildCreature;
  delete legacy.genes;
  delete legacy.gen;
  delete legacy.lineageId;
  const m1 = JSON.parse(JSON.stringify(legacy)) as WildCreature;
  const m2 = JSON.parse(JSON.stringify(legacy)) as WildCreature;
  migrateCreatureBio(m1);
  migrateCreatureBio(m2);
  ok(m1.gen === 1 && m1.lineageId === `L:${legacy.id}`, "legacy wild creatures get founder lineage metadata");
  ok(JSON.stringify(m1.genes) === JSON.stringify(wildGenotypeFromSeed(legacy.geneSeed, legacy.speciesId)), "legacy wild genetics derive deterministically from the gene seed");
  ok(JSON.stringify(m1.genes) === JSON.stringify(m2.genes), "legacy wild migration is deterministic");
  migrateCreatureBio(m1);
  ok(JSON.stringify(m1) === JSON.stringify(m2), "re-migrating a migrated wild creature changes nothing");
}

// monster migration: corruption regenerates deterministically, scalar five-gene data still migrates
{
  const g = newGame("BIO-5", "Rook", "scholar", "#e8742a", previewStarter("BIO-5", "mossback"));
  const m = g.party[0];
  const good = JSON.parse(JSON.stringify(m)) as Monster;
  (m.genes as unknown as Record<string, unknown>).vigor = { a: NaN, b: 50 };
  migrateMonsterGenes(m);
  migrateMonsterBio(m);
  ok(m.generation === 1 && m.lineageId === `L:${m.uid}` && Array.isArray(m.mutHistory), "legacy monsters receive founder metadata");
  const again = JSON.parse(JSON.stringify(m)) as Monster;
  migrateMonsterGenes(again);
  migrateMonsterBio(again);
  ok(JSON.stringify(again) === JSON.stringify(m), "corruption recovery and bio backfill are idempotent");
  const v6 = JSON.parse(JSON.stringify(good)) as Monster;
  (v6 as unknown as { genes: unknown }).genes = { vigor: 72, might: 55, guard: 48, swift: 61, wit: 40 };
  migrateMonsterGenes(v6);
  ok(v6.genes.vigor.a === 72 && typeof v6.genes.size.a === "number", "scalar five-gene monsters gain size genetics from their species band");
  const s1 = JSON.parse(JSON.stringify(gs)) as GameState;
  migrateBiology(s1);
  const s2 = JSON.parse(JSON.stringify(s1)) as GameState;
  migrateBiology(s2);
  ok(JSON.stringify(s2) === JSON.stringify(s1), "migrateBiology is idempotent across the whole game state");
}

/* ----------------------- REPRODUCTION: Phase 2 machinery --------------------- */

// compatibility matrix: the three reproductive configurations, species-independent
{
  const g = newGame("REP-1", "Rook", "scholar", "#e8742a", previewStarter("REP-1", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster =>
    createMonster(g, speciesId, level, { origin: "Test", seed: 91, sex });
  const m1 = mk("cindermaw", "male");
  const m2 = mk("cindermaw", "male");
  const f1 = mk("mossback", "female");
  const f2 = mk("sunwyrm", "female");
  ok(canReproduce(m1, f1, g.tick).ok, "male + female are biologically compatible");
  ok(canReproduce(f1, m1, g.tick).ok, "female + male are compatible (order-symmetric)");
  ok(!canReproduce(m1, m2, g.tick).ok, "male + male are biologically incompatible");
  ok(!canReproduce(f1, f2, g.tick).ok, "female + female are biologically incompatible");
  const a1 = mk("slimekin", "asexual");
  const a2 = mk("regalslime", "asexual");
  ok(canReproduce(a1, a2, g.tick).ok, "asexual + asexual are compatible — two parents, neither male nor female");
  ok(!canReproduce(a1, m1, g.tick).ok, "asexual + male are biologically incompatible");
  ok(!canReproduce(a1, f1, g.tick).ok, "asexual + female are biologically incompatible");
  ok(m1.speciesId !== f1.speciesId && canReproduce(m1, f1, g.tick).ok, "biological compatibility ignores species identity (mating rules decide that later)");
  ok(!canReproduce(m1, m1, g.tick).ok, "an individual cannot reproduce with itself");
}

// fertility, maturity, cooldown and active reproduction gate compatibility
{
  const g = newGame("REP-2", "Rook", "scholar", "#e8742a", previewStarter("REP-2", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster =>
    createMonster(g, speciesId, level, { origin: "Test", seed: 92, sex });
  const m = mk("cindermaw", "male");
  const f = mk("mossback", "female");
  m.repro!.fertility = 0;
  ok(reproStateOf(m.repro!, g.tick) === "infertile" && !canReproduce(m, f, g.tick).ok, "an infertile individual is incompatible despite a compatible partner");
  m.repro!.fertility = 60;
  ok(canReproduce(m, f, g.tick).ok, "fertility restored — compatible again");
  const kid = mk("mossback", "female", 2);
  g.pen.push(m, f, kid); // simulation advances bodies that live in the state
  ok(kid.repro!.maturity === "immature" && !canReproduce(kid, m, g.tick).ok, "an immature individual cannot reproduce");
  kid.level = MATURITY_LEVEL;
  advanceReproduction(g);
  ok(kid.repro!.maturity === "mature" && canReproduce(kid, m, g.tick).ok, "maturity comes from data, and maturing restores compatibility");
  f.repro!.cooldownUntil = g.tick + 100;
  ok(reproStateOf(f.repro!, g.tick) === "cooldown" && !canReproduce(f, m, g.tick).ok, "a cooling-down parent is unavailable");
  f.repro!.cooldownUntil = g.tick;
  ok(isBreedingAvailable(f, g.tick) && canReproduce(f, m, g.tick).ok, "cooldown expiry restores availability");
  const res = beginReproduction(m, f, g.tick);
  ok(
    res.ok && res.pairing === "sexual" && res.parentIds[0] === m.uid && res.parentIds[1] === f.uid && res.developTicks === DEVELOP_TICKS && res.parents.length === 2,
    "beginReproduction returns a structured result: pairing, parent ids, development duration",
  );
  ok(m.repro!.status === "reproducing" && m.repro!.engagedWith === f.uid && f.repro!.status === "reproducing", "both parents enter the reproducing state");
  ok(!canReproduce(m, kid, g.tick).ok && !canReproduce(f, kid, g.tick).ok, "an individual already reproducing cannot start another");
  ok(!beginReproduction(m, kid, g.tick).ok, "beginReproduction rejects an unavailable pair");
}

// two-parent asexual reproduction, development window and cooldown through simulation time
{
  const g = newGame("REP-3", "Rook", "scholar", "#e8742a", previewStarter("REP-3", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster =>
    createMonster(g, speciesId, level, { origin: "Test", seed: 93, sex });
  const s1 = mk("slimekin", "asexual");
  const s2 = mk("regalslime", "asexual");
  g.pen.push(s1, s2); // simulation advances bodies that live in the state
  const ares = beginReproduction(s1, s2, g.tick);
  ok(ares.ok && ares.pairing === "asexual" && s1.repro!.status === "reproducing" && s2.repro!.status === "reproducing", "two asexual parents begin a two-parent reproduction");
  g.tick += DEVELOP_TICKS + 1;
  const done = advanceReproduction(g);
  ok(done.length === 2 && done.every((d) => d.pairing === "asexual"), "completed reproductions are reported for every participant");
  ok(s1.repro!.status === "cooldown" && s1.repro!.cooldownUntil === g.tick + BREED_COOLDOWN_TICKS, "completed parents enter a biological breeding cooldown");
  ok(!canReproduce(s1, s2, g.tick).ok, "the cooldown blocks immediate re-breeding");
  g.tick += BREED_COOLDOWN_TICKS + 1;
  advanceReproduction(g);
  ok(s1.repro!.status === "available" && isBreedingAvailable(s1, g.tick), "cooldown expiry restores availability through simulation time");
}

// persistence: profiles survive round-trips, legacy bodies backfill, taming carries configuration
{
  const wc = Object.values(gs.creatures).find((c) => c.repro && !c.alpha);
  ok(!!wc, "wild creatures carry reproductive profiles");
  if (wc) {
    const legacy = JSON.parse(JSON.stringify(wc)) as WildCreature;
    delete legacy.repro;
    const m1 = JSON.parse(JSON.stringify(legacy)) as WildCreature;
    const m2 = JSON.parse(JSON.stringify(legacy)) as WildCreature;
    migrateReproCreature(m1);
    migrateReproCreature(m2);
    ok(!!m1.repro && JSON.stringify(m1.repro) === JSON.stringify(m2.repro), "wild creature profile migration is deterministic");
    migrateReproCreature(m1);
    ok(JSON.stringify(m1.repro) === JSON.stringify(m2.repro), "wild profile migration is idempotent");
    const g = newGame("REP-4", "Rook", "ranger", "#e8742a", previewStarter("REP-4", "mossback"));
    const tamed = wildToMonster(g, wc);
    ok(tamed.repro?.mode === wc.repro!.mode && tamed.sex === wc.repro!.mode, "taming carries the wild creature's reproductive configuration");
  }
  const g2 = newGame("REP-5", "Rook", "scholar", "#e8742a", previewStarter("REP-5", "mossback"));
  const mon = g2.party[0];
  const rt = JSON.parse(JSON.stringify(mon)) as Monster;
  migrateReproMon(rt);
  ok(JSON.stringify(rt.repro) === JSON.stringify(mon.repro), "reproductive profiles survive save round-trips unchanged");
  const legacyM = JSON.parse(JSON.stringify(mon)) as Monster;
  delete legacyM.repro;
  migrateReproMon(legacyM);
  ok(legacyM.repro?.mode === legacyM.sex && legacyM.repro.status === "available" && legacyM.repro.fertility === 100, "legacy monsters receive a sensible profile from their sex");
  const s1 = JSON.parse(JSON.stringify(gs)) as GameState;
  migrateRepro(s1);
  const s2 = JSON.parse(JSON.stringify(s1)) as GameState;
  migrateRepro(s2);
  ok(JSON.stringify(s2) === JSON.stringify(s1), "migrateRepro is idempotent across the whole game state");
}

/* ----------------------------- MATING: Phase 3 rules ------------------------- */

// rule matrix: the context decides species permission; biology stays in reproduction.ts
{
  const g = newGame("MAT-1", "Rook", "scholar", "#e8742a", previewStarter("MAT-1", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster =>
    createMonster(g, speciesId, level, { origin: "Test", seed: 71, sex });
  const cm = mk("cindermaw", "male");
  const cf = mk("cindermaw", "female");
  const mb = mk("mossback", "male");
  const mf = mk("mossback", "female");
  const s1 = mk("slimekin", "asexual");
  const s2 = mk("slimekin", "asexual");
  const r1 = mk("regalslime", "asexual");

  // wild: same species only, across all three reproductive configurations
  ok(canMate(cm, cf, "wild", g.tick).ok, "wild same-species male + female is permitted");
  ok(canMate(cf, cm, "wild", g.tick).ok, "wild same-species female + male is permitted");
  ok(canMate(s1, s2, "wild", g.tick).ok, "wild same-species asexual + asexual is permitted (still two parents)");
  const wx = canMate(cm, mf, "wild", g.tick);
  ok(!wx.ok && wx.reason === "different_species", "wild cross-species male + female is rejected: different species");
  const wx2 = canMate(mf, cm, "wild", g.tick);
  ok(!wx2.ok && wx2.reason === "different_species", "wild cross-species female + male is rejected: different species");
  const wa = canMate(s1, r1, "wild", g.tick);
  ok(!wa.ok && wa.reason === "different_species", "wild cross-species asexual + asexual is rejected: different species");

  // player: species unrestricted, biology still enforced
  ok(canMate(cm, cf, "player", g.tick).ok, "player same-species male + female is permitted");
  ok(canMate(s1, s2, "player", g.tick).ok, "player same-species asexual + asexual is permitted");
  ok(canMate(cm, mf, "player", g.tick).ok, "player cross-species male + female is permitted");
  ok(canMate(mf, cm, "player", g.tick).ok, "player cross-species female + male is permitted");
  ok(canMate(s1, r1, "player", g.tick).ok, "player cross-species asexual + asexual is permitted");
  ok(canMate(mb, cm, "player", g.tick).reason === "biological_incompatibility", "player male + male is rejected: biologically incompatible");
  ok(canMate(mf, cf, "player", g.tick).reason === "biological_incompatibility", "player female + female is rejected: biologically incompatible");
  ok(canMate(s1, cm, "player", g.tick).reason === "biological_incompatibility", "player asexual + male is rejected: biologically incompatible");
  ok(canMate(s1, mf, "player", g.tick).reason === "biological_incompatibility", "player asexual + female is rejected: biologically incompatible");
}

// rule ownership: biology is species-blind, the mating layer carries the species boundary
{
  const g = newGame("MAT-2", "Rook", "scholar", "#e8742a", previewStarter("MAT-2", "mossback"));
  const mk = (speciesId: string, sex: Sex): Monster => createMonster(g, speciesId, 10, { origin: "Test", seed: 72, sex });
  const a = mk("cindermaw", "male");
  const b = mk("mossback", "female");
  ok(canReproduce(a, b, g.tick).ok, "the reproduction engine accepts cross-species male + female — biology is species-blind");
  ok(!canMate(a, b, "wild", g.tick).ok, "wild mating rules reject that same biologically-capable pair");
  ok(canMate(a, b, "player", g.tick).ok, "player mating rules pass that same pair through to biology");
  ok(beginReproduction(a, b, g.tick).ok, "a permitted player pairing reaches the one biological reproduction system");
}

// general validation and biological gating through the mating layer
{
  const g = newGame("MAT-3", "Rook", "scholar", "#e8742a", previewStarter("MAT-3", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster =>
    createMonster(g, speciesId, level, { origin: "Test", seed: 73, sex });
  const m = mk("cindermaw", "male");
  const f = mk("cindermaw", "female");
  const self = canMate(m, m, "player", g.tick);
  ok(!self.ok && self.reason === "same_individual", "an individual can never mate with itself");
  const selfWild = canMate(m, m, "wild", g.tick);
  ok(!selfWild.ok && selfWild.reason === "same_individual", "self-mating is rejected in every context");
  ok(canMate(null, f, "player", g.tick).reason === "invalid_pair", "a missing partner is rejected as an invalid pair");
  const kid = mk("cindermaw", "female", 2);
  ok(!canMate(m, kid, "player", g.tick).ok, "an immature partner is rejected through the biological layer");
  const sterile = mk("cindermaw", "female");
  sterile.repro!.fertility = 0;
  ok(!canMate(m, sterile, "player", g.tick).ok, "an infertile partner is rejected through the biological layer");
  const resting = mk("cindermaw", "female");
  resting.repro!.cooldownUntil = g.tick + 50;
  ok(!canMate(m, resting, "player", g.tick).ok, "a cooling-down partner is rejected through the biological layer");
  const ghost = mk("cindermaw", "male");
  delete ghost.repro;
  ok(!canMate(ghost, f, "player", g.tick).ok && !canMate(ghost, f, "wild", g.tick).ok, "a missing reproductive profile is rejected safely in every context");
  ok(JSON.stringify(canMate(m, f, "wild", g.tick)) === JSON.stringify(canMate(m, f, "wild", g.tick)), "mating authorization is deterministic — no randomness in the rule layer");
}

// wildlife simulation invariants: a lone creature of one species can never multiply among another
{
  const g = newGame("MAT-SIM", "Rook", "scholar", "#e8742a", previewStarter("MAT-SIM", "mossback"));
  const loneMoss = placeAdjacent(g, "lone:1", "mossback", 10);
  ok(!!loneMoss, "a lone wild mossback is placed among another species");
  for (let i = 0; i < 6; i++) placeAdjacent(g, `s:${i}`, "slimekin", 10);
  for (const c of Object.values(g.creatures)) {
    c.satiety = 100;
    c.alpha = false;
    c.pack = false;
  }
  const nearStart = (st: GameState): WildCreature[] =>
    Object.values(st.creatures).filter((c) => cheb(c.x, c.y, st.player.x, st.player.y) <= 15);
  const mossBefore = nearStart(g).filter((c) => c.speciesId === "mossback").length;
  advance(g, 3000);
  const mossAfter = nearStart(g).filter((c) => c.speciesId === "mossback").length;
  ok(mossAfter <= mossBefore, `a lone mossback among another species never multiplies (${mossBefore} → ${mossAfter})`);
  const drifted = Object.values(g.creatures).filter((c) => c.repro && c.repro.status !== reproStateOf(c.repro, g.tick)).length;
  ok(drifted === 0, "the simulation keeps every wild reproductive state reconciled with the clock");

  const g2 = newGame("MAT-SIM2", "Rook", "scholar", "#e8742a", previewStarter("MAT-SIM2", "mossback"));
  const loneSlime = placeAdjacent(g2, "lone:2", "slimekin", 10);
  ok(!!loneSlime, "a lone wild slimekin is placed among another species");
  for (let i = 0; i < 6; i++) placeAdjacent(g2, `m:${i}`, "mossback", 10);
  for (const c of Object.values(g2.creatures)) {
    c.satiety = 100;
    c.alpha = false;
    c.pack = false;
  }
  const slimeBefore = nearStart(g2).filter((c) => c.speciesId === "slimekin").length;
  advance(g2, 3000);
  const slimeAfter = nearStart(g2).filter((c) => c.speciesId === "slimekin").length;
  ok(slimeAfter <= slimeBefore, `a lone slimekin among another species never multiplies (${slimeBefore} → ${slimeAfter})`);
}

/* -------------------------- BREEDING: Phase 4 pipeline ----------------------- */

// species determination and asexual pairing flow through the one pipeline
{
  const g = newGame("BRD-0", "Rook", "scholar", "#e8742a", previewStarter("BRD-0", "mossback"));
  ok(offspringSpecies(createMonster(g, "cindermaw", 8, { origin: "Test", seed: 80 }), createMonster(g, "cragjaw", 8, { origin: "Test", seed: 80 })) === "sunwyrm", "recipe species determination flows through the breeding pipeline");
  const s1 = createMonster(g, "slimekin", 10, { origin: "Test", seed: 80, sex: "asexual" });
  const s2 = createMonster(g, "slimekin", 10, { origin: "Test", seed: 80, sex: "asexual" });
  const out = beginBreeding(g, s1, s2, "player");
  ok(out.ok && out.development.type === "gestation" && !out.nest, "asexual pairs breed through the same pipeline — gestation without a nest");
  ok(out.ok && out.development.speciesId === "regalslime", "the slimekin recipe produces a regalslime through breeding");
}

// validation: every gate returns a structured rejection before any state changes
{
  const g = newGame("BRD-1", "Rook", "scholar", "#e8742a", previewStarter("BRD-1", "mossback"));
  const mk = (speciesId: string, sex: Sex, level = 10): Monster => createMonster(g, speciesId, level, { origin: "Test", seed: 81, sex });
  ok(beginBreeding(g, mk("cindermaw", "male"), mk("cindermaw", "female"), "player").ok, "biologically valid parents can breed");
  ok(!beginBreeding(g, mk("cindermaw", "female", 2), mk("cindermaw", "male"), "player").ok, "an immature parent cannot breed");
  const sterile = mk("cindermaw", "male");
  sterile.repro!.fertility = 0;
  ok(!beginBreeding(g, sterile, mk("cindermaw", "female"), "player").ok, "an infertile parent cannot breed");
  const tired = mk("cindermaw", "male");
  tired.repro!.cooldownUntil = g.tick + 40;
  ok(!beginBreeding(g, tired, mk("cindermaw", "female"), "player").ok, "a parent on cooldown cannot breed");
  const narc = mk("cindermaw", "male");
  ok(!beginBreeding(g, narc, narc, "player").ok, "self-breeding is rejected");
  ok(!beginBreeding(g, mk("cindermaw", "male"), mk("mossback", "female"), "wild").ok, "wild cross-species breeding is rejected");
  ok(beginBreeding(g, mk("cindermaw", "male"), mk("mossback", "female"), "player").ok, "player cross-species breeding is permitted");
  const taken = mk("cindermaw", "female");
  beginBreeding(g, mk("cindermaw", "male"), taken, "player");
  ok(!beginBreeding(g, mk("cindermaw", "male"), taken, "player").ok, "a parent already reproducing cannot start another breeding");
}

// genetics: both parents contribute, mutation is bidirectional and clamped, lineage is recorded
{
  const g = newGame("BRD-2", "Rook", "scholar", "#e8742a", previewStarter("BRD-2", "mossback"));
  const pa = createMonster(g, "cindermaw", 10, { origin: "Test", seed: 82, sex: "male", genes: { vigor: { a: 95, b: 20 }, might: { a: 50, b: 50 }, guard: { a: 50, b: 50 }, swift: { a: 50, b: 50 }, wit: { a: 50, b: 50 }, size: { a: 80, b: 20 } } });
  const pb = createMonster(g, "mossback", 10, { origin: "Test", seed: 83, sex: "female", genes: { vigor: { a: 15, b: 60 }, might: { a: 50, b: 50 }, guard: { a: 50, b: 50 }, swift: { a: 50, b: 50 }, wit: { a: 50, b: 50 }, size: { a: 10, b: 90 } } });
  const out = beginBreeding(g, pa, pb, "player");
  ok(out.ok, "breeding starts for the genetics suite");
  if (out.ok) {
    const child = out.development.child!;
    let both = false;
    let mid = false;
    let up = false;
    let down = false;
    let legal = true;
    for (let i = 0; i < 400; i++) {
      const c = planChild(pa, pb, new Rng(3000 + i));
      if ([95, 20].includes(c.genes.vigor.a) && [15, 60].includes(c.genes.vigor.b)) both = true;
      const e = expressGene(c.genes.vigor);
      if (e > 20 && e < 90) mid = true;
      for (const r of c.mutHistory) {
        if (r.dir === "up") up = true;
        if (r.dir === "down") down = true;
      }
      legal = legal && GENE_KEYS.every((k) => c.genes[k].a >= 5 && c.genes[k].a <= 100 && c.genes[k].b >= 5 && c.genes[k].b <= 100);
    }
    ok(both, "each parent contributes one allele per gene");
    ok(mid, "intermediate expression values arise from mixed inheritance");
    ok(up && down, "mutation moves genes upward and downward");
    ok(legal, "mutated genes remain within their legal range");
    ok(expressGene(child.genes.size) >= 5, "size is inherited as part of the genotype");
    ok(child.parents[0] === pa.uid && child.parents[1] === pb.uid, "parent ids are recorded");
    ok(child.generation === 2, "generation increments past the parents");
    ok(child.lineageId === [pa.lineageId!, pb.lineageId!].sort()[0], "lineage id is preserved from the parents");
    ok(child.mutHistory.every((r) => r.gen === child.generation), "mutation history is recorded per generation");
  }
}

// development: no premature offspring, delivery at completion, parents cool down after
{
  const g = newGame("BRD-3", "Rook", "scholar", "#e8742a", previewStarter("BRD-3", "mossback"));
  const a = createMonster(g, "cindermaw", 10, { origin: "Test", seed: 84, sex: "male" });
  const b = createMonster(g, "mossback", 10, { origin: "Test", seed: 85, sex: "female" });
  g.pen.push(a, b); // advanceReproduction only sees bodies living in the state
  const out = beginBreeding(g, a, b, "player");
  ok(out.ok && out.development.type === "gestation", "a beast pairing gestates — live birth, no nest");
  if (out.ok) {
    const dev = out.development;
    g.tick = dev.completeTick - 1;
    advanceDevelopment(g);
    ok(g.party.length === 1, "no offspring before development completes");
    g.tick += 1;
    advanceDevelopment(g);
    const child = [...g.party, ...g.pen].find((m) => m.parents?.[0] === a.uid) ?? null;
    ok(!!child, "the offspring is created when development completes");
    ok(dev.state === "completed" && dev.resultId === child?.uid, "the development record records its result");
    ok(!!child && typeof child.genes.vigor.a === "number" && child.lineageId === [a.lineageId!, b.lineageId!].sort()[0], "the offspring retains its inherited genotype and lineage");
    advanceReproduction(g);
    ok(a.repro!.status === "cooldown" && a.repro!.cooldownUntil > g.tick, "parents enter a breeding cooldown after the offspring arrives");
  }
}

/* ------------------------------- NESTS: Phase 5 ------------------------------ */

// a female egg-layer builds one persistent nest and reuses it
{
  const g = newGame("NST-1", "Rook", "scholar", "#e8742a", previewStarter("NST-1", "mossback"));
  const eggSp = Object.keys(SPECIES).find((id) => developmentTypeFor(id, "sexual") === "egg") ?? "";
  ok(!!eggSp, "egg-laying species exist");
  const f = createMonster(g, eggSp, 10, { origin: "Test", seed: 86, sex: "female" });
  const m = createMonster(g, eggSp, 10, { origin: "Test", seed: 87, sex: "male" });
  const r1 = beginBreeding(g, f, m, "player");
  ok(r1.ok && !!r1.nest, "an egg-laying female builds a nest");
  const nestId = r1.ok && r1.nest ? r1.nest.id : "";
  ok(!!nestId && f.repro?.nestId === nestId, "the female remembers her nest");
  const m2 = createMonster(g, eggSp, 10, { origin: "Test", seed: 88, sex: "male" });
  if (r1.ok) {
    g.tick = r1.development.completeTick + 1;
    advanceDevelopment(g);
    advanceReproduction(g);
    g.tick += BREED_COOLDOWN_TICKS + 1;
    advanceReproduction(g);
    ok(r1.nest!.state === "active", "the nest persists after offspring production");
    const r2 = beginBreeding(g, f, m2, "player");
    ok(r2.ok && r2.nest?.id === nestId, "the female reuses her existing nest on the next breeding");
    ok(Object.keys(g.nests).length === 1, "no duplicate nest is created");
  }
}

// destroying a nest interrupts its brood and leaves nothing dangling
{
  const g = newGame("NST-2", "Rook", "scholar", "#e8742a", previewStarter("NST-2", "mossback"));
  const eggSp = Object.keys(SPECIES).find((id) => developmentTypeFor(id, "sexual") === "egg") ?? "";
  const f = createMonster(g, eggSp, 10, { origin: "Test", seed: 91, sex: "female" });
  const m = createMonster(g, eggSp, 10, { origin: "Test", seed: 92, sex: "male" });
  g.pen.push(f); // destroyNest reaches the owner through the living state
  const r = beginBreeding(g, f, m, "player");
  ok(r.ok && !!r.nest, "the nest exists before destruction");
  if (r.ok && r.nest) {
    const dev = r.development;
    destroyNest(g, r.nest.id);
    ok(dev.state === "interrupted" && dev.nestId === undefined, "destroying a nest interrupts its developing offspring");
    ok(r.nest.state === "destroyed" && r.nest.developmentIds.length === 0, "the destroyed nest holds no dangling development references");
    ok(f.repro?.nestId === undefined, "the female's memory of the destroyed nest is cleared");
    g.tick = dev.completeTick + BREED_COOLDOWN_TICKS + 1;
    advanceDevelopment(g);
    advanceReproduction(g);
    ok(![...g.party, ...g.pen].some((x) => x.parents?.[0] === m.uid), "an interrupted development never produces offspring");
    const m3 = createMonster(g, eggSp, 10, { origin: "Test", seed: 93, sex: "male" });
    g.tick += BREED_COOLDOWN_TICKS + 1;
    advanceReproduction(g);
    const r3 = beginBreeding(g, f, m3, "player");
    ok(r3.ok && !!r3.nest && r3.nest.id !== r.nest.id, "a new nest is created after the old one is invalidated");
  }
}

// female defeat abandons the nest without destroying it; abandoned nests are not reused
{
  const g = newGame("NST-3", "Rook", "scholar", "#e8742a", previewStarter("NST-3", "mossback"));
  const eggSp = Object.keys(SPECIES).find((id) => developmentTypeFor(id, "sexual") === "egg") ?? "";
  const f = createMonster(g, eggSp, 10, { origin: "Test", seed: 94, sex: "female" });
  const m = createMonster(g, eggSp, 10, { origin: "Test", seed: 95, sex: "male" });
  const r = beginBreeding(g, f, m, "player");
  ok(r.ok && !!r.nest, "the nest exists before defeat");
  if (r.ok && r.nest) {
    abandonNestsOf(g, f.uid);
    ok(r.nest.state === "abandoned", "female defeat abandons but does not destroy the nest");
    ok(!!g.nests[r.nest.id], "the abandoned nest persists in the world");
    ok(r.development.state === "developing", "development continues in an abandoned nest");
    g.tick = r.development.completeTick + BREED_COOLDOWN_TICKS + 1;
    advanceDevelopment(g);
    advanceReproduction(g);
    ok([...g.party, ...g.pen].some((x) => x.parents?.includes(m.uid) ?? false), "offspring still hatches from an abandoned nest");
    g.tick += BREED_COOLDOWN_TICKS + 1;
    advanceReproduction(g);
    const m3 = createMonster(g, eggSp, 10, { origin: "Test", seed: 96, sex: "male" });
    const r3 = beginBreeding(g, f, m3, "player");
    ok(r3.ok && !!r3.nest && r3.nest.id !== r.nest.id, "an abandoned nest is not reused — the female builds fresh");
  }
}

// wild eggs hatch at the nest with their inherited genotype intact
{
  const g = newGame("NST-4", "Rook", "scholar", "#e8742a", previewStarter("NST-4", "mossback"));
  const eggSp = Object.keys(SPECIES).find((id) => developmentTypeFor(id, "sexual") === "egg") ?? "";
  const c = placeAdjacent(g, "w:1", eggSp, 10);
  const o = placeAdjacent(g, "w:2", eggSp, 10);
  ok(!!c && !!o, "two wild egg-layers are placed");
  if (c && o) {
    c.repro!.mode = "female";
    o.repro!.mode = "male";
    const r = beginBreeding(g, c, o, "wild");
    ok(r.ok && !!r.nest, "wild breeding builds a nest at the layer's position");
    if (r.ok) {
      const dev = r.development;
      ok(Object.values(g.creatures).every((x) => x.id !== dev.resultId), "no wild offspring exists before completion");
      g.tick = dev.completeTick + 1;
      advanceDevelopment(g);
      const baby = dev.resultId ? g.creatures[dev.resultId] : null;
      ok(!!baby, "the wild offspring hatches at the nest");
      ok(!!baby && JSON.stringify(baby.genes) === JSON.stringify(dev.child!.genes) && baby.lineageId === dev.child!.lineageId, "the hatched creature retains its inherited genotype and lineage");
      ok(!!r.nest && r.nest.state === "active", "the nest persists after hatching");
    }
  }
}

// persistence: nests and developments survive round-trips; migration is idempotent
{
  const s1 = JSON.parse(JSON.stringify(gs)) as GameState;
  migrateBreeding(s1);
  const s2 = JSON.parse(JSON.stringify(s1)) as GameState;
  migrateBreeding(s2);
  ok(JSON.stringify(s2) === JSON.stringify(s1), "migrateBreeding is idempotent across the whole game state");
}

/* ------------------------------ TERRITORY: Phase 6 ----------------------------- */

// territories are persistent world state with identity; creatures reference them
{
  const g = newGame("TER-1", "Rook", "scholar", "#e8742a", previewStarter("TER-1", "mossback"));
  ok(Object.values(g.creatures).every((c) => !!c.territoryId && !!g.territories[c.territoryId!]), "every spawned creature recognizes a live territory from birth");
  // wipe to the legacy-save state so founding and joining are deterministic under test
  g.territories = {};
  g.territorySeq = 0;
  for (const c of Object.values(g.creatures)) delete c.territoryId;
  const c = placeAdjacent(g, "w:ter1", "mossback", 10);
  ok(!!c, "a wild creature is placed for the territory suite");
  if (c) {
    const t = ensureTerritory(g, c);
    ok(c.territoryId === t.id && !!g.territories[t.id], "a founded territory persists in world state and the creature references it");
    ok(t.x === c.x && t.y === c.y, "the territory is centered on its founding spot");
    ok(t.quality >= 0 && t.quality <= 100, `territory quality is scored from the environment (${t.quality})`);
    ok(territoryAt(g, t.x, t.y)?.id === t.id, "territories resolve by position");
    ok(JSON.stringify(homeAnchor(g, c)) === JSON.stringify({ x: t.x, y: t.y }), "home-range reads come from the territory");
    const c2 = placeAdjacent(g, "w:ter2", "mossback", 12);
    ok(!!c2, "a second same-species creature is placed nearby");
    if (c2) {
      ensureTerritory(g, c2);
      ok(c2.territoryId === t.id, "a nearby same-species creature joins the existing territory instead of founding a duplicate");
    }
  }
}

// alpha behavior migrates to territory ownership
{
  const g = newGame("TER-2", "Rook", "scholar", "#e8742a", previewStarter("TER-2", "mossback"));
  const a = placeAdjacent(g, "w:ter3", "mossback", 10);
  ok(!!a, "the future alpha is placed");
  if (a) {
    a.alpha = true;
    const t = ensureTerritory(g, a);
    ok(t.ownerId === a.id, "an alpha becomes its territory's owner");
    const minion = placeAdjacent(g, "w:ter4", "mossback", 12);
    ok(!!minion, "a pack member is placed nearby");
    if (minion) {
      minion.pack = a.id;
      ensureTerritory(g, minion);
      ok(minion.territoryId === t.id && t.ownerId === a.id, "a pack member shares the alpha's territory without claiming it");
      releaseTerritoryOwner(g, a.id);
      ok(t.ownerId === undefined && !!g.territories[t.id], "when the alpha falls, ownership lapses but the territory persists");
    }
  }
}

// nests are linked to territories through ids, in both directions
{
  const nestArt = decodePng(new Uint8Array(readFileSync(new URL("../public/monsters/v2/nest.png", import.meta.url))));
  const nestEggs = decodePng(new Uint8Array(readFileSync(new URL("../public/monsters/v2/nest_eggs.png", import.meta.url))));
  ok(nestArt.w > 0 && nestEggs.w > 0, "nest and nest-with-eggs sprites exist in the processed art pipeline");
  const g = newGame("TER-3", "Rook", "scholar", "#e8742a", previewStarter("TER-3", "mossback"));
  const eggSp = Object.keys(SPECIES).find((id) => developmentTypeFor(id, "sexual") === "egg") ?? "";
  const c = placeAdjacent(g, "w:ter5", eggSp, 10);
  const o = placeAdjacent(g, "w:ter6", eggSp, 12);
  ok(!!c && !!o, "a wild egg-laying pair is placed");
  if (c && o) {
    c.repro!.mode = "female";
    o.repro!.mode = "male";
    const r = beginBreeding(g, c, o, "wild");
    ok(r.ok && !!r.nest, "the pair breeds and lays");
    if (r.ok && r.nest) {
      const tid = r.nest.territoryId;
      ok(!!tid && !!g.territories[tid!], "the nest references a live territory");
      ok(!!tid && g.territories[tid!].nestIds.includes(r.nest.id), "the territory lists the nest among its own");
      g.tick = r.development.completeTick + 1;
      advanceDevelopment(g);
      const baby = r.development.resultId ? g.creatures[r.development.resultId] : null;
      ok(!!baby && baby.territoryId === tid, "a hatched offspring is born into its nest's territory");
    }
  }
}

// legacy saves migrate safely; territory migration is idempotent
{
  const s1 = JSON.parse(JSON.stringify(gs)) as GameState;
  delete (s1 as { territories?: unknown }).territories;
  delete (s1 as { territorySeq?: unknown }).territorySeq;
  for (const c of Object.values(s1.creatures)) delete c.territoryId;
  migrateTerritories(s1);
  ok(Object.values(s1.creatures).every((c) => !!c.territoryId && !!s1.territories[c.territoryId!]), "a legacy save receives a territory for every creature");
  const snapshot = JSON.stringify(s1);
  migrateTerritories(s1);
  ok(JSON.stringify(s1) === snapshot, "migrateTerritories is idempotent across the whole game state");
}

// waiting passes time without leaking new terrain
const expBefore = Object.keys(gs.knowledge.explored).length;
waitTurn(gs, 24);
ok(Object.keys(gs.knowledge.explored).length === expBefore, "waiting does not reveal new area");

/* ------------------------------- FACTIONS ------------------------------------ */

// nations: generated, mixed sizes, coherent blobs, unclaimable land stays free
{
  const fac = getFactions(gs.seed);
  ok(fac.nations.length >= 6 && fac.nations.length <= 24, `nations generated (${fac.nations.length})`);
  ok(fac.nations.some((n) => n.tier === "major") && fac.nations.some((n) => n.tier === "free"), "mixed realm sizes present (majors and free cities)");
  const counts = new Map<string, number>();
  for (let fy = 0; fy < 103; fy++) {
    for (let fx = 0; fx < 103; fx++) {
      const n = fac.nationAtCell(fx, fy);
      if (n) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    }
  }
  ok(fac.nations.every((n) => (counts.get(n.id) ?? 0) > 0), "every nation holds territory");
  const sizes = [...counts.values()];
  const ratio = Math.max(...sizes) / Math.min(...sizes);
  ok(ratio >= 2.5, `mixed sizes: the largest realm is ${ratio.toFixed(1)}× the smallest`);
  let same = 0;
  let tot = 0;
  for (let i = 0; i < 4000; i++) {
    const fx = 2 + (i * 97) % 99;
    const fy = 2 + (i * 53) % 99;
    const n = fac.nationAtCell(fx, fy);
    if (!n) continue;
    for (const o of [fac.nationAtCell(fx + 1, fy), fac.nationAtCell(fx, fy + 1)]) {
      tot++;
      if (o === n) same++;
    }
  }
  ok(tot > 0 && same / tot > 0.6, `territory is coherent, not checkered (${((same / Math.max(1, tot)) * 100).toFixed(0)}% neighbor agreement)`);
  // territory resolves at 40-tile cells: a cell is claimed only if its own center is claimable land
  let badClaim = 0;
  for (let fy = 0; fy < 103; fy++) {
    for (let fx = 0; fx < 103; fx++) {
      const t = world.tile(fx * 40 + 20, fy * 40 + 20);
      if (!BIOMES[t.biome].passable && fac.nationAtCell(fx, fy)) badClaim++;
    }
  }
  ok(badClaim === 0, "sea and peaks stay unclaimed (every territory cell is claimable land)");
  const f2 = new Factions(world.seed, world);
  ok(JSON.stringify(f2.nations) === JSON.stringify(fac.nations), "nations are seed-deterministic across instances");
}

// associations: chapters inside their origin nation, charters vary by nation
{
  const fac = getFactions(gs.seed);
  ok(fac.assocs.every((a) => fac.nationAt(a.chapter.x, a.chapter.y)?.id === a.nationId), "every association chapter lies inside its origin nation");
  ok(fac.assocs.every((a) => a.chapter.kind === "hamlet"), "chapters are hamlets");
  const ch = fac.assocs[0];
  if (ch) {
    const notices = fac.hamletNotices(ch.chapter);
    ok(notices.length >= 1 && notices.length <= 3, `a chapter hamlet posts notices (${notices.length})`);
    ok(notices.every((nt) => nt.text.includes(nt.assoc.name)), "notices are signed by their association");
    ok(notices.every((nt) => nt.text.includes("duel") || nt.text.includes("Tourney") || nt.text.includes("Auction") || nt.text.includes("auction") || nt.text.includes("beast") || nt.text.includes("Sale")), "notices cover duels, tourneys and beast trade");
  }
  let multi = false;
  let none = false;
  for (const seedText of ["MAPCHECK-1", "FACTION-2", "FACTION-3", "FACTION-4"]) {
    const sd = seedFromText(seedText);
    const facS = new Factions(sd, getWorld(sd));
    for (const n of facS.nations) {
      if (n.associations.length >= 2) multi = true;
      if (n.associations.length === 0) none = true;
    }
  }
  ok(multi, "some nations charter more than one association");
  ok(none, "some nations charter no association");
}

// borders: walking crosses them, announcements fire, learning persists
{
  const g = newGame("BORDER-1", "Rook", "ranger", "#e8742a", previewStarter("BORDER-1", "mossback"));
  const fac = getFactions(g.seed);
  const home = fac.nationAt(g.player.x, g.player.y);
  ok(!home || (g.lastNation === home.id && g.knowledge.nationsSeen[home.id] === 1), "the home nation is known from the first day");
  const dirs2: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let crossed = false;
  let di2 = 0;
  for (let i = 0; i < 700 && !crossed; i++) {
    const [dx, dy] = dirs2[di2 % 4];
    const px0 = g.player.x;
    const py0 = g.player.y;
    movePlayer(g, dx, dy);
    if (g.player.x === px0 && g.player.y === py0) di2++;
    else di2 = 0;
    crossed = g.lastNation !== (home?.id ?? "");
  }
  ok(crossed, "wandering far enough crosses at least one border");
  ok(g.log.some((l) => l.text.includes("entered") || l.text.includes("unclaimed wilds")), "crossing a border is announced");
}

// perf
const t0 = performance.now();
for (let i = 0; i < 300; i++) movePlayer(gs, i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : -1, 1);
const t1 = performance.now();
console.log(`perf 300 moves+combat+knowledge: ${(t1 - t0).toFixed(1)}ms`);

const t2 = performance.now();
for (let cy = 0; cy < 128; cy++) for (let cx = 0; cx < 128; cx++) sampleCell("world", world, cx * 32, cy * 32);
const t3 = performance.now();
console.log(`perf full world overview build: ${(t3 - t2).toFixed(1)}ms`);

const fac = getFactions(gs.seed);
const t4 = performance.now();
let sink = 0;
for (let i = 0; i < 20000; i++) sink += fac.nationAt((i * 131) % 4096, (i * 197) % 4096) ? 1 : 0;
const t5 = performance.now();
console.log(`perf 20000 nationAt lookups: ${(t5 - t4).toFixed(1)}ms (sink ${sink})`);
console.log(`info save JSON size: ${(json.length / 1024).toFixed(1)}KB`);

// SCARF — tamer sprite scarf coloring system
{
  console.log("SCARF — scarf coloring system");
  ok(parseHex("#f5f2ea").join(",") === "245,242,234", "parseHex reads six-digit hex");
  ok(parseHex("#f00").join(",") === "255,0,0", "parseHex reads three-digit hex");
  ok(isScarfPixel(248, 248, 248, 255, 0.3), "scarf white is a scarf pixel");
  ok(isScarfPixel(176, 176, 176, 255, 0.45), "scarf weave gray is a scarf pixel");
  ok(!isScarfPixel(248, 248, 248, 255, 0.19), "eye whites above the face line are untouched");
  ok(!isScarfPixel(232, 216, 184, 255, 0.4), "warm beige sleeves never take the dye");
  ok(!isScarfPixel(0, 0, 0, 255, 0.3), "black outlines never take the dye");
  ok(!isScarfPixel(136, 64, 32, 255, 0.1), "hair never takes the dye");
  ok(!isScarfPixel(255, 255, 255, 0, 0.3), "transparent pixels are ignored");
  const w = scarfShade(1, parseHex("#f5f2ea"));
  ok(w.join(",") === "245,242,234", "the natural linen scarf stays linen");
  const hi = scarfShade(1, parseHex("#c0392b"));
  const lo = scarfShade(0.66, parseHex("#c0392b"));
  ok(hi.join(",") === "192,57,43", "a red scarf dyes every scarf pixel red");
  ok(lo.join(",") === hi.join(","), "the dye is solid — weave shading is flattened");
  ok(SCARVES.length >= 7 && SCARVES.every((c) => /^#[0-9a-f]{6}$/i.test(c)), "the scarf palette offers real choices");
  const png = readFileSync(new URL("../public/player/hero.png", import.meta.url));
  const wpx = png.readUInt32BE(16);
  const hpx = png.readUInt32BE(20);
  ok(wpx === 930 && hpx === 1692, "the tamer sprite is the provided art");
  ok(Math.abs(wpx / hpx - HERO_ASPECT) < 0.01, "HERO_ASPECT matches the art");
}

// SPRITEBG — automatic black-background removal
{
  console.log("SPRITEBG — black background removal");
  const mk = (w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): RawImage => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = fill(x, y);
        const o = (y * w + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = a;
      }
    }
    return { w, h, data };
  };
  const alpha = (img: RawImage, x: number, y: number): number => img.data[(y * img.w + x) * 4 + 3];
  const scene = mk(32, 32, (x, y) => {
    const body = x >= 8 && x < 24 && y >= 8 && y < 24;
    if (!body) return [0, 0, 0, 255];
    if (x >= 14 && x < 18 && y >= 14 && y < 18) return [0, 0, 0, 255];
    if (x === 10 && y === 10) return [0, 0, 0, 255];
    return [40, 120, 60, 255];
  });
  const out = stripBlackBackground(scene);
  ok(alpha(out, 0, 0) === 0 && alpha(out, 31, 31) === 0, "border-connected background black is removed");
  ok(alpha(out, 10, 10) === 255, "a creature's own black detail is kept");
  ok(alpha(out, 15, 15) === 0, "a large uniform enclosed black pocket is removed");
  ok(alpha(out, 12, 12) === 255, "the body itself survives the strip");
  // already-clean art keeps its exact silhouette
  const v2 = decodePng(new Uint8Array(readFileSync(new URL("../public/monsters/v2/mossback.png", import.meta.url))));
  const v2out = stripBlackBackground(v2);
  let adiff = 0;
  for (let i = 0; i < v2.w * v2.h; i++) if (v2out.data[i * 4 + 3] !== v2.data[i * 4 + 3]) adiff++;
  ok(adiff === 0, "already-transparent monster art keeps its exact silhouette");
  // the tamer sprite's baked black background strips clean to the border
  const hero = decodePng(new Uint8Array(readFileSync(new URL("../public/player/hero.png", import.meta.url))));
  const hc = stripBlackBackground(hero);
  let removed = 0;
  let edge = 0;
  for (let i = 0; i < hero.w * hero.h; i++) if (hc.data[i * 4 + 3] === 0) removed++;
  for (let x = 0; x < hero.w; x++) {
    if (hc.data[x * 4 + 3] > 0) edge++;
    if (hc.data[((hero.h - 1) * hero.w + x) * 4 + 3] > 0) edge++;
  }
  for (let y = 0; y < hero.h; y++) {
    if (hc.data[(y * hero.w) * 4 + 3] > 0) edge++;
    if (hc.data[(y * hero.w + hero.w - 1) * 4 + 3] > 0) edge++;
  }
  ok(edge === 0, "the tamer sprite's baked black background strips to the border");
  ok(removed / (hero.w * hero.h) > 0.4, `most of the tamer sprite was background (${((removed / (hero.w * hero.h)) * 100).toFixed(0)}%)`);
  // defringe pulls dark edge pixels toward body color so no halos hug the silhouette
  const fr = mk(8, 8, (x) => (x === 0 ? [0, 0, 0, 0] : [230, 90, 70, 255]));
  const fo = (3 * 8 + 1) * 4;
  fr.data[fo] = 10;
  fr.data[fo + 1] = 10;
  fr.data[fo + 2] = 10;
  defringeEdges(fr);
  ok(fr.data[fo] > 120, "defringe pulls edge pixels toward the body color");
}

// ---------------------------------------------------------------------------
// HEIGHT: terraces, slopes, cliffs, carved terrain, caves, fair play
// ---------------------------------------------------------------------------
console.log("\n-- HEIGHT --");
{
  const SEEDS = ["MAPCHECK-1", "EMBER", "12345-ABC", "FROSTPEAK", "DUNE", "ZED-9"];
  const N8: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  // HGT-1 determinism: two independent worlds of one seed agree on every height fact
  {
    const a = heightOf(new World(seedFromText("EMBER")));
    const b = heightOf(new World(seedFromText("EMBER")));
    let same = true;
    for (let i = 0; i < 4000 && same; i++) {
      const x = 1500 + ((i * 37) % 900);
      const y = 1700 + ((i * 53) % 900);
      same = a.level(x, y) === b.level(x, y) && a.isRamp(x, y) === b.isRamp(x, y) && a.isMouth(x, y) === b.isMouth(x, y) && a.caveOpen(CAVE_UPPER, x, y) === b.caveOpen(CAVE_UPPER, x, y);
    }
    ok(same, "height is a pure function of the seed (levels, slopes, mouths, caves)");
  }

  let canyonSeeds = 0;
  let mouthTotal = 0;
  for (const s of SEEDS) {
    const w = new World(seedFromText(s));
    const hf = heightOf(w);
    const st = w.startPoint();

    // HGT-2 landmarks sit on level plateaus with only gentle edges around them
    let flatOk = true;
    let gentleOk = true;
    for (const f of w.featuresNear(st.x, st.y, 260)) {
      const L = hf.level(f.x, f.y);
      for (let dy = -PIN_CORE; dy <= PIN_CORE && flatOk; dy++) {
        for (let dx = -PIN_CORE; dx <= PIN_CORE; dx++) {
          if (hf.isWater(f.x + dx, f.y + dy)) continue;
          if (hf.level(f.x + dx, f.y + dy) !== L) { flatOk = false; break; }
        }
      }
      for (let dy = -PIN_RAMP + 1; dy < PIN_RAMP && gentleOk; dy++) {
        for (let dx = -PIN_RAMP + 1; dx < PIN_RAMP; dx++) {
          const x = f.x + dx;
          const y = f.y + dy;
          if (!w.passable(x, y)) continue;
          for (const [ox, oy] of N8) {
            if (Math.max(Math.abs(dx + ox), Math.abs(dy + oy)) >= PIN_RAMP || !w.passable(x + ox, y + oy)) continue;
            const r = stepRule(w, SURFACE, x, y, x + ox, y + oy, PLAYER_MOVER);
            if (!r.ok || r.drop > 1) { gentleOk = false; break; }
          }
          if (!gentleOk) break;
        }
      }
    }
    ok(flatOk, `${s}: every landmark stands on a level plateau (never cut in half)`);
    ok(gentleOk, `${s}: no cliffs or ledges inside any landmark's approach`);

    // HGT-3 the start area is not boxed in: walking by slopes reaches a wide region
    const seen = new Set<number>([st.y * 4096 + st.x]);
    const q: [number, number][] = [[st.x, st.y]];
    let far = 0;
    while (q.length && seen.size < 12000) {
      const [x, y] = q.shift() as [number, number];
      far = Math.max(far, cheb(x, y, st.x, st.y));
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        const k = ny * 4096 + nx;
        if (seen.has(k) || !w.passable(nx, ny)) continue;
        const r = stepRule(w, SURFACE, x, y, nx, ny, PLAYER_MOVER);
        if (!r.ok || r.drop > 1) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    ok(seen.size >= 12000 && far >= 40, `${s}: start area opens onto ${seen.size}+ tiles by slopes (reach ${far})`);

    // HGT-4 riverbeds sit below their banks
    let rivers = 0;
    let raised = 0;
    for (let y = st.y - 200; y <= st.y + 200; y += 3) {
      for (let x = st.x - 200; x <= st.x + 200; x += 3) {
        if (w.tile(x, y).biome !== "river") continue;
        rivers++;
        for (const [dx, dy] of N8) {
          const nb = w.tile(x + dx, y + dy).biome;
          if (nb !== "river" && nb !== "lake" && nb !== "sea" && nb !== "deep" && hf.level(x + dx, y + dy) < hf.level(x, y) && !hf.inGentleZone(x, y)) raised++;
        }
      }
    }
    ok(rivers === 0 || raised / rivers < 0.05, `${s}: riverbeds lie below their banks (${raised} raised of ${rivers})`);

    // HGT-5 carved world: canyons exist somewhere, cave mouths ring the start
    let canyon = 0;
    for (let y = 0; y < 4096 && !canyon; y += 12) for (let x = 0; x < 4096; x += 12) if (hf.isCanyon(x, y)) { canyon++; break; }
    if (canyon) canyonSeeds++;
    const mouths = hf.mouthsIn(st.x - 400, st.y - 400, st.x + 400, st.y + 400);
    mouthTotal += mouths.length;
    ok(mouths.length >= 10, `${s}: cave mouths appear across the land (${mouths.length} within 400 tiles)`);
    ok(
      mouths.every((m) => !hf.isWater(m.x, m.y) && hf.level(m.x, m.y - 1) > hf.level(m.x, m.y) && !w.tile(m.x, m.y).feature && !w.siteAt(m.x, m.y)),
      `${s}: every cave mouth is set into the foot of higher ground, clear of landmarks`,
    );
    ok(mouths.every((m) => hf.caveOpen(CAVE_UPPER, m.x, m.y) && hf.caveOpen(CAVE_UPPER, m.x, m.y + 2)), `${s}: every cave mouth opens onto upper-cave floor`);
    let shafts = 0;
    let shaftOk = true;
    for (let cy = Math.floor((st.y - 400) / 56); cy <= Math.floor((st.y + 400) / 56); cy++) {
      for (let cx = Math.floor((st.x - 400) / 56); cx <= Math.floor((st.x + 400) / 56); cx++) {
        const k = hf.shaftKeyInCell(cx, cy);
        if (k < 0) continue;
        shafts++;
        if (!hf.caveOpen(CAVE_UPPER, k % 4096, Math.floor(k / 4096)) || !hf.caveOpen(CAVE_DEEP, k % 4096, Math.floor(k / 4096))) shaftOk = false;
      }
    }
    ok(shafts > 0 && shaftOk, `${s}: deep shafts link open floor on both cave layers (${shafts})`);
  }
  ok(canyonSeeds >= SEEDS.length - 1, `canyons carve the world on most seeds (${canyonSeeds}/${SEEDS.length})`);
  ok(mouthTotal > 0, "cave mouths exist");

  const g = newGame("HEIGHT-1", "Rook", "wanderer", "#e8742a", previewStarter("HEIGHT-1", "cindermaw"));
  g.party[0].level = 25;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  const hf = heightOf(w);
  const st = w.startPoint();

  // locate a sheer cliff (south foot below a 2+ level face) and a slope near start
  let cliff: { x: number; y: number; d: number } | null = null;
  let ramp: { x: number; y: number; lx: number; ly: number } | null = null;
  for (let r = 20; r < 500 && (!cliff || !ramp); r += 1) {
    for (let i = 0; i < 8 * r && (!cliff || !ramp); i += 3) {
      const a = (i / (8 * r)) * Math.PI * 2;
      const x = Math.round(st.x + Math.cos(a) * r);
      const y = Math.round(st.y + Math.sin(a) * r);
      if (!w.passable(x, y) || !w.passable(x, y - 1) || hf.isWater(x, y) || hf.isWater(x, y - 1)) continue;
      const d = hf.level(x, y - 1) - hf.level(x, y);
      if (!cliff && d >= 2 && !w.siteAt(x, y) && !w.siteAt(x, y - 1)) cliff = { x, y, d };
      if (!ramp && d === 1 && hf.isRamp(x, y - 1)) ramp = { x: x, y: y - 1, lx: x, ly: y };
    }
  }
  ok(!!cliff && !!ramp, "found a sheer cliff and a slope near the start");

  if (cliff && ramp) {
    // HGT-6 step rules per mover
    ok(!stepRule(w, SURFACE, cliff.x, cliff.y, cliff.x, cliff.y - 1, PLAYER_MOVER).ok, "walkers cannot climb a sheer cliff");
    ok(stepRule(w, SURFACE, ramp.lx, ramp.ly, ramp.x, ramp.y, PLAYER_MOVER).ok, "walkers climb one level by a slope");
    ok(stepRule(w, SURFACE, cliff.x, cliff.y, cliff.x, cliff.y - 1, moverOf("cragjaw")).ok, "climbers (Cragjaw) scale sheer cliffs");
    ok(stepRule(w, SURFACE, cliff.x, cliff.y, cliff.x, cliff.y - 1, moverOf("zephyr_hawk")).ok, "fliers ignore cliffs");
    const down = stepRule(w, SURFACE, cliff.x, cliff.y - 1, cliff.x, cliff.y, PLAYER_MOVER);
    ok(down.ok && down.drop === cliff.d, "stepping down is always physically possible");
    ok(fallLevels(PLAYER_MOVER, down.drop) === cliff.d - 1, "a drop of 2+ levels is a fall");
    ok(fallLevels(moverOf("zephyr_hawk"), 4) === 0 && fallLevels(moverOf("cragjaw"), 4) === 0, "fliers and climbers never fall");
    ok(fallLevels(PLAYER_MOVER, 1) === 0, "stepping down one level is never a fall");
    ok(fallDamage(100, 2) > fallDamage(100, 1) && fallDamage(100, 1) > 0, "higher falls hurt more");

    // HGT-7 movePlayer: refuses cliffs, warns then falls
    g.player.x = cliff.x;
    g.player.y = cliff.y;
    const steps0 = g.stats.steps;
    const up = movePlayer(g, 0, -1);
    ok(!up.ok && g.player.y === cliff.y && g.stats.steps === steps0, "the player is stopped by a sheer cliff");
    g.player.x = cliff.x;
    g.player.y = cliff.y - 1;
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.field = {};
    const hp0 = g.party[0].hp;
    const warn = movePlayer(g, 0, 1);
    ok(!warn.ok && g.player.y === cliff.y - 1, "a long drop asks for a second step first");
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.field = {};
    const jump = movePlayer(g, 0, 1);
    ok(jump.ok && g.player.y === cliff.y, "stepping again jumps down the ledge");
    if (cliff.d >= 2) ok(g.party[0].hp < hp0, `the party takes fall damage (${hp0} → ${g.party[0].hp})`);

    // HGT-8 pathfinding uses slopes and never jumps
    const p = findPath(w, ramp.lx, ramp.ly + 3, ramp.x, ramp.y - 2);
    let legal = !!p;
    let px = ramp.lx;
    let py = ramp.ly + 3;
    for (const [x, y] of p ?? []) {
      const r = stepRule(w, SURFACE, px, py, x, y, PLAYER_MOVER);
      if (!r.ok || r.drop > 1) legal = false;
      px = x;
      py = y;
    }
    ok(legal, `tap-to-travel routes climb by slopes and never jump (${p?.length ?? 0} steps)`);
    const pc = findPath(w, cliff.x, cliff.y, cliff.x, cliff.y - 1, 3000);
    ok(!pc || pc.length > 1, "routes never climb straight up a cliff face");

    // HGT-9 sight: cliffs hide what lies above and behind them; tops see down.
    // Needs a true plateau: a 2+ level face with level land behind its rim.
    let plateau: { x: number; y: number } | null = null;
    for (let r = 10; r < 600 && !plateau; r++) {
      for (let i = 0; i < 8 * r; i += 2) {
        const a = (i / (8 * r)) * Math.PI * 2;
        const x = Math.round(st.x + Math.cos(a) * r);
        const y = Math.round(st.y + Math.sin(a) * r);
        if (hf.isWater(x, y) || hf.isWater(x, y + 1)) continue;
        const R = hf.level(x, y - 1);
        if (R - hf.level(x, y) < 2 || hf.level(x, y + 1) > hf.level(x, y)) continue;
        if ([2, 3, 4, 5].every((k) => !hf.isWater(x, y - k) && hf.level(x, y - k) === R)) {
          plateau = { x, y };
          break;
        }
      }
    }
    ok(!!plateau, "found a plateau cliff for the sight test");
    if (plateau) {
      ok(!heightLOS(w, SURFACE, plateau.x, plateau.y + 1, plateau.x, plateau.y - 5), "standing below a cliff, you cannot see onto the land behind its rim");
      ok(heightLOS(w, SURFACE, plateau.x, plateau.y - 1, plateau.x, plateau.y + 1), "from the cliff top you can see down to its foot");
    }
  }

  // HGT-10 combat edge + mover types
  ok(heightEdge(5, 3) > 0 && heightEdge(3, 5) < 0 && heightEdge(4, 4) === 0, "high ground gives better aim; uphill attacks are harder");
  ok(heightEdge(20, 0) === heightEdge(2, 0), "height edge is capped");
  ok(moverOf("crystal_golem").heavy && moverOf("cragjaw").burrows && moverOf("cragjaw").climbs && moverOf("pipwisp").flies, "species derive climber/flier/heavy/burrower traits");
  ok(!moverOf("slimekin").climbs && !moverOf("slimekin").flies, "ordinary walkers neither climb nor fly");
  {
    let straddle: { x: number; y: number } | null = null;
    for (let y = st.y - 300; y < st.y + 300 && !straddle; y += 2) for (let x = st.x - 300; x < st.x + 300; x += 2) {
      if (!hf.isWater(x, y) && !hf.isWater(x + 1, y + 1) && Math.abs(hf.level(x, y) - hf.level(x + 1, y + 1)) >= 2) { straddle = { x, y }; break; }
    }
    ok(!!straddle && !bodyLevelOk(w, SURFACE, straddle.x, straddle.y, 2), "big bodies never straddle a cliff");
  }

  // HGT-11 underground: walk into a mouth, explore the cave layer, walk back out
  const mouth = hf.mouthsIn(st.x - 300, st.y - 300, st.x + 300, st.y + 300)[0];
  ok(!!mouth, "a cave mouth near the start");
  if (mouth) {
    g.player.x = mouth.x;
    g.player.y = mouth.y + 1;
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.field = {};
    const inR = movePlayer(g, 0, -1);
    ok(inR.ok && layerOf(g) === CAVE_UPPER, "stepping into a cave mouth takes you to the upper caves");
    ok(sightRadius(g) === CAVE_SIGHT, "caves have a short view range");
    const cres = Object.values(g.creatures);
    ok(cres.every((c) => c.layer === CAVE_UPPER && hf.caveOpen(CAVE_UPPER, c.x, c.y)), `cave wildlife lives on cave floor only (${cres.length})`);
    ok(cres.every((c) => CAVE_FAUNA[CAVE_UPPER].some(([id]) => id === c.speciesId)), "cave wildlife comes from the cave fauna");
    ok(Object.values(g.field).every((p) => hf.caveOpen(CAVE_UPPER, p.x, p.y)), "the party follows you underground");
    // wander a little through the tunnels
    let moved = 0;
    for (const [dx, dy] of [[0, 1], [0, 1], [1, 0], [-1, 0], [-1, 0], [1, 0], [0, -1]] as [number, number][]) {
      for (const id of Object.keys(g.creatures)) delete g.creatures[id];
      if (layerOf(g) !== CAVE_UPPER) break;
      const r = movePlayer(g, dx, dy);
      if (r.ok) moved++;
    }
    ok(moved >= 3, `you can explore the cave floor (${moved} steps)`);
    ok(Object.keys(g.knowledge.caves ?? {}).length > 0, "cave exploration is remembered separately");
    // walk back to the mouth and out
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.field = {};
    if (layerOf(g) === CAVE_UPPER) {
      const path = findPath(w, g.player.x, g.player.y, mouth.x, mouth.y + 1, 4000, CAVE_UPPER) ?? [];
      for (const [x, y] of path) {
        for (const id of Object.keys(g.creatures)) delete g.creatures[id];
        g.field = {};
        movePlayer(g, x - g.player.x, y - g.player.y);
      }
      for (const id of Object.keys(g.creatures)) delete g.creatures[id];
      g.field = {};
      movePlayer(g, mouth.x - g.player.x, mouth.y - g.player.y);
    }
    ok(layerOf(g) === SURFACE, "walking back onto the cave mouth leads out to the surface");
    ok(Object.values(g.creatures).every((c) => (c.layer ?? 0) === SURFACE), "surface wildlife returns when you come out");
    // deep caves via a shaft
    changeLayer(g, CAVE_DEEP);
    ok(layerOf(g) === CAVE_DEEP && Object.values(g.creatures).every((c) => c.layer === CAVE_DEEP), "the deep caves hold their own wildlife");
    changeLayer(g, SURFACE);
    ok(layerOf(g) === SURFACE && g.player.layer === undefined, "returning to the surface clears the layer field");
  }

  // HGT-12 inspect info
  if (cliff) {
    const gi = groundInfo(w, SURFACE, cliff.x, cliff.y - 1);
    ok(gi.level === hf.level(cliff.x, cliff.y - 1) && gi.cliff, "inspecting shows a tile's level and cliff edges");
  }
  if (ramp) ok(groundInfo(w, SURFACE, ramp.x, ramp.y).ramp, "inspecting shows slopes");

  // HGT-13 save migration: legacy saves load, unsafe spots are fixed, idempotent
  {
    const legacy = JSON.parse(JSON.stringify(g)) as GameState;
    legacy.version = 14;
    delete legacy.player.layer;
    delete (legacy.knowledge as { caves?: unknown }).caves;
    // a saved spot that is no longer standable (out in the sea)
    let sea: { x: number; y: number } | null = null;
    for (let r = 10; r < 1500 && !sea; r += 7) for (let a = 0; a < 16; a++) {
      const x = Math.round(st.x + Math.cos(a) * r);
      const y = Math.round(st.y + Math.sin(a) * r);
      if (w.inBounds(x, y) && w.tile(x, y).biome === "sea") { sea = { x, y }; break; }
    }
    if (sea) {
      legacy.player.x = sea.x;
      legacy.player.y = sea.y;
      const refield = migrateHeight(legacy, w);
      ok(refield && walkable(w, SURFACE, legacy.player.x, legacy.player.y), "a saved spot that is no longer safe moves to the nearest safe ground");
      ok(cheb(legacy.player.x, legacy.player.y, sea.x, sea.y) <= 24, "…and it is nearby");
    }
    ok(!!legacy.knowledge.caves, "cave knowledge is backfilled");
    const snap = JSON.stringify(legacy);
    migrateHeight(legacy, w);
    ok(JSON.stringify(legacy) === snap, "height migration is idempotent");
  }
}

// ---------------------------------------------------------------------------
// GROWTH (Phase 8): lifecycle, physical size, footprint classes
// ---------------------------------------------------------------------------
console.log("\n-- GROWTH --");
{
  const g = newGame("GROWTH-1", "Rook", "wanderer", "#e8742a", previewStarter("GROWTH-1", "slimekin"));
  g.party[0].level = 12;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  const shared = wildGenotypeFromSeed(99, "cragjaw");
  const baby = createMonster(g, "cragjaw", 5, { seed: 11, origin: "Test", stage: "newborn", genes: shared, sex: "female", personality: "gentle" });
  const adult = createMonster(g, "cragjaw", 5, { seed: 12, origin: "Test", genes: shared, sex: "female", personality: "gentle" });
  ok(baby.bornTick === g.tick && adult.bornTick < g.tick, "bred monsters enter as newborns; created adults are backdated (mature)");
  ok(bodyFootprint(baby, g.tick) === 1 && bodyFootprint(adult, g.tick) === 2, "a newborn Cragjaw is 1×1; a mature one is 2×2 (species footprint)");
  ok(physicalSize(baby, "cragjaw", g.tick) < physicalSize(adult, "cragjaw", g.tick), "newborns are physically smaller than adults of the same genes");
  ok(stageOf(baby.bornTick, "cragjaw", g.tick) === "newborn", "stage: newborn at birth");
  ok(stageOf(baby.bornTick, "cragjaw", baby.bornTick + NEWBORN_TICKS + 1) === "juvenile", "stage: juvenile after the newborn window");
  const matTick = baby.bornTick + matureAgeOf("cragjaw") + 1;
  ok(stageOf(baby.bornTick, "cragjaw", matTick) === "mature", "stage: mature after the growth span");
  ok(bodyFootprint(baby, matTick) === 2, "the same individual crosses the footprint threshold at maturity (1×1 → 2×2)");
  const smallGenes = { ...shared, size: { a: 26, b: 26 } };
  const bigGenes = { ...shared, size: { a: 48, b: 48 } };
  const hugeGenes = { ...shared, size: { a: 52, b: 52 } };
  ok(physicalSize({ genes: smallGenes }, "cragjaw", g.tick) < physicalSize({ genes: bigGenes }, "cragjaw", g.tick), "size genetics shift final physical size");
  ok(bodyFootprint({ speciesId: "cragjaw", genes: shared }, g.tick) === 2 && bodyFootprint({ speciesId: "cragjaw", genes: hugeGenes }, g.tick) === 3, "two individuals of one species can differ in physical dimensions (large lineage)");
  let parity = true;
  for (let expr = 5; expr <= 100; expr++) if (footprintClass(expr / 25) !== sizeToFootprint(expr)) parity = false;
  ok(parity, "footprint classification matches the legacy size thresholds across the whole allele range");
  let lineage = { ...smallGenes };
  const startSize = physicalSize({ genes: lineage }, "cragjaw", g.tick);
  for (let i = 0; i < 8; i++) lineage = { ...lineage, size: { a: Math.min(100, lineage.size.a + 6), b: Math.min(100, lineage.size.b + 6) } };
  ok(physicalSize({ genes: lineage }, "cragjaw", g.tick) > startSize, "size mutations propagate into larger lineages across generations");
  ok(statOf(baby, "hp", g.tick) < statOf(adult, "hp", g.tick) && statOf(baby, "atk", g.tick) < statOf(adult, "atk", g.tick), "growth scales hp and attack");
  ok(statOf(baby, "agi", g.tick) === statOf(adult, "agi", g.tick), "agility is untouched by size growth (the young stay quick)");
  ok(statOf(baby, "hp") === statOf(adult, "hp"), "without a tick, stats stay the mature values (legacy behavior)");
  ok(foodDemand(baby, "cragjaw", g.tick) < foodDemand(adult, "cragjaw", g.tick), "young eat less than adults");
  const wyrm = createMonster(g, "sunwyrm", 5, { seed: 13, origin: "Test", genes: wildGenotypeFromSeed(13, "sunwyrm") });
  ok(foodDemand(wyrm, "sunwyrm", g.tick) > foodDemand(adult, "cragjaw", g.tick), "larger species require more food");
  const youngDuke = createMonster(g, "cragjaw", 10, { seed: 14, origin: "Test", stage: "newborn", genes: shared, sex: "male" });
  const blocked = canMate(youngDuke, adult, "player", g.tick);
  ok(!blocked.ok && blocked.reason === "immature", "a level-10 newborn still cannot breed — maturity follows development, not level");
  const grownTick = youngDuke.bornTick + matureAgeOf("cragjaw") + 1;
  ok(stageOf(youngDuke.bornTick, "cragjaw", grownTick) === "mature" && canMate(youngDuke, adult, "player", grownTick).ok, "the same pair is permitted once growth completes");
  // collision + movement read the growth footprint
  let spot: { x: number; y: number } | null = null;
  outer: for (let r = 3; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = g.player.x + dx;
        const y = g.player.y + dy;
        if (w.inBounds(x, y) && w.passable(x, y) && !w.siteAt(x, y)?.wall && !creatureAt(g, x, y) && !partyMonAt(g, x, y)) {
          spot = { x, y };
          break outer;
        }
      }
    }
  }
  ok(!!spot, "found open ground for the footprint tests");
  if (spot) {
    const juv: WildCreature = {
      id: "grow:juv", speciesId: "stormmane_drake", level: 6, x: spot.x, y: spot.y, homeX: spot.x, homeY: spot.y, hpFrac: 1, satiety: 70,
      disposition: "calm", activity: "Wandering", personality: "gentle", geneSeed: 4242, genes: wildGenotypeFromSeed(4242, "stormmane_drake"), gen: 1,
      lineageId: "L:grow:juv", repro: makeReproProfile(wildReproMode("grow:juv", "stormmane_drake"), 6, 0), calmUntil: g.tick + 100000,
      alpha: false, affection: 0, stalking: false, bornTick: g.tick,
    };
    g.creatures["grow:juv"] = juv;
    ok(creatureAt(g, juv.x + 1, juv.y) === null, "a newborn of a Huge species occupies 1×1 (collision uses the growth footprint)");
    delete juv.bornTick;
    ok(creatureAt(g, juv.x + 1, juv.y) === juv, "the adult of the same body occupies 3×3");
    delete g.creatures["grow:juv"];
  }
  const pm = createMonster(g, "stormmane_drake", 6, { seed: 15, origin: "Test", stage: "newborn" });
  g.party.push(pm);
  g.field[pm.uid] = { x: g.player.x + 30, y: g.player.y + 30 };
  ok(partyMonAt(g, g.player.x + 31, g.player.y + 30) === null, "party collision sees the newborn's 1×1 body");
  g.party.pop();
  delete g.field[pm.uid];
  // growth transitions: delayed where the body cannot fit, applied where it can
  changeLayer(g, CAVE_UPPER);
  const hf = heightOf(w);
  let tunnel: { x: number; y: number } | null = null;
  let chamber: { x: number; y: number } | null = null;
  for (let y = g.player.y - 80; y < g.player.y + 80 && !(tunnel && chamber); y++) {
    for (let x = g.player.x - 80; x < g.player.x + 80; x++) {
      if (!hf.caveOpen(CAVE_UPPER, x, y)) continue;
      if (!tunnel && !hf.caveOpen(CAVE_UPPER, x - 1, y) && !hf.caveOpen(CAVE_UPPER, x + 1, y)) tunnel = { x, y };
      if (!chamber && [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]].every(([dx, dy]) => hf.caveOpen(CAVE_UPPER, x + dx, y + dy))) chamber = { x, y };
    }
  }
  if (tunnel && chamber) {
    const c: WildCreature = {
      id: "grow:cave", speciesId: "stormmane_drake", level: 6, x: tunnel.x, y: tunnel.y, homeX: tunnel.x, homeY: tunnel.y, hpFrac: 1, satiety: 70,
      disposition: "calm", activity: "Wandering", personality: "gentle", geneSeed: 4243, genes: wildGenotypeFromSeed(4243, "stormmane_drake"), gen: 1,
      lineageId: "L:grow:cave", repro: makeReproProfile(wildReproMode("grow:cave", "stormmane_drake"), 6, 0), calmUntil: g.tick + 100000,
      alpha: false, affection: 0, stalking: false, layer: CAVE_UPPER, fpCap: 1,
      bornTick: g.tick - NEWBORN_TICKS - growthSpan("stormmane_drake") - 1,
    };
    g.creatures["grow:cave"] = c;
    resolveGrowth(g, w);
    ok(c.fpCap === 1, "growth into 3×3 delays inside a 1-wide tunnel — the body never expands into rock");
    c.x = chamber.x;
    c.y = chamber.y;
    resolveGrowth(g, w);
    ok(c.fpCap === 3, "growth applies once the body fits (placement cap lifted)");
    delete g.creatures["grow:cave"];
  } else console.log("skip growth-placement checks (no tunnel/chamber in these caves)");
  changeLayer(g, 0);
  // backward compatibility
  const legacy = JSON.parse(JSON.stringify(g)) as GameState;
  legacy.version = 14;
  legacy.party[0].bornTick = legacy.tick; // pre-Phase-8 style: recent creation, no growth awareness
  migrateGrowth(legacy);
  ok(stageOf(legacy.party[0].bornTick, legacy.party[0].speciesId, legacy.tick) === "mature", "legacy adult monsters stay adult (bornTick backdated)");
  const snapTick = JSON.stringify(legacy.party[0].bornTick);
  migrateGrowth(legacy);
  ok(JSON.stringify(legacy.party[0].bornTick) === snapTick, "growth migration is idempotent");
  ok(bodyFootprint({ speciesId: "cragjaw" }, g.tick) === 2 && bodyFootprint({ speciesId: "stormmane_drake" }, g.tick) === 3, "bodies without growth data keep their species footprint");
}

// ---------------------------------------------------------------------------
// ECOLOGY (Phase 7): carrying capacity, pressures, vitals, spawning
// ---------------------------------------------------------------------------
console.log("\n-- ECOLOGY --");
{
  const g = newGame("ECO-1", "Rook", "wanderer", "#e8742a", previewStarter("ECO-1", "slimekin"));
  g.party[0].level = 12;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  // a quiet far-away stage keeps ambient spawns and territories out of the census
  let base: { x: number; y: number } | null = null;
  for (let r = 500; r < 1600 && !base; r += 40) {
    for (let a = 0; a < 12 && !base; a++) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const y = Math.round(g.player.y + Math.sin(a) * r);
      if (w.inBounds(x, y) && w.passable(x, y) && !w.siteAt(x, y)) base = { x, y };
    }
  }
  ok(!!base, "found a quiet far-away stage for the ecology scenario");
  if (base) {
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.player.x = base.x;
    g.player.y = base.y;
  }
  const mkWild = (id: string, speciesId: string, near: { x: number; y: number }, opts: { juvenile?: boolean; maxR?: number } = {}): WildCreature | null => {
    const maxR = opts.maxR ?? 8;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = near.x + dx;
          const y = near.y + dy;
          if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y) || (x === g.player.x && y === g.player.y)) continue;
          const c: WildCreature = {
            id, speciesId, level: 6, x, y, homeX: x, homeY: y, hpFrac: 1, satiety: 70, disposition: "calm", activity: "Wandering", personality: "gentle",
            geneSeed: 777, genes: wildGenotypeFromSeed(777, speciesId), gen: 1, lineageId: `L:${id}`,
            repro: makeReproProfile(wildReproMode(id, speciesId), 6, 0), calmUntil: g.tick + 100000, alpha: false, affection: 0, stalking: false,
          };
          if (opts.juvenile) c.bornTick = g.tick;
          g.creatures[id] = c;
          return c;
        }
      }
    }
    return null;
  };
  const first = mkWild("eco:seed", "slimekin", g.player);
  const t = first ? createTerritory(g, "slimekin", g.player.x, g.player.y) : null;
  ok(!!first && !!t, "the Phase 6 territory anchors the ecological census");
  if (t && first) {
    const cens = () => buildCensus(g, w, 0).get(t.id);
    const sparse = assessTerritory(g, w, t, cens());
    ok(sparse.capacity >= 1 && sparse.food > 0 && sparse.adults === 1 && sparse.juveniles === 0, "capacity is derived from the environment; the census reads the range");
    ok(sparse.territoryId === t.id && sparse.quality === t.quality, "the assessment queries the existing Territory object (no second representation)");
    ok(sparse.reproductive === 1, "reproductive adults are counted through the reproduction system");
    // density pressure: pack the range past its carrying capacity
    for (let i = 0; i < sparse.capacity + 8; i++) mkWild(`eco:crowd:${i}`, "slimekin", g.player);
    const crowded = assessTerritory(g, w, t, cens());
    ok(crowded.density > 1, `over-capacity ranges read as dense (${crowded.adults + crowded.juveniles} of ${crowded.capacity})`);
    ok(crowded.migrationPressure > sparse.migrationPressure, "density raises migration pressure (exposed for Phase 9 behavior)");
    ok(adultMortalityChance(crowded) > 0 && adultMortalityChance(sparse) === 0, "adult mortality pressure exists only under scarcity + crowding");
    ok(!allowsBreeding(g, w, first, new Rng(1)), "breeding is refused outright under extreme density");
    ok(!spawnAllowedByEcology(g, w, 0, t.x, t.y, "slimekin", buildCensus(g, w, 0)), "a territory holding its species share refuses new immigrants");
    // nest scarcity + predator pressure on a neighboring range (kept outside t's radius)
    let henSpot: { x: number; y: number } | null = null;
    for (let r = 12; r <= 18 && !henSpot; r++) {
      for (let a = 0; a < 16 && !henSpot; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.round(g.player.x + Math.cos(ang) * r);
        const y = Math.round(g.player.y + Math.sin(ang) * r);
        if (w.inBounds(x, y) && Math.max(Math.abs(x - g.player.x), Math.abs(y - g.player.y)) >= 12 && w.passable(x, y) && !w.siteAt(x, y) && !creatureAt(g, x, y)) henSpot = { x, y };
      }
    }
    if (henSpot) {
      const hen = mkWild("eco:hen", "dunescuttle", henSpot, { maxR: 0 });
      const t2 = hen ? createTerritory(g, "dunescuttle", hen.x, hen.y) : null;
      if (hen && t2) {
        const cens2 = () => buildCensus(g, w, 0).get(t2.id);
        const bare = assessTerritory(g, w, t2, cens2());
        const nest = createNest(g, hen.id, "dunescuttle", hen.x + 1, hen.y);
        attachNest(g, nest, hen.id);
        const nested = assessTerritory(g, w, t2, cens2());
        ok(developmentTypeFor("dunescuttle", "sexual") === "egg" && bare.nestAvailability < nested.nestAvailability, "nest scarcity lowers nest availability");
        ok(nested.capacity >= bare.capacity, "nests raise carrying capacity for egg-layers");
        let predSpot: { x: number; y: number } | null = null;
        for (let r = 0; r <= 4 && !predSpot; r++) {
          for (let dy = -r; dy <= r && !predSpot; dy++) {
            for (let dx = -r; dx <= r && !predSpot; dx++) {
              const x = henSpot.x + dx;
              const y = henSpot.y + dy;
              if (Math.max(Math.abs(x - g.player.x), Math.abs(y - g.player.y)) >= 11 && w.passable(x, y) && !w.siteAt(x, y) && !creatureAt(g, x, y)) predSpot = { x, y };
            }
          }
        }
        if (predSpot) {
          mkWild("eco:pred", "cindermaw", predSpot, { maxR: 0 });
          const withPred = assessTerritory(g, w, t2, cens2());
          ok(withPred.predatorPressure > bare.predatorPressure && withPred.factors.predatorModifier < bare.factors.predatorModifier, "carnivores in range register as predator pressure and suppress capacity");
          ok(juvenileMortalityChance(withPred, true) > juvenileMortalityChance(bare, true), "predators lower juvenile survival");
          ok(juvenileMortalityChance(withPred, false) > juvenileMortalityChance(withPred, true), "lost nests endanger juveniles further");
        }
      }
    } else console.log("skip nest/predator checks (no room for the hen)");
    // the ecology loop never bypasses reproduction: only removals, no creations
    const ids = new Set(Object.keys(g.creatures));
    let removed = 0;
    for (let i = 0; i < 8; i++) {
      g.tick += ECOLOGY_INTERVAL;
      ecologyTick(g, w, (id) => {
        removed++;
        delete g.creatures[id];
      });
    }
    ok(Object.keys(g.creatures).every((id) => ids.has(id)), "the ecology loop only removes pressured bodies — it never creates offspring");
    void removed;
    // recovery once conditions improve
    for (const id of Object.keys(g.creatures)) if (id.startsWith("eco:crowd")) delete g.creatures[id];
    const recovered = assessTerritory(g, w, t, cens());
    ok(recovered.migrationPressure < crowded.migrationPressure && recovered.density < 1.01, "after conditions improve, pressure falls — populations can recover");
    let bred = false;
    for (let i = 0; i < 10 && !bred; i++) bred = allowsBreeding(g, w, first, new Rng(1000 + i));
    ok(bred, "breeding is permitted again on a recovered range");
    ok(spawnAllowedByEcology(g, w, 0, (t.x + 2000) % 4096, (t.y + 2000) % 4096, "slimekin", buildCensus(g, w, 0)), "unclaimed wilds remain open to immigration");
    ok(CREATURE_CAP >= 100, "the technical spawn cap exists separately from ecological capacity");
    // vitals + region aggregates (Phase 11 seed)
    ecoOnBirth(g, "slimekin", t.x, t.y, true);
    ecoOnDeath(g, "slimekin", t.x, t.y, true);
    const v = g.ecology?.vitals.slimekin;
    ok(!!v && v.births === 1 && v.deaths === 1 && v.juvenileDeaths === 1, "births and deaths are recorded as species vitals");
    const reg = Object.values(g.ecology?.regions ?? {}).flat().find((p) => p.speciesId === "slimekin");
    ok(!!reg && reg.pop === 0 && reg.births === 1 && reg.deaths === 1, "aggregate per-region populations track the same events");
  }
  // existing spawning still populates the world (ecology-gated, not disabled)
  for (const id of Object.keys(g.creatures)) delete g.creatures[id];
  let teleported = false;
  for (let r = 400; r < 1600 && !teleported; r += 40) {
    for (let a = 0; a < 12 && !teleported; a++) {
      const x = Math.round(g.player.x + Math.cos(a) * r);
      const y = Math.round(g.player.y + Math.sin(a) * r);
      if (w.inBounds(x, y) && w.passable(x, y) && !w.siteAt(x, y)) {
        g.player.x = x;
        g.player.y = y;
        teleported = true;
      }
    }
  }
  g.loadedChunks = [];
  loadChunks(g);
  ok(teleported && Object.keys(g.creatures).length >= 3, `spawning still works in unclaimed wilds (${Object.keys(g.creatures).length} residents)`);
  advance(g, 90);
  ok(g.party[0].hp >= 0 && Object.keys(g.creatures).length <= CREATURE_CAP, "advance() runs cleanly with the ecology tick wired in");
  ok(g.version === 19, "save version 19");
  migrateEcology(g);
  const snap = JSON.stringify(g.ecology);
  migrateEcology(g);
  ok(JSON.stringify(g.ecology) === snap, "ecology migration is idempotent");
}

// ---------------------------------------------------------------------------
// LINEAGE (Phase 10): persistent ancestry, inheritance, mutation
// ---------------------------------------------------------------------------
console.log("\n-- LINEAGE --");
{
  const g = newGame("LINE-1", "Rook", "wanderer", "#e8742a", previewStarter("LINE-1", "slimekin"));
  g.party[0].level = 12;
  g.party[0].hp = statOf(g.party[0], "hp");
  const mkParent = (seed: number, sex: Sex, sizeAllele: number, vigorAllele: number, lineageId: string): Monster => {
    const m = createMonster(g, "cragjaw", 10, { seed, origin: "Test", sex });
    m.genes = { ...m.genes, size: { a: sizeAllele, b: sizeAllele }, vigor: { a: vigorAllele, b: vigorAllele } };
    m.lineageId = lineageId;
    m.generation = 3;
    m.mutHistory = [];
    return m;
  };
  const mom = mkParent(101, "female", 90, 80, "L:test101");
  const dad = mkParent(102, "male", 80, 70, "L:test102");
  g.party.push(mom, dad);
  const r1 = requestBreeding(g, mom.uid, dad.uid);
  ok(r1.ok, "player breeding runs through the unified pipeline");
  let kid: Monster | undefined;
  if (r1.ok) {
    g.tick = r1.development.completeTick + 1;
    advanceDevelopment(g);
    kid = [...g.party, ...g.pen].find((m) => m.parents?.includes(mom.uid));
    ok(!!kid, "offspring materializes when development completes");
    if (kid) {
      ok(kid.parents?.length === 2 && kid.parents.includes(mom.uid) && kid.parents.includes(dad.uid), "parent references are valid");
      ok(kid.generation === 4, "generation advances past both parents");
      ok(kid.lineageId === [mom.lineageId!, dad.lineageId!].sort()[0], "lineage id follows the ancestry policy without touching species");
      const inheritOk = GENE_KEYS.every((k) => {
        const legal = [mom.genes[k].a, mom.genes[k].b, dad.genes[k].a, dad.genes[k].b];
        const near = (v: number): boolean => legal.some((pa) => Math.abs(v - pa) <= 6);
        return near(kid!.genes[k].a) && near(kid!.genes[k].b);
      });
      ok(inheritOk, "every allele descends from a parent allele within drift (Mendelian inheritance + mutation)");
      ok(GENE_KEYS.every((k) => kid!.genes[k].a >= 5 && kid!.genes[k].a <= 100 && kid!.genes[k].b >= 5 && kid!.genes[k].b <= 100), "genes stay within the legal 5–100 range");
      const rec = lineageSummary(g, kid.lineageId!);
      ok(!!rec && rec.depth >= 4 && rec.historical >= 1, "lineage record tracks the birth");
      ok(childrenOf(g, mom.uid).includes(kid.uid), "offspring index query works");
      // sibling: same parents, a different draw
      g.tick += BREED_COOLDOWN_TICKS;
      const r2 = requestBreeding(g, mom.uid, dad.uid);
      ok(r2.ok, "breeding respects and then clears cooldowns");
      if (r2.ok) {
        g.tick = r2.development.completeTick + 1;
        advanceDevelopment(g);
        const kid2 = [...g.party, ...g.pen].find((m) => m.parents?.includes(mom.uid) && m.uid !== kid!.uid);
        ok(!!kid2 && JSON.stringify(kid2!.genes) !== JSON.stringify(kid!.genes), "siblings receive different valid genotypes");
        ok(!!kid2 && relatedness(kid, kid2) !== "unrelated", "relatedness reads shared ancestry correctly");
      }
      // cross-species player breeding keeps ancestry valid and species separate
      const male2 = mkParent(103, "male", 70, 75, "L:test103");
      g.party.push(male2);
      const slime = createMonster(g, "slimekin", 10, { seed: 201, origin: "Test", sex: "female" });
      g.party.push(slime);
      const r3 = requestBreeding(g, male2.uid, slime.uid);
      ok(r3.ok, "player cross-species breeding stays permitted");
      if (r3.ok) {
        g.tick = r3.development.completeTick + 1;
        advanceDevelopment(g);
        const cross = [...g.party, ...g.pen].find((m) => m.parents?.includes(slime.uid));
        ok(!!cross && (cross.speciesId === "cragjaw" || cross.speciesId === "slimekin"), "cross-species offspring receives a valid species");
        ok(!!cross && cross.lineageId === [male2.lineageId!, slime.lineageId!].sort()[0], "cross-species lineage merges ancestry without overriding species");
        ok(!!cross && relatedness(kid, cross) === "unrelated", "different lineages read as unrelated");
      }
      ok(statOf(kid, "hp", g.tick) > 0, "phenotype stats keep deriving from the authoritative genotype");
    }
  }
  // mutation: bidirectional and bounded
  let up = 0;
  let down = 0;
  for (let i = 0; i < 400; i++) {
    const p = mutateGene({ a: 60, b: 60 }, new Rng(5000 + i));
    if (p.a > 60 || p.b > 60) up++;
    if (p.a < 60 || p.b < 60) down++;
  }
  ok(up > 20 && down > 20, `mutations move gene values both upward (${up}) and downward (${down})`);
  let lo: GenePair = { a: 5, b: 5 };
  let hi: GenePair = { a: 100, b: 100 };
  for (let i = 0; i < 300; i++) {
    lo = mutateGene(lo, new Rng(9000 + i));
    hi = mutateGene(hi, new Rng(9500 + i));
  }
  ok(lo.a >= 5 && lo.b >= 5 && hi.a <= 100 && hi.b <= 100, "mutation clamps within the legal allele range");
  // selective breeding keeps exceptional traits in the lineage (deterministic chain)
  {
    const rng = new Rng(4242);
    let genes: Genome = mom.genes;
    for (let i = 0; i < 6; i++) genes = driftGenome(inheritGenome(genes, dad.genes, rng), rng);
    ok(expressGene(genes.size) >= 50, "repeated large-parent breeding keeps large size potential in the lineage");
  }
  // ancestor removal does not invalidate descendants
  g.party = g.party.filter((m) => m !== mom);
  if (kid) ok(childrenOf(g, mom.uid).includes(kid.uid) && !!lineageSummary(g, kid.lineageId!), "removing an ancestor does not invalidate descendant ancestry");
  // save round trip
  const snapKid = kid ? JSON.stringify({ genes: kid.genes, lin: kid.lineageId, par: kid.parents, mut: kid.mutHistory }) : "";
  const rt = JSON.parse(JSON.stringify(g)) as GameState;
  const kidRT = [...rt.party, ...rt.pen].find((m) => m.uid === kid?.uid);
  ok(!!kidRT && !!kid && JSON.stringify({ genes: kidRT.genes, lin: kidRT.lineageId, par: kidRT.parents, mut: kidRT.mutHistory }) === snapKid, "saving and loading preserves genotype, ancestry, lineage id and mutation history");
  // legacy migration
  const legacy = JSON.parse(JSON.stringify(g)) as GameState;
  legacy.version = 16;
  for (const m of [...legacy.party, ...legacy.pen]) {
    delete m.lineageId;
    delete m.generation;
    delete m.mutHistory;
    m.parents = null;
  }
  for (const c of Object.values(legacy.creatures)) {
    delete c.lineageId;
    delete c.gen;
    delete c.parents;
  }
  legacy.lineages = {};
  legacy.childIndex = {};
  migrateBiology(legacy);
  migrateLineages(legacy);
  ok([...legacy.party, ...legacy.pen, ...Object.values(legacy.creatures)].every((b) => !!b.lineageId), "older saves without lineage metadata are backfilled as founders");
  ok(Object.keys(legacy.lineages).length >= 1 && Object.values(legacy.lineages).every((r) => r.living >= 1), "migration creates living lineage records");
  const snapLin = JSON.stringify(legacy.lineages);
  migrateLineages(legacy);
  ok(JSON.stringify(legacy.lineages) === snapLin, "lineage migration is idempotent");
  // many generations, bounded queries
  for (let gen = 2; gen <= 8; gen++) {
    recordLineageBirth(g, { uid: `gen${gen}`, speciesId: "cragjaw", lineageId: "L:deep", generation: gen, genes: dad.genes } as unknown as Monster, [`gen${gen - 1}`]);
  }
  ok(lineageSummary(g, "L:deep")?.depth === 8, "lineage depth scales across many generations");
  ok(childrenOf(g, "gen7").includes("gen8"), "multi-generation ancestry queries stay functional");
  // exactly-once delivery
  if (kid) {
    const n = [...g.party, ...g.pen].filter((m) => m.parents?.includes(mom.uid)).length;
    advanceDevelopment(g);
    ok([...g.party, ...g.pen].filter((m) => m.parents?.includes(mom.uid)).length === n, "repeated event processing does not duplicate offspring");
  }
}

// ---------------------------------------------------------------------------
// WILDLIFE (Phase 9): needs-driven decisions, territory, migration
// ---------------------------------------------------------------------------
console.log("\n-- WILDLIFE --");
{
  const g = newGame("WILD-1", "Rook", "wanderer", "#e8742a", previewStarter("WILD-1", "slimekin"));
  g.party[0].level = 12;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  let base: { x: number; y: number } | null = null;
  for (let r = 500; r < 1600 && !base; r += 40) {
    for (let a = 0; a < 16 && !base; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = Math.round(g.player.x + Math.cos(ang) * r);
      const y = Math.round(g.player.y + Math.sin(ang) * r);
      const b = w.inBounds(x, y) ? BIOMES[w.tile(x, y).biome] : null;
      if (b && b.passable && w.tile(x, y).biome === "meadow" && !w.siteAt(x, y)) base = { x, y };
    }
  }
  ok(!!base, "found a forage-rich quiet stage");
  if (base) {
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.player.x = base.x;
    g.player.y = base.y;
    const cheb2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const mkWild = (id: string, speciesId: string, near: { x: number; y: number }, opts: { satiety?: number; hpFrac?: number; alpha?: boolean; level?: number; maxR?: number; disposition?: Disposition } = {}): WildCreature | null => {
      const maxR = opts.maxR ?? 6;
      for (let r = 0; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = near.x + dx;
            const y = near.y + dy;
            if (!w.inBounds(x, y) || !w.passable(x, y) || w.siteAt(x, y)?.wall || creatureAt(g, x, y) || partyMonAt(g, x, y) || (x === g.player.x && y === g.player.y)) continue;
            const c: WildCreature = {
              id, speciesId, level: opts.level ?? 6, x, y, homeX: x, homeY: y, hpFrac: opts.hpFrac ?? 1, satiety: opts.satiety ?? 80,
              disposition: opts.disposition ?? "calm", activity: "Wandering", personality: "gentle", geneSeed: 777,
              genes: wildGenotypeFromSeed(777, speciesId), gen: 1, lineageId: `L:${id}`,
              repro: makeReproProfile(wildReproMode(id, speciesId), opts.level ?? 6, 0), calmUntil: g.tick + 100000, alpha: opts.alpha ?? false,
              affection: 0, stalking: false,
            };
            g.creatures[id] = c;
            return c;
          }
        }
      }
      return null;
    };
    // hungry monsters find and eat available food
    const hungry = mkWild("w:hungry", "slimekin", base, { satiety: 10 });
    const s0 = hungry?.satiety ?? 0;
    let ate = false;
    for (let i = 0; i < 20 && !ate && hungry && g.creatures["w:hungry"]; i++) {
      advance(g, 10);
      ate = hungry.satiety > s0 || g.depleted[`${hungry.x},${hungry.y}`] !== undefined;
    }
    ok(ate, "a hungry monster seeks out and eats available food");
    // fleeing a credible threat
    const rabbit = mkWild("w:rabbit", "slimekin", base, { satiety: 80 });
    const wolf = rabbit ? mkWild("w:wolf", "cindermaw", rabbit, { satiety: 30, disposition: "aggressive", maxR: 2 }) : null;
    const d0 = rabbit && wolf ? cheb2(rabbit, wolf) : 99;
    if (rabbit && wolf) advance(g, 4);
    ok(!rabbit || !g.creatures["w:rabbit"] || cheb2(rabbit, wolf) > d0 || rabbit.activity.includes("Flee"), "monsters flee credible threats");
    // badly hurt monsters break off
    const hurt = mkWild("w:hurt", "slimekin", base, { satiety: 80, hpFrac: 0.15, maxR: 4 });
    const dP = hurt ? cheb2(hurt, g.player) : 0;
    if (hurt) advance(g, 4);
    ok(!hurt || !g.creatures["w:hurt"] || cheb2(hurt, g.player) > dP || hurt.activity === "Fleeing, hurt", "badly hurt monsters break off and run");
    // predator pursuit
    const hawk = mkWild("w:hawk", "zephyr_hawk", base, { satiety: 20, level: 8, maxR: 5 });
    const snack = hawk ? mkWild("w:snack", "slimekin", hawk, { satiety: 80, maxR: 3 }) : null;
    // a fresh kill lying nearby must not outrank the hunt this check studies
    for (const id of Object.keys(g.carrion ?? {})) {
      const m = (g.carrion ?? {})[id];
      if (hawk && cheb2(m, hawk) <= 9) delete g.carrion[id];
    }
    const dh = hawk && snack ? cheb2(hawk, snack) : 99;
    let minD = dh;
    let sawHunt = false;
    if (hawk && snack) {
      for (let i = 0; i < 10 && g.creatures["w:snack"]; i++) {
        advance(g, 2);
        if (hawk.activity.startsWith("Hunting")) sawHunt = true;
        if (g.creatures["w:snack"]) minD = Math.min(minD, cheb2(hawk, snack));
      }
    }
    ok(!hawk || !snack || !g.creatures["w:snack"] || minD < dh || sawHunt, "predators pursue suitable prey without teleporting");
    // territory return (kept within the simulation radius: SIM_R is 30)
    const t = createTerritory(g, "cragjaw", base.x + 14, base.y);
    const homing = mkWild("w:home", "cragjaw", { x: base.x + 28, y: base.y }, { satiety: 80, maxR: 1 });
    if (homing) homing.territoryId = t.id;
    const dh2 = homing ? cheb2(homing, t) : 99;
    if (homing) advance(g, 12);
    ok(!homing || !g.creatures["w:home"] || cheb2(homing, t) < dh2, "monsters return to their territory when displaced");
    // alpha territory defense
    const alpha = mkWild("w:alpha", "cindermaw", { x: base.x - 22, y: base.y + 10 }, { satiety: 80, alpha: true });
    const t2 = alpha ? createTerritory(g, "cindermaw", alpha.x, alpha.y) : null;
    if (alpha && t2) {
      alpha.territoryId = t2.id;
      t2.ownerId = alpha.id;
    }
    const intr = alpha ? mkWild("w:intr", "slimekin", { x: alpha.x - 4, y: alpha.y }, { satiety: 80, maxR: 1 }) : null;
    const dA = alpha && intr ? cheb2(alpha, intr) : 99;
    if (alpha && intr) advance(g, 10);
    ok(
      !alpha || !intr || alpha.activity === "Defending its territory" || !g.creatures["w:alpha"] || cheb2(alpha, intr) < dA || intr.hpFrac < 1 || intr.disposition === "skittish",
      "alphas defend their territory against intruders",
    );
    // dominance transfer keeps ownership with the territory system
    const weakAlpha = mkWild("w:walpha", "cindermaw", { x: base.x + 10, y: base.y - 24 }, { satiety: 80, alpha: true, level: 4 });
    const t3 = weakAlpha ? createTerritory(g, "cindermaw", weakAlpha.x, weakAlpha.y) : null;
    if (weakAlpha && t3) {
      weakAlpha.territoryId = t3.id;
      t3.ownerId = weakAlpha.id;
      weakAlpha.hpFrac = 0.5;
    }
    const challenger = weakAlpha ? mkWild("w:chal", "cindermaw", weakAlpha, { satiety: 80, level: 15, maxR: 2 }) : null;
    const minion = weakAlpha ? mkWild("w:minion", "cindermaw", weakAlpha, { satiety: 80, maxR: 3 }) : null;
    if (minion && weakAlpha) minion.pack = weakAlpha.id;
    ok(profileOf("cindermaw").challenges, "cindermaw's behavioral profile allows dominance challenges");
    if (weakAlpha && t3 && challenger) {
      seizeTerritory(g, challenger, weakAlpha, g.tick);
      ok(!weakAlpha.alpha && challenger.alpha, "a deposed alpha loses rank to the challenger");
      ok(t3.ownerId === challenger.id, "territory ownership transfers through the territory system's own fields");
      ok(!minion || minion.pack === challenger.id, "pack loyalty follows the new alpha");
    }
    // nest defense
    const hen = mkWild("w:hen", "dunescuttle", { x: base.x, y: base.y + 26 }, { satiety: 80 });
    if (hen) {
      const nest = createNest(g, hen.id, "dunescuttle", hen.x + 1, hen.y);
      attachNest(g, nest, hen.id);
      if (hen.repro) hen.repro.nestId = nest.id;
      const dev: ReproductiveDevelopment = {
        id: "d:wild", parentIds: [hen.id, hen.id], speciesId: "dunescuttle", pairing: "sexual", type: "egg", state: "developing",
        startTick: g.tick, completeTick: g.tick + 500, nestId: nest.id, origin: "wild",
      };
      g.developments["d:wild"] = dev;
      nest.developmentIds.push("d:wild");
      const thief = mkWild("w:thief", "cindermaw", { x: hen.x + 2, y: hen.y }, { satiety: 80, maxR: 1 });
      const dH = thief ? cheb2(hen, thief) : 99;
      advance(g, 8);
      ok(!hen || !g.creatures["w:hen"] || !thief || !g.creatures["w:thief"] || hen.activity.includes("Defend") || cheb2(hen, thief) < dH, "monsters defend nests with developing young");
    }
    // migration under population pressure
    const spot2 = { x: base.x + 22, y: base.y - 12 };
    const t4 = createTerritory(g, "slimekin", spot2.x, spot2.y);
    const residents: WildCreature[] = [];
    for (let i = 0; i < 25; i++) {
      const r = mkWild(`w:mig:${i}`, "slimekin", spot2, { satiety: 95, maxR: 6 });
      if (r) {
        r.territoryId = t4.id;
        residents.push(r);
      }
    }
    advance(g, 240);
    const moved = residents.filter((r) => g.creatures[r.id] && (r.territoryId !== t4.id || cheb2(r, t4) > 13));
    ok(moved.length >= 1, `overcrowded monsters migrate away from their range (${moved.length}/${residents.length} left)`);
    ok(moved.every((r) => r.migrateUntil !== undefined), "migrated bodies carry an anti-oscillation cooldown");
    ok(residents.every((r) => !g.creatures[r.id] || cheb2(r, spot2) <= 240), "migration happens through real movement (no teleporting)");
    // AI processing stays bounded
    const t0 = performance.now();
    advance(g, 40);
    const ms = performance.now() - t0;
    ok(ms < 5000, `AI processing remains bounded (${Math.round(ms)}ms for 40 ticks, ${Object.keys(g.creatures).length} bodies)`);
  }
}

/* ---------------- Phase 11: persistent distant ecosystem ---------------- */
{
  const g = newGame("DIST-1", "R", "wanderer", "#e8742a", previewStarter("DIST-1", "slimekin"));
  g.party[0].level = 12;
  g.party[0].hp = statOf(g.party[0], "hp");
  const w = getWorld(g.seed);
  let stage: { cx: number; cy: number; x: number; y: number } | null = null;
  for (let r = 500; r < 1600 && !stage; r += 40) {
    for (let a = 0; a < 16 && !stage; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = Math.round(g.player.x + Math.cos(ang) * r);
      const y = Math.round(g.player.y + Math.sin(ang) * r);
      if (!w.inBounds(x, y)) continue;
      const t = w.tile(x, y);
      if (t.biome !== "meadow" || !BIOMES[t.biome].passable || t.feature || w.siteAt(x, y)) continue;
      stage = { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK), x: Math.floor(x / CHUNK) * CHUNK + 4, y: Math.floor(y / CHUNK) * CHUNK + 4 };
    }
  }
  ok(!!stage, "found a quiet meadow stage for distant simulation");
  if (stage) {
    const { cx, cy, x: bx, y: by } = stage;
    for (const id of Object.keys(g.creatures)) delete g.creatures[id];
    g.loadedChunks = [chunkKey(0, cx, cy)];
    g.player.x = bx;
    g.player.y = by;
    const flatGenes = (v: number): Genes => {
      const o = {} as Genes;
      for (const k of GENE_KEYS) o[k] = v;
      return o;
    };
    const mk = (id: string, speciesId: string, dx: number, dy: number, opts: { satiety?: number; level?: number; bornTick?: number; gen?: number } = {}): WildCreature => {
      const c: WildCreature = {
        id, speciesId, level: opts.level ?? 6, x: bx + dx, y: by + dy, homeX: bx + dx, homeY: by + dy, hpFrac: 1,
        satiety: opts.satiety ?? 80, disposition: "calm", activity: "Wandering", personality: "gentle", geneSeed: 777,
        genes: wildGenotypeFromSeed(777 + hashString(id), speciesId), gen: opts.gen ?? 1, lineageId: `L:${id}`,
        repro: makeReproProfile(wildReproMode(id, speciesId), opts.level ?? 6, 0), bornTick: opts.bornTick,
        calmUntil: g.tick + 100000, alpha: false, affection: 0, stalking: false,
      };
      g.creatures[id] = c;
      return c;
    };
    // controlled population: 10 adult + 2 juvenile slimekin, 3 cindermaw predators, 1 exceptional slimekin
    for (let i = 0; i < 10; i++) mk(`d${i}`, "slimekin", (i % 4) * 2, Math.floor(i / 4) * 2);
    mk("dj1", "slimekin", 7, 4, { bornTick: g.tick - 400 });
    mk("dj2", "slimekin", 5, 4, { bornTick: g.tick - 400 });
    for (let i = 0; i < 3; i++) mk(`dc${i}`, "cindermaw", 1 + i * 2, 8);
    mk("de1", "slimekin", 8, 6, { gen: 5 });
    // a wild brood whose egg must keep developing while the region is abstracted
    const nest = createNest(g, "d0", "slimekin", bx + 3, by + 1);
    attachNest(g, nest, "d0");
    const child = {
      speciesId: "slimekin", sex: "female" as Sex, level: 2, genes: wildGenotypeFromSeed(4242, "slimekin"),
      mutations: [], personality: "gentle", skills: ["tackle"], plus: 0, bond: 0,
      generation: 2, lineageId: "L:d0", mutHistory: [], parents: ["d0", "d2"] as [string, string], parentNames: ["d0", "d2"],
    };
    const dev: ReproductiveDevelopment = {
      id: "d:far", parentIds: ["d0", "d2"], speciesId: "slimekin", pairing: "sexual", type: "egg", state: "developing",
      startTick: g.tick, completeTick: g.tick + 500, nestId: nest.id, origin: "wild", child,
    };
    g.developments["d:far"] = dev;
    nest.developmentIds.push("d:far");
    // leave: the chunk unloads and its wildlife folds into abstract populations
    g.player.x = bx + CHUNK * 7;
    loadChunks(g);
    const key = distantKey(0, cx, cy);
    const reg = g.distant?.[key];
    ok(!!reg && reg.abstracted, "leaving a region folds its wildlife into an abstract population");
    const slimePop = reg?.pops.find((p) => p.speciesId === "slimekin");
    ok(slimePop?.count === 12, `abstract population counts every ordinary member (${slimePop?.count})`);
    ok(slimePop?.juveniles === 2, "life-stage mix survives abstraction");
    ok(reg?.pops.find((p) => p.speciesId === "cindermaw")?.count === 3, "predators abstract into their own population");
    ok(slimePop?.lineageId === "L:d0", "population-level ancestry is preserved");
    ok(!!g.creatures["de1"], "exceptional individuals remain individually represented");
    ok(!g.creatures["d0"] && !g.creatures["dc0"], "abstracted members no longer exist as bodies");

    // ---- unit-level abstract ecology on crafted regions ----
    const chunkOk = (ax: number, ay: number, biome?: string): boolean => {
      const x2 = ax * CHUNK + 8;
      const y2 = ay * CHUNK + 8;
      if (!w.inBounds(x2, y2)) return false;
      const t = w.tile(x2, y2);
      if (t.feature || w.siteAt(x2, y2)) return false;
      return biome ? t.biome === biome : BIOMES[t.biome].passable;
    };
    const ring: [number, number][] = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) ring.push([cx + dx, cy + dy]);
    const foodScore = (ax: number, ay: number): number => {
      const sx = ax * CHUNK + 8;
      const sy = ay * CHUNK + 8;
      let s = 0;
      for (const [fx, fy] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]] as const) {
        if (!w.inBounds(sx + fx, sy + fy)) return -1;
        const t = w.tile(sx + fx, sy + fy);
        if (t.feature || w.siteAt(sx + fx, sy + fy)) return -1;
        const b = BIOMES[t.biome];
        if (!b.passable) return -1;
        s += b.forageChance * (1 + b.forage.reduce((a, [, wt]) => a + wt, 0) / 8);
      }
      return s;
    };
    const pool = ring
      .filter(([ax, ay]) => (ax !== cx || ay !== cy) && foodScore(ax, ay) >= 0)
      .sort((a, b) => foodScore(b[0], b[1]) - foodScore(a[0], a[1]))
      .slice(0, 5);
    ok(pool.length >= 5, "found distant test chunks for controlled ecology");
    const craftRegion = (ax: number, ay: number, pops: { speciesId: string; count: number; juveniles?: number; satiety?: number; level?: number; seed?: number }[]): DistantRegion => {
      const r2: DistantRegion = {
        key: distantKey(0, ax, ay), layer: 0, cx: ax, cy: ay, lastTick: g.tick, abstracted: true,
        pops: pops.map((p) => ({ speciesId: p.speciesId, count: p.count, juveniles: p.juveniles ?? 0, genes: flatGenes(55), satiety: p.satiety ?? 80, level: p.level ?? 6, lineageId: null, seed: p.seed ?? (hashString(p.speciesId) ^ 0xabcd) })),
      };
      g.distant = g.distant ?? {};
      g.distant[r2.key] = r2;
      return r2;
    };
    if (pool.length >= 5) {
      // growth under favorable conditions: a small population below carrying capacity
      const grow = craftRegion(pool[0][0], pool[0][1], [{ speciesId: "slimekin", count: 2 }]);
      stepRegion(g, w, grow, 30);
      ok(grow.pops[0] && grow.pops[0].count > 2, `populations grow under favorable ecological conditions (${grow.pops[0]?.count} after 30 days)`);
      // decline under scarcity and crowding
      const shrink = craftRegion(pool[1][0], pool[1][1], [{ speciesId: "slimekin", count: 20, juveniles: 4 }]);
      stepRegion(g, w, shrink, 6);
      ok(shrink.pops[0] && shrink.pops[0].count < 20 && shrink.pops[0].count >= 0, `overcrowded populations decline toward carrying capacity (${shrink.pops[0]?.count})`);
      // predation couples predator and prey
      const hunt = craftRegion(pool[2][0], pool[2][1], [
        { speciesId: "slimekin", count: 20 },
        { speciesId: "cindermaw", count: 4 },
      ]);
      stepRegion(g, w, hunt, 5);
      const prey = hunt.pops.find((p) => p.speciesId === "slimekin");
      const pred = hunt.pops.find((p) => p.speciesId === "cindermaw");
      ok(prey && prey.count < 20, `predation reduces prey populations (${prey?.count} prey left)`);
      ok(pred && pred.count >= 4, "predator populations persist off prey availability");
      ok(
        [grow, shrink, hunt].every((r2) => r2.pops.every((p) => Number.isFinite(p.count) && p.count >= 0 && p.juveniles >= 0 && p.juveniles <= p.count && Number.isFinite(p.satiety))),
        "population counts never become negative or non-finite",
      );
      // migration transfers members without duplication or loss
      const mig = craftRegion(pool[3][0], pool[3][1], [{ speciesId: "slimekin", count: 30, juveniles: 6, seed: 0x51ce }]);
      const slimeTotal = (): number => Object.values(g.distant ?? {}).reduce((a, r2) => a + (r2.pops.find((p) => p.speciesId === "slimekin")?.count ?? 0), 0);
      const beforeKeys = new Set(Object.keys(g.distant ?? {}));
      const totalBefore = slimeTotal();
      stepRegion(g, w, mig, 1);
      const arrivals = Object.values(g.distant ?? {}).filter((r2) => !beforeKeys.has(r2.key) && r2.pops.some((p) => p.speciesId === "slimekin"));
      ok(arrivals.length >= 1, "dispersing members arrive in a neighboring region");
      const totalAfter = slimeTotal();
      ok(totalAfter <= totalBefore && totalAfter >= totalBefore - 8, `migration transfers population without duplication (${totalAfter}/${totalBefore} after mortality)`);
      // bounded catch-up, applied exactly once
      const far = craftRegion(pool[4][0], pool[4][1], [{ speciesId: "slimekin", count: 10, juveniles: 2 }]);
      far.lastTick = g.tick - 100 * DISTANT_INTERVAL;
      advanceDistantEcosystem(g, w);
      ok(far.lastTick === g.tick, "long absences fold into bounded catch-up (never unbounded)");
      const snap1 = JSON.stringify(far.pops.map((p) => [p.speciesId, p.count]));
      advanceDistantEcosystem(g, w);
      ok(snap1 === JSON.stringify(far.pops.map((p) => [p.speciesId, p.count])), "repeated updates never apply the same elapsed period twice");
    }

    // ---- absence changes the world, then the region materializes on return ----
    advance(g, 2 * DISTANT_INTERVAL + 20);
    const broodDev = g.developments["d:far"];
    ok(!!broodDev && broodDev.state === "completed" && !!broodDev.resultId && !!g.creatures[broodDev.resultId!], "developing offspring complete while their region is abstracted");
    const popSnap = reg?.pops.map((p) => ({ speciesId: p.speciesId, count: p.count, juveniles: p.juveniles, genes: { ...p.genes }, lineageId: p.lineageId }));
    g.player.x = bx;
    g.player.y = by;
    loadChunks(g);
    const bodies = Object.values(g.creatures).filter((c) => c.id.startsWith(`w:${cx}:${cy}:`));
    ok(bodies.length >= 1 && bodies.length <= MAT_CAP_REGION, `returning materializes a bounded slice of the population (${bodies.length} bodies)`);
    ok(bodies.every((c) => Math.floor(c.x / CHUNK) === cx && Math.floor(c.y / CHUNK) === cy), "materialized bodies occupy valid tiles inside their region");
    const popSlime = popSnap?.find((p) => p.speciesId === "slimekin");
    const matSlime = bodies.filter((c) => c.speciesId === "slimekin");
    ok(!!popSlime && matSlime.length >= 1 && matSlime.every((c) => GENE_KEYS.every((k) => Math.abs(expressGene(c.genes[k]) - popSlime.genes[k]) <= 8)), "materialized genetics descend from the population's accumulated gene pool");
    if (popSlime?.lineageId) ok(matSlime.every((c) => c.lineageId === popSlime.lineageId), "population-level ancestry carries into materialized bodies");
    if ((popSlime?.juveniles ?? 0) >= 2 && matSlime.length > 0) ok(matSlime.some((c) => c.bornTick !== undefined), "juveniles materialize with their growth state intact");
    ok(!Object.keys(g.creatures).some((id) => id.startsWith(`c:${cx}:${cy}:`)), "chunks under population management skip generic respawns (no duplication)");
    const stillAbstract = g.distant?.[key]?.pops.find((p) => p.speciesId === "slimekin");
    if (popSlime) ok(matSlime.length + (stillAbstract?.count ?? 0) === popSlime.count, `population accounting reconciles across materialization (${matSlime.length}+${stillAbstract?.count ?? 0}=${popSlime.count})`);
    ok(!!g.creatures["de1"], "unique individuals were never merged into anonymous populations");

    // ---- persistence: abstract populations survive save/load ----
    const saved = JSON.parse(JSON.stringify(g)) as GameState;
    const popSig = (s: GameState): string => JSON.stringify(Object.keys(s.distant ?? {}).sort().flatMap((k) => (s.distant ?? {})[k].pops.map((p) => [k, p.speciesId, p.count, p.juveniles, p.lineageId])));
    const before = popSig(saved);
    migrateDistant(saved);
    migrateDistant(saved);
    ok(popSig(saved) === before, "abstract populations survive save/load migration unchanged (idempotent)");
    const legacy = JSON.parse(JSON.stringify(saved)) as GameState;
    delete legacy.distant;
    migrateDistant(legacy);
    ok(!!legacy.distant && Object.keys(legacy.distant).length === 0, "older saves gain distant-state defaults through migration");
  }
}

/* ---------------- Phase 12: food web — plants, carrion, wild fights ---------------- */
{
  const fg = newGame("MAPCHECK-1", "Rook", "ranger", "#e8742a", previewStarter("MAPCHECK-1", "mossback"));
  const fw = getWorld(fg.seed);
  const openSpot = (x0: number, y0: number): { x: number; y: number } | null => {
    for (let r = 0; r < 30; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx;
          const y = y0 + dy;
          if (!fw.inBounds(x, y) || !fw.passable(x, y) || fw.tile(x, y).feature || fw.siteAt(x, y)) continue;
          if (creatureAt(fg, x, y) || (x === fg.player.x && y === fg.player.y)) continue;
          return { x, y };
        }
      }
    }
    return null;
  };
  const home0 = openSpot(fg.player.x, fg.player.y);
  ok(home0 !== null, "open wild ground exists for the food-web checks");
  if (home0) {
    fg.player.x = home0.x;
    fg.player.y = home0.y;
    fg.field = {};
    initField(fg);
    loadChunks(fg);
    // controlled cast: only the bodies crafted below act
    for (const id of Object.keys(fg.creatures)) delete fg.creatures[id];

    const mkBody = (id: string, speciesId: string, pos: { x: number; y: number }, satiety: number): WildCreature => {
      const c: WildCreature = {
        id, speciesId, level: 5, x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y,
        hpFrac: 1, satiety, disposition: "calm", activity: "Wandering", personality: "gentle",
        geneSeed: 7000 + hashString(id), genes: wildGenotypeFromSeed(7000 + hashString(id), speciesId), gen: 1, lineageId: `L:${id}`,
        repro: makeReproProfile(wildReproMode(id, speciesId), 5, 0),
        calmUntil: 0, alpha: false, affection: 0, stalking: false,
      };
      fg.creatures[id] = c;
      return c;
    };
    const findPlant = (): { x: number; y: number; item: ItemId } | null => {
      let best: { x: number; y: number; item: ItemId } | null = null;
      let bd = 99;
      for (let dy = -14; dy <= 14; dy++) {
        for (let dx = -14; dx <= 14; dx++) {
          const x = home0.x + dx;
          const y = home0.y + dy;
          if (!fw.inBounds(x, y) || !fw.passable(x, y) || fw.tile(x, y).feature || fw.siteAt(x, y)?.wall) continue;
          if (creatureAt(fg, x, y) || (x === fg.player.x && y === fg.player.y)) continue;
          const it = fw.forage(x, y, fg.tick, fg.depleted);
          if (!it || !ITEMS[it].diets.includes("herbivore")) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d < bd) {
            bd = d;
            best = { x, y, item: it };
          }
        }
      }
      return best;
    };

    // ---- plants are physical objects: stable, deplete, regrow ----
    const plant = findPlant();
    ok(plant !== null, "forage plants grow within reach of the party");
    if (plant) {
      ok(fw.forage(plant.x, plant.y, fg.tick, fg.depleted) === plant.item, "a plant stands where it grew (stable placement, not a per-look dice roll)");
      const dep = { ...fg.depleted, [`${plant.x},${plant.y}`]: fg.tick };
      ok(fw.forage(plant.x, plant.y, fg.tick, dep) === null, "a grazed plant is gone while depleted");
      ok(fw.forage(plant.x, plant.y, fg.tick + 2 * DAY_TICKS + 1, dep) === plant.item, "plants regrow on the same spot after two days");
      const e1 = mkBody("fd1", "mossback", plant, 30);
      const s0 = e1.satiety;
      advance(fg, 1);
      ok(e1.satiety > s0 && fg.depleted[`${plant.x},${plant.y}`] !== undefined, "a hungry herbivore eats the plant it stands on and depletes it");
      const plant2 = findPlant();
      ok(plant2 !== null, "another plant grows within reach");
      if (plant2) {
        let ps: { x: number; y: number } | null = null;
        // rings 3–5 stay inside the creature's scan radius (6), and the spot must be food-free
        for (let r = 3; r <= 5 && !ps; r++) {
          for (let dy = -r; dy <= r && !ps; dy++) {
            for (let dx = -r; dx <= r && !ps; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = plant2.x + dx;
              const y = plant2.y + dy;
              if (!fw.inBounds(x, y) || !fw.passable(x, y) || fw.tile(x, y).feature || fw.siteAt(x, y)?.wall) continue;
              if (creatureAt(fg, x, y) || cheb(x, y, fg.player.x, fg.player.y) > 26) continue;
              if (fw.forage(x, y, fg.tick, fg.depleted)) continue;
              ps = { x, y };
            }
          }
        }
        if (ps) {
          // the world is food-dense: clear every other plant around the start so
          // the walk-to-food rule is the only way to eat
          for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
              const x = ps.x + dx;
              const y = ps.y + dy;
              if (x === plant2.x && y === plant2.y) continue;
              if (fw.forage(x, y, fg.tick, fg.depleted)) fg.depleted[`${x},${y}`] = fg.tick;
            }
          }
          // pick an id whose staggered scan phase fires on the first tick, so
          // the walk starts before wander noise can carry the body off course
          let sid = "fd2";
          for (let k = 0; k < 40; k++) {
            if ((fg.tick + 1 + hashString(`fd2-${k}`)) % 6 === 0) {
              sid = `fd2-${k}`;
              break;
            }
          }
          mkBody(sid, "mossback", ps, 30);
          advance(fg, 14);
          const at = fg.creatures[sid];
          ok(fg.depleted[`${plant2.x},${plant2.y}`] !== undefined || (at !== undefined && cheb(at.x, at.y, plant2.x, plant2.y) <= 2), "a hungry herbivore walks to a plant it can smell");
        } else ok(false, "a standing spot exists for the foraging-walk check");
      }
    }

    // ---- a wild kill leaves carrion; a scavenger feeds; carrion rots ----
    for (const id of Object.keys(fg.creatures)) if (id !== "fd1" && id !== "fd2") delete fg.creatures[id];
    const preySpot = openSpot(home0.x, home0.y);
    ok(preySpot !== null, "a free tile exists for the hunt");
    if (preySpot) {
      // the predator is crafted FIRST: bodies act in creation order, so it
      // strikes before the prey can flee — one lunge (min 0.3) beats hp 0.2
      const pred = mkBody("pd1", "cindermaw", preySpot, 10);
      const preySpot2 = openSpot(preySpot.x, preySpot.y) ?? { x: preySpot.x + 1, y: preySpot.y };
      const prey = mkBody("pr1", "slimekin", preySpot2, 80);
      prey.hpFrac = 0.2;
      const predAt = { x: pred.x, y: pred.y };
      if (cheb(predAt.x, predAt.y, prey.x, prey.y) > 1) {
        pred.x = prey.x + 1;
        pred.y = prey.y;
      }
      let caught = false;
      for (let i = 0; i < 12 && !caught; i++) {
        advance(fg, 1);
        caught = fg.creatures["pr1"] === undefined;
      }
      ok(caught, "a hungry predator hunts down and catches prey");
      ok((fg.creatures["pd1"]?.hpFrac ?? 0) > 0, "cornered prey fights back, but the hunter survives the scrap");
      const ca = Object.values(fg.carrion ?? {}).find((m) => m.speciesId === "slimekin");
      ok(!!ca && ca.portions >= 1, "the fallen body leaves carrion where it died");
      if (ca) {
        const sc = mkBody("sc1", "cindermaw", openSpot(ca.x, ca.y) ?? { x: ca.x, y: ca.y + 1 }, 10);
        const portions0 = ca.portions;
        advance(fg, 1);
        ok(sc.satiety > 10 && ((fg.carrion ?? {})[ca.id] === undefined || (fg.carrion ?? {})[ca.id].portions < portions0), "a scavenger feeds on the remains");
        for (const it of Object.values(fg.carrion ?? {})) it.born = fg.tick - CARRION_DAYS * DAY_TICKS - 1;
        advance(fg, 1);
        ok(Object.keys(fg.carrion ?? {}).length === 0, "carrion rots away after its lifespan");
      }
    }
    // ---- technical cap and save migration ----
    const junk = openSpot(home0.x, home0.y) ?? { x: home0.x, y: home0.y };
    for (let i = 0; i < CARRION_CAP + 10; i++) {
      spawnCarrion(fg, mkBody(`junk${i}`, "slimekin", junk, 50));
      delete fg.creatures[`junk${i}`];
    }
    ok(Object.keys(fg.carrion ?? {}).length <= CARRION_CAP, `carrion is bounded (${CARRION_CAP} tracked, oldest rot first)`);
    const legacy = JSON.parse(JSON.stringify(fg)) as GameState;
    delete legacy.carrion;
    legacy.carrionSeq = undefined;
    migrateCarrion(legacy);
    migrateCarrion(legacy);
    ok(!!legacy.carrion && legacy.carrionSeq === 0 && Object.keys(legacy.carrion).length === 0, "older saves gain carrion defaults through migration (idempotent)");
  }

  // ---- the hamlet folk ----
  const ham = getWorld(gs.seed).featuresNear(gs.player.homeX, gs.player.homeY, 8).find((f) => f.kind === "hamlet");
  ok(!!ham, "the home hamlet stands where the walk began");
  if (ham) {
    const hw = getWorld(gs.seed);
    const folk = hw.hamletNpcs(ham);
    ok(folk.length === 3, "every hamlet fields its three folk");
    ok(JSON.stringify(folk.map((n) => n.role).sort()) === JSON.stringify(["innkeep", "penkeeper", "trader"]), "the folk cover inn, pen and trade");
    ok(JSON.stringify(folk) === JSON.stringify(hw.hamletNpcs(ham)), "hamlet folk are deterministic (same seed, same people, same posts)");
    ok(folk.every((n) => !hw.siteAt(n.x, n.y)?.wall), "the folk stand on walkable ground by their doors");
    ok(folk.every((n) => hw.npcAt(n.x, n.y)?.name === n.name), "npcAt resolves each folk member at their post");
  }
}

if (fails) {
  console.log(`\n${fails} FAILURES`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
