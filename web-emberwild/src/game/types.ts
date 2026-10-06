export type Element = "neutral" | "fire" | "water" | "earth" | "air" | "nature" | "frost" | "shadow";
export type StatKey = "hp" | "atk" | "def" | "agi" | "wis";
export type Stats = Record<StatKey, number>;
/** The six heritable genes. `size` drives the monster's tile footprint. */
export type GeneKey = "vigor" | "might" | "guard" | "swift" | "wit" | "size";
/** Expressed gene values (derived from genomes; used by UI and legacy saves). */
export type Genes = Record<GeneKey, number>;
/** Two alleles per gene — the genetic source of truth. */
export interface GenePair {
  a: number;
  b: number;
}
export type Genome = Record<GeneKey, GenePair>;

/** One expressed-gene change caused by genetic drift, as structured data. */
export interface MutationRecord {
  gene: GeneKey;
  from: number;
  to: number;
  delta: number;
  dir: "up" | "down";
  /** Generation at which the mutation occurred. */
  gen: number;
}

export type BiomeId =
  | "deep" | "sea" | "lake" | "river" | "beach" | "meadow" | "forest" | "taiga" | "gloomwood"
  | "marsh" | "steppe" | "desert" | "tundra" | "snow" | "hills" | "mountain" | "peak";

export type FeatureId = "hamlet" | "ruin" | "shrine" | "lair";

export type ItemId =
  | "berries" | "nuts" | "roasted_nuts" | "fish" | "meat" | "herb" | "mushroom"
  | "cactus_fruit" | "honeycomb" | "ore" | "tonic";

export type PersonalityId = "brave" | "timid" | "curious" | "lazy" | "gluttonous" | "loyal" | "fierce" | "gentle";
export type MutationId =
  | "thick_hide" | "twin_hearted" | "luminous" | "quickened" | "iron_jaw"
  | "old_soul" | "frail" | "hollow_eyed" | "ember_veins" | "star_marked";
export type TraitId =
  | "warm_blooded" | "slick" | "thorny" | "mossy_shell" | "night_eyes" | "flutter"
  | "stoneskin" | "frost_coat" | "regal" | "photosynth" | "sunborn";
export type StatusId = "burning" | "soaked" | "poisoned" | "slowed" | "rooted" | "stunned" | "blinded" | "shelled" | "wary" | "veiled";
export type Terrain =
  | "grass" | "tallgrass" | "flowers" | "water" | "mud" | "rock" | "tree" | "sand" | "snow" | "ash" | "gloom"
  | "wall" | "woodwall" | "floor" | "door" | "rubble";
export type WeatherId = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "sandstorm";
export type Disposition = "curious" | "skittish" | "aggressive" | "calm";
export type OriginId = "wanderer" | "herbalist" | "ranger" | "scholar";
export type FearKind = "water" | "fire" | "heat" | "cold" | "dark" | "light";
export type Diet = "herbivore" | "carnivore" | "omnivore" | "lithovore";
export type Activity = "diurnal" | "nocturnal" | "crepuscular";
export type Family = "Beast" | "Slime" | "Bird" | "Bug" | "Spirit" | "Dragon" | "Brute";
export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export type Sex = "male" | "female" | "asexual";

/** Reproductive anatomy: the three biological configurations. */
export type ReproMode = Sex;
/** Life-stage maturity: immature individuals cannot reproduce yet. */
export type Maturity = "immature" | "mature";
/** Where an individual sits in the reproduction cycle. */
export type ReproStatus = "available" | "reproducing" | "cooldown" | "infertile" | "immature";
/** How a compatible pair reproduces: sexed anatomy, or two asexual parents. */
export type ReproPairing = "sexual" | "asexual";
/** Rule environment of a mating attempt: wild pairs obey species boundaries, player pairs are unrestricted. */
export type MatingContext = "wild" | "player";
/** How a species develops after conception: an egg laid in a nest, or live gestation. */
export type DevelopmentType = "egg" | "gestation";
/** Lifecycle of one reproductive development. */
export type DevelopmentState = "developing" | "ready" | "completed" | "interrupted" | "failed";
/** Lifecycle of a nest. */
export type NestState = "active" | "abandoned" | "destroyed";

/**
 * Biological reproduction data for one individual. Mode derives from sex;
 * fertility, maturity, cooldown and status are independent biological state
 * that future systems (growth, health, environment, gestation) can modify.
 */
