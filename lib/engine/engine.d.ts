// Types for the rules engine (engine.js). The engine is plain JavaScript and owns every rule;
// these declarations describe the shapes the UI reads.

export type Team = "town" | "mafia" | "cult" | "vampire" | "solo" | "neutral";
export type Phase = "setup" | "reveal-done" | "night" | "dawn" | "day" | "ended";

export interface Ability {
  id: string;
  kind: string;
  uses?: number | "guessShots";
  executes?: number;
  nights?: "all" | "first" | "notFirst" | "even";
  viaFaction?: boolean;
  vig?: boolean;
  attack?: number;
}

export interface Role {
  id: string;
  name: string;
  team: Team;
  icon: string;
  tags: string[];
  short: string;
  desc: string;
  winText: string;
  def: number;
  rbImmune: boolean;
  ctrlImmune: boolean;
  trImmune: boolean;
  sus: boolean;
  clue: string;
  gun: boolean;
  w: number;
  diff: number;
  wake: number;
  abilities: Ability[];
  unique: boolean;
  custom?: boolean;
  appearsTown?: boolean;
  hiddenMember?: boolean;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  roleId: string | null;
  team: Team | null;
  alive: boolean;
  lock: boolean;
  fx: Record<string, any>;
  uses: Record<string, number>;
  meta: Record<string, any>;
}

export interface GameEvent { t: number; ph: string; type: string; text: string; secret?: boolean; to?: string }
export interface Death { id: string; ph: string; cause: string; killers: string[]; role: string; team: Team; publicRole: string | null; cleaned?: boolean; triggers: string[]; execution?: boolean }
export interface Message { to: string; text: string; tag: string; about?: string; pointed?: string; roles?: { id: string; name: string }[]; subject?: string }
export interface Report {
  night: number; deaths: Death[]; saves: { target: string; by: string | null; how: string; attacker?: string; cause: string }[];
  messages: Message[]; lines: string[]; publicNotes: string[]; visits: { from: string; to: string; kind: string }[]; cancelled: { actor: string; kind: string; why: string }[]; why?: string[];
}
export interface Action { key: string; actor: string; ab: string; targets: string[]; opts: Record<string, any>; at?: number }
export interface WinCheck { status: "ongoing" | "over" | "showdown"; faction?: string; reason?: string; winners?: { id: string; why: string }[]; pending?: string[]; auto?: boolean }
export interface Pending { id: string; type: "hunter" | "haunt"; actor: string; choices?: string[] }
export interface DayState { nominees: string[]; votes: Record<string, string>; open: boolean; round: number; done: boolean; result: any; startedAt: number;
  reveal?: { key: string; round: number; ballots: { from: string; to: string; w?: number }[]; outcome: string }; lastWords?: { target: string; endsAt: number; total: number } }

export interface Game {
  v: 1;
  id: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  phase: Phase;
  night: number;
  day: number;
  players: Player[];
  customRoles: Record<string, Role>;
  setup: { style: string; pool: Record<string, number>; seed: number; autoRecommend?: boolean; poolTouched?: boolean; dealt?: boolean; revealed?: boolean; targetN?: number; disabled?: string[] };
  config: Record<string, any>;
  actions: Action[];
  dayState: DayState | null;
  pending: Pending[];
  scheduled: any[];
  deaths: Death[];
  events: GameEvent[];
  reports: Record<string, Report>;
  votes: any[];
  publicNotes: { ph: string; text: string }[];
  showdown: { faction: string; pending: string[]; endsAfterDay: number } | null;
  winPrompt: WinCheck | null;
  lastWin?: WinCheck | null;
  result: { faction: string; factionName: string; reason: string; winners: { id: string; why: string }[]; forced?: boolean } | null;
  executions: number;
  initialRoles: { id: string; roleId: string; team: Team; target?: string | null; fake?: string | null; drunk?: boolean }[];
  nightUi?: { night: number; visited: Record<string, string>; phone?: Record<string, { by: string; pass?: boolean; ab?: string; targets?: string[]; waiting?: boolean }> };
  lastAnnounce?: { n: number; format: string; custom?: string };
}