export interface ReproductiveProfile {
  mode: ReproMode;
  /** 0–100; above 0 the individual is currently fertile. */
  fertility: number;
  maturity: Maturity;
  status: ReproStatus;
  /** Sim tick when the breeding cooldown ends (≤ tick means no cooldown). */
  cooldownUntil: number;
  /** Pairing of the current or most recent reproduction. */
  pairing?: ReproPairing;
  /** Partner body id while a reproduction is underway. */
  engagedWith?: string;
  /** Sim tick when the current reproduction completes development. */
  developUntil?: number;
  /** The female's remembered nest (egg-layers reuse it for every clutch). */
  nestId?: string;
}

export interface Monster {
  uid: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  xp: number;
  hp: number;
  genes: Genome;
  mutations: MutationId[];
  personality: PersonalityId;
  sex: Sex;
  skills: string[];
  satiety: number;
  bond: number;
  plus: number;
  origin: string;
  bornTick: number;
  parents: string[] | null;
  /** Display names captured at synthesis time (parents are consumed on synthesis). */
  parentNames?: string[];
  /** Biological ancestry: founders are generation 1, offspring max(parents) + 1. */
  generation?: number;
  /** Stable ancestry id, independent of display names; founders own `L:<uid>`. */
  lineageId?: string;
  /** Structured drift history: which expressed genes changed, when, and by how much. */
  mutHistory?: MutationRecord[];
  /** Biological reproduction state (backfilled from sex on load for legacy saves). */
  repro?: ReproductiveProfile;
  wins: number;
  /** Placement cap on the growth footprint: the largest class that currently fits (growth.ts). */
  fpCap?: number;
}

export interface WildCreature {
  id: string;
  speciesId: string;
  level: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hpFrac: number;
  satiety: number;
  disposition: Disposition;
  activity: string;
  personality: PersonalityId;
  geneSeed: number;
  /** Explicit genotype — the authoritative genetics (geneSeed only seeds legacy migration). */
  genes?: Genome;
  /** Founder generation (wild creatures are founders unless later systems say otherwise). */
  gen?: number;
  /** Stable lineage id carried into monsters on taming. */
  lineageId?: string;
  /** Biological reproduction state (backfilled from the creature's id on load for legacy saves). */
  repro?: ReproductiveProfile;
  calmUntil: number;
  alpha: boolean;
  affection: number;
  stalking: boolean;
  /** Id of the lair alpha this minion is loyal to (absent for solo creatures). */
  pack?: string;
  /** Direct parent body ids (wild hatchlings; absent for spawned founders and legacy saves). */
  parents?: string[];
  /** Structured mutation history (wild hatchlings; monsters carry it always). */
  mutHistory?: MutationRecord[];
  /** Tick until which migration decisions are suppressed (anti-oscillation; Phase 9). */
  migrateUntil?: number;
  /** Birth tick (hatchlings only; absent = mature adult, the spawned/legacy default). */
  bornTick?: number;
  /** Placement cap on the growth footprint: the largest class that currently fits (growth.ts). */
  fpCap?: number;
  /** The ecological territory this creature recognizes as home (backfilled by migrateTerritories). */
  territoryId?: string;
  /** Vertical layer: absent = surface, -1 upper caves, -2 deep caves. */
  layer?: number;
}

export type LogKind = "info" | "event" | "combat" | "system" | "good" | "bad" | "weather";

export interface LogEntry {
  id: number;
  tick: number;
  text: string;
  kind: LogKind;
}

export interface Player {
  name: string;
  origin: OriginId;
  scarf: string;
  x: number;
  y: number;
  gold: number;
  homeX: number;
  homeY: number;
  homeName: string;
  fx: number;
  fy: number;
  /** Vertical layer: absent = surface, -1 upper caves, -2 deep caves. The party always shares it. */
  layer?: number;
}

export interface GameStats {
  steps: number;
  battles: number;
  tamed: number;
  synthesized: number;
  foraged: number;
}

/** A landmark the player has explicitly found and can place on their maps. */
export interface Discovery {
  kind: FeatureId;
  name: string;
  x: number;
  y: number;
  tick: number;
}

/**
 * The player's knowledge of the world — deliberately separate from the world
 * itself. The procedural world is authoritative; this is only what the player
 * has seen, visited or been told about, and it persists across save/load.
 */
export interface WorldKnowledge {
  /** Explored 8×8-tile cells, key = (cellY << 9) | cellX. */
  explored: Record<number, 1>;
  /** Discovered landmarks, key = `f:x:y`. */
  discovered: Record<string, Discovery>;
  /** 160-tile region cells whose name the player has learned, key = `rx,ry`. */
  regionsSeen: Record<string, 1>;
  /** Nation ids whose banner the player has stood under, key = nation id. */
  nationsSeen: Record<string, 1>;
  /** Association ids the player has learned from notices, key = association id. */
  assocSeen: Record<string, 1>;
  /** Explored cave cells, key = `${layer}:${eCellKey}` (underground knowledge never leaks onto the surface map). */
  caves?: Record<string, 1>;
  /** The player's own traveled trail (breadcrumbs, capped). */
  route: [number, number][];
}

export interface BStatus {
  id: StatusId;
  turns: number;
}

/** Where a party monster stands on the live map and what it should do there. */
export type FieldOrder = "follow" | "attack" | "hold";

/** How readily a party monster fights on its own initiative. */
export type Aggression = "passive" | "neutral" | "aggressive";

/** A queued skill command: the monster paths into range, then unleashes it. */
export interface SkillOrder {
  skill: string;
  /** Wild creature id, or a party uid for ally/self skills. */
  target: string;
}

/** Per-combatant combat state (statuses and skill cooldowns) on the live map. */
export interface FighterState {
  statuses: BStatus[];
  cooldowns: Record<string, number>;
}

/** Sparse terrain/fire overlay on a world tile, key = "x,y". */
export interface GroundTile {
  fire?: number;
  t?: Terrain;
}

/** The inherited outcome of a breeding, assembled at conception and materialized when development completes. */
export interface ChildBlueprint {
  speciesId: string;
  sex: Sex;
  /** 1 for player-bred offspring; wild births derive from the parents' levels. */
  level: number;
  genes: Genome;
  mutations: MutationId[];
  personality: PersonalityId;
  skills: string[];
  plus: number;
  bond: number;
  generation: number;
  lineageId: string;
  mutHistory: MutationRecord[];
  parents: [string, string];
  parentNames: [string, string];
}

/** Persistent reproductive development — an egg in a nest, or a gestation. The offspring entity is created only at completion. */
export interface ReproductiveDevelopment {
  id: string;
  parentIds: [string, string];
  speciesId: string;
  pairing: ReproPairing;
  type: DevelopmentType;
  state: DevelopmentState;
  startTick: number;
  completeTick: number;
  /** The nest holding this egg, if any. */
  nestId?: string;
  /** "wild" offspring hatch into the world; "player" offspring join party/pen. */
  origin: MatingContext;
  /** The assembled genetic outcome, fixed at conception. */
  child?: ChildBlueprint;
  /** Id of the offspring once created (monster uid or wild creature id). */
  resultId?: string;
}

/** A persistent nest built by a female. Independent world state that Phase 6 territories and Phase 9 ecology can attach to. */
export interface Nest {
  id: string;
  speciesId: string;
  /** The owning female's body id. */
  ownerId: string;
  x: number;
  y: number;
  state: NestState;
  createdAt: number;
  lastUsedTick: number;
  /** Development records currently or previously held here. */
  developmentIds: string[];
  /** Phase 6 hook: the territory this nest falls within. */
  territoryId?: string;
  /** Vertical layer the nest was built on (absent = surface). */
  layer?: number;
}

/** Rolling reproductive vitals for one species (Phase 7 observability). */
export interface SpeciesVitals {
  births: number;
  deaths: number;
  juvenileDeaths: number;
}

/** Aggregate population of one species in one region cell — the distant-world (Phase 11) seed. */
export interface RegionPopulation {
  speciesId: string;
  /** Total known population (adults + juveniles). */
  pop: number;
  juveniles: number;
  births: number;
  deaths: number;
  tick: number;
}

/**
 * Persistent ecology state (Phase 7). Individual populations near the player
 * live in `creatures` and are censused on demand; this records event-driven
 * vitals and aggregate per-region populations that later phases (distant-world
 * simulation) can extend without individual entities.
 */
export interface EcologyState {
  /** Reproductive births and deaths per species, since the last daily reset. */
  vitals: Record<string, SpeciesVitals>;
  /** Aggregate populations per region cell, key = `r:<rx>,<ry>`. */
  regions: Record<string, RegionPopulation[]>;
  /** Last tick the ecological interval ran. */
  lastTick: number;
}