export interface NightStepAbility { id: string; kind: string; verb: string; target: string; ok: boolean; why?: string }
export interface NightStep {
  key: string; type: "faction" | "player" | "bluff"; wake: number; title: string; script: string;
  faction?: "mafia" | "vampire"; actors?: string[]; kind?: string;
  actor?: string; roleId?: string; drunk?: boolean; abilities?: NightStepAbility[];
}

export interface PlayerCard {
  name: string; color: string; roleId?: string; roleName: string; icon: string; team: Team; teamName: string; short: string; desc: string; winText: string;
  abilities: string[]; teammates: { name: string; role: string; alive: boolean }[]; target: string | null; lover: string | null;
}

export interface PlayedGame { id?: string; at?: number; n?: number; roles: Record<string, number>; liked?: number; saved?: boolean; result?: { faction: string; players?: [string, string, number, number][] } }
export interface GameStory { headline: string; reason: string; faction: string; winners: string[]; players: number; nights: number; chapters: { label: string; lines: string[] }[]; highlights: string[] }
export interface Twist { add: string; remove: string; addName: string; removeName: string; short: string; why: string; balance: { score: number; label: string; fair: boolean } }

declare const Engine: {
  KINDS: Record<string, { prio: number; visits: boolean; target: string; verb: string; info?: boolean; day?: boolean }>;
  CUSTOM_KINDS: string[];
  TEAM_INFO: Record<string, { name: string; side: "town" | "mafia" | "neutral" }>;
  CLUE_NAMES: Record<string, string>;
  LIB: Role[];
  LIBMAP: Record<string, Role>;
  DEFAULT_CONFIG: Record<string, any>;
  HYPNO_MSGS: string[];
  STYLES: Record<string, any>;
  STYLE_NAMES: Record<string, string>;
  COLORS: string[];
  clone<T>(o: T): T;
  uid(prefix?: string): string;
  shuffle<T>(a: T[]): T[];
  seeded(seed: number): () => number;
  setRng(fn: (() => number) | null): void;
  getRole(s: Game | null, id: string | null | undefined): Role;
  allRoles(s: Game | null): Role[];
  kindOf(ab: Ability): { target: string; verb: string; info?: boolean; day?: boolean };
  rolesInClue(s: Game, clue: string): string[];
  rolesInGame(s: Game): Set<string>;
  clueRoles(s: Game, shownId: string, key: string, hide?: string | null): { id: string; name: string }[];
  clueShown(s: Game, p: Player, ctx: { disguised: Set<string>; framed: Set<string> }, key: string): { id: string; hide: string | null };
  evilRole(r: Role): boolean;
  story(s: Game): GameStory | null;
  seatList(pool: Record<string, number>): string[];
  drunkCards(pool: Record<string, number>): number;
  setDrunk(s: Game, pid: string, on: boolean): Game;
  drunkCandidates(s: Game): Player[];
  drunkFails(s: Game, pid: string, night?: number): boolean;
  basicPool(n: number, s?: Game | null): Record<string, number>;
  suggestTwists(s: Game | null, pool: Record<string, number>, history: PlayedGame[], n: number): Twist[];
  newGame(): Game;
  addPlayer(s: Game, name: string): Player;
  getP(s: Game, id: string): Player | undefined;
  pname(s: Game, id: string): string;
  setRole(s: Game, p: Player, roleId: string, opt?: { keepTeam?: boolean; keepMeta?: boolean }): void;
  poolList(pool: Record<string, number>): string[];
  assignRoles(s: Game): void;
  finalizeAssignment(s: Game): void;
  balanceOf(s: Game | null, pool: Record<string, number>): { score: number; label: string; counts: { town: number; mafia: number; neutral: number }; n: number; fair: boolean };
  recommend(n: number, style?: string, seed?: number, s?: Game | null, history?: PlayedGame[] | null): { pool: Record<string, number>; balance: any; seats: any; note?: string; tuned?: string };
  groupTune(s: Game | null, pool: Record<string, number>, n: number, history: PlayedGame[]): { pool: Record<string, number>; note: string };
  forYou(s: Game | null, n: number, history: PlayedGame[], seed?: number): { pool: Record<string, number>; balance: any; liked: string[]; fresh: string | null; note: string };
  tasteOf(history: PlayedGame[]): { taste: Record<string, number>; likedGames: number; rated: number; games: number; saved: number };
  seats(n: number, style: string): { mafia: number; neutral: number; killers: number; town: number };
  nightSteps(s: Game): NightStep[];
  nightAbilities(s: Game, p: Player): Ability[];
  dayAbilities(s: Game, p: Player): Ability[];
  abilityStatus(s: Game, p: Player, ab: Ability): { ok: boolean; why?: string };
  legalTargets(s: Game, actorId: string, abId: string, slot?: number, firstTarget?: string | null): { id: string; ok: boolean; why: string }[];
  defaultCarrier(s: Game, faction: string): string | null;
  setAction(s: Game, a: Action): Game;
  clearAction(s: Game, key: string): Game;
  resolveNight(s: Game): Game;
  processDeaths(s: Game, list: any[], tag: string, rep?: any): any;
  manualKill(s: Game, id: string, cause?: string): any;
  manualRevive(s: Game, id: string): void;
  manualSetRole(s: Game, id: string, roleId: string, team?: string | null): void;
  startGame(s: Game): Game;
  startNight(s: Game): Game;
  startDay(s: Game): Game;
  endDay(s: Game): Game;
  isSilenced(s: Game, p: Player): boolean;
  isBlackmailed(s: Game, p: Player): boolean;
  promptChoices(s: Game, q: Pending): string[];
  resolvePrompt(s: Game, qid: string, target: string | null): Game;
  mayorReveal(s: Game, id: string): Game;
  guessStatus(s: Game, p: Player): { ok: boolean; why?: string };
  guess(s: Game, actorId: string, targetId: string, roleId: string): { correct?: boolean; error?: string };
  voteWeight(s: Game, p: Player): number;
  canVote(s: Game, p: Player): boolean;
  mayorMultiplier(s: Game): number;
  mayorRuleText(s: Game): string;
  mayorBonusLeft(s: Game, p: Player | undefined): boolean;
  mayorBonusSet(s: Game, id: string, used: boolean): Game;
  openVote(s: Game, nominees: string[]): Game;
  castVote(s: Game, voter: string, target: string | null): Game;
  tally(s: Game): { totals: Record<string, number>; result: any; totalW: number; cast: number; eligible: string[] };
  confirmVote(s: Game): Game;
  skipVote(s: Game): Game;
  cancelVote(s: Game): Game;
  quickExecute(s: Game, targetId: string): Game;
  evaluateWin(s: Game, opt?: { ignoreShowdown?: boolean }): WinCheck;
  computeWinners(s: Game, faction: string): { id: string; why: string }[];
  afterChange(s: Game): void;
  dismissWin(s: Game): Game;
  endGame(s: Game, w?: WinCheck | null): Game;
  factionKey(p: Player): string;
  factionName(s: Game, key: string | undefined): string;
  teamLabel(p: Player): string;
  playerCard(s: Game, pid: string): PlayerCard;
  dawnAnnouncement(s: Game, n: number): { deaths: { name: string; role: string | null; cleaned?: boolean; cause: string | null }[]; notes: string[] };
  stats(s: Game): { nights: number; deaths: number; mafiaKills: number; townKills: number; saves: number; investigations: number; executions: number; voteRounds: number; duration: number; mvp: { name: string } | null; mostTargeted: { name: string; n: number } | null; mostKills: { name: string; n: number } | null };
  makeCustomRole(d: Record<string, any>): Role;
  addCustomRole(s: Game, r: Role): void;
  historyText(s: Game): string;
  describeAbility(s: Game, p: { uses: Record<string, number> } | Player, ab: Ability): string;
  effRole(s: Game, p: Player): Role;
  phaseTag(s: Game): string;
  log(s: Game, type: string, text: string, extra?: Record<string, any>): void;
  isEvil(s: Game, p: Player): boolean;
  appearance(s: Game, p: Player, ctx: any): any;
  isHidden(s: Game, p: Player): boolean;
  setupWarnings(s: Game, pool?: Record<string, number>): string[];
  stalemate(s: Game): { quietNights: number } | null;
  ackStalemate(s: Game): Game;
  restartGame(s: Game, mode: "same" | "reshuffle" | "setup"): Game;
  describeAction(s: Game, a: Action): string;
  previewResult(s: Game, act: Action): { messages: string[]; about: string | null; pointed: string | null; roles: { id: string; name: string }[] | null; subject: string | null; blocked: string | null };
};
export default Engine;