/**
 * A persistent lineage record (Phase 10): bounded ancestry bookkeeping keyed by
 * lineage id. Lineage identity describes ancestry and is deliberately separate
 * from species identity; records outlive the bodies that carried them.
 */
export interface LineageRecord {
  id: string;
  /** The founding member's species (informational only — lineages are not species). */
  speciesId: string;
  foundedTick: number;
  /** Highest generation registered in this lineage. */
  depth: number;
  /** Living members (event-fed, recomputed on load; approximate between loads). */
  living: number;
  /** Total members ever registered (monotonic). */
  historical: number;
  /** Best expressed gene values observed in the lineage (per gene). */
  peakGenes: Genes;
  /** A capped sample of notable mutations from the lineage's history. */
  notable: MutationRecord[];
  /** A capped sample of member ids (living members after each load). */
  members: string[];
}

/**
 * A persistent ecological home range. Territories are world state with stable
 * identity: they outlive the creatures that currently occupy them, so a
 * population can unload and reload without its home range vanishing.
 * Ownership migrates from the legacy alpha behavior — the dominant individual
 * is the territory holder; other members recognize the territory as home.
 */
export interface Territory {
  id: string;
  /** Species the territory was founded by (mixed populations arrive in a later phase). */
  speciesId: string;
  /** Center tile — the lair, den or founding spot. */
  x: number;
  y: number;
  /** Home-range radius in tiles (chebyshev), matching the map's tile architecture. */
  radius: number;
  /** 0–100 environmental quality derived from existing biome/forage data. */
  quality: number;
  /** The dominant individual's body id (the migrated alpha role), when held. */
  ownerId?: string;
  /** Nests located within this territory (ids — nests and territories stay decoupled). */
  nestIds: string[];
  /** True while ownership has lapsed with rivals about (foundation for later contest behavior). */
  contested?: boolean;
  createdAt: number;
  /** Vertical layer of the range (absent = surface; cave populations hold cave territories). */
  layer?: number;
}

export interface GameState {
  version: number;
  seedText: string;
  seed: number;
  tick: number;
  player: Player;
  party: Monster[];
  pen: Monster[];
  bag: Partial<Record<ItemId, number>>;
  creatures: Record<string, WildCreature>;
  loadedChunks: string[];
  removed: Record<string, number>;
  depleted: Record<string, number>;
  log: LogEntry[];
  logSeq: number;
  seen: Record<string, boolean>;
  tamed: Record<string, boolean>;
  regions: Record<string, string>;
  lastWeather: WeatherId;
  lastRegion: string;
  /** Nation id the player currently stands in ("" = unclaimed wilds). */
  lastNation: string;
  stats: GameStats;
  /** Party monster positions on the live map, key = monster uid. */
  field: Record<string, { x: number; y: number }>;
  /** Party standing orders, key = monster uid. */
  orders: Record<string, FieldOrder>;
  /** Per-monster aggression, key = monster uid; a missing key means "neutral". */
  aggr: Record<string, Aggression>;
  /** Queued skill commands, key = monster uid; resolved on the monster's next turn. */
  skillQ: Record<string, SkillOrder>;
  /** The creature the party is currently targeting (wild creature id). */
  target: string | null;
  /** Sparse fire/terrain overlays on the live map, key = "x,y". */
  ground: Record<string, GroundTile>;
  /** Combat state per combatant: party uids and wild creature ids. */
  fighters: Record<string, FighterState>;
  uidSeq: number;
  /** Persistent nests built by females, key = nest id. */
  nests: Record<string, Nest>;
  /** Reproductive developments (eggs, gestations), key = development id. */
  developments: Record<string, ReproductiveDevelopment>;
  /** Id counter for nests and development records. */
  broodSeq: number;
  /** Persistent ecological territories, key = territory id. */
  territories: Record<string, Territory>;
  /** Id counter for territories. */
  territorySeq: number;
  /** Population ecology state (Phase 7; backfilled by migrateEcology on load). */
  ecology?: EcologyState;
  /** Persistent lineage records, key = lineage id (Phase 10; backfilled by migrateLineages). */
  lineages?: Record<string, LineageRecord>;
  /** Bounded parent → child ids index for lineage queries (Phase 10). */
  childIndex?: Record<string, string[]>;
  knowledge: WorldKnowledge;
}
