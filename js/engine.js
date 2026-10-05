/* Omertà rules engine — pure game logic, no DOM. Works in browser and Node. */
(function (root) {
'use strict';

/* ---------- utilities ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
let _rng = Math.random;
const setRng = fn => { _rng = fn || Math.random; };
const rnd = n => Math.floor(_rng() * n);
const pick = a => a[rnd(a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
let _uidc = 0;
const uid = (p = 'p') => p + Date.now().toString(36).slice(-4) + (++_uidc).toString(36) + Math.random().toString(36).slice(2, 5);
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* ---------- ability kinds: resolution stage + defaults ---------- */
// prio: 1 detain/self-buff, 2 transport, 3 control, 4 roleblock/duel, 5 support, 6 attack, 7 information, 8 transformation
const KINDS = {
  jail:       { prio: 1, visits: false, target: 'other', verb: 'Jail' },
  alert:      { prio: 1, visits: false, target: 'self',  verb: 'Go on alert' },
  vest:       { prio: 1, visits: false, target: 'self',  verb: 'Wear a vest' },
  transport:  { prio: 2, visits: true,  target: 'two',   verb: 'Transport' },
  control:    { prio: 3, visits: true,  target: 'two',   verb: 'Control' },
  roleblock:  { prio: 4, visits: true,  target: 'other', verb: 'Roleblock' },
  duel:       { prio: 4, visits: true,  target: 'other', verb: 'Duel' },
  poison:     { prio: 5, visits: true,  target: 'other', verb: 'Poison' },
  frame:      { prio: 5, visits: true,  target: 'other', verb: 'Frame' },
  disguise:   { prio: 5, visits: true,  target: 'any',   verb: 'Disguise' },
  clean:      { prio: 5, visits: true,  target: 'other', verb: 'Clean' },
  douse:      { prio: 5, visits: true,  target: 'other', verb: 'Douse' },
  blackmail:  { prio: 5, visits: true,  target: 'other', verb: 'Blackmail' },
  silence:    { prio: 5, visits: true,  target: 'other', verb: 'Silence' },
  hypnotize:  { prio: 5, visits: false, target: 'other', verb: 'Hypnotize' },
  ambush:     { prio: 5, visits: true,  target: 'other', verb: 'Ambush at' },
  lovers:     { prio: 5, visits: false, target: 'two',   verb: 'Bind lovers' },
  heal:       { prio: 5, visits: true,  target: 'any',   verb: 'Heal' },
  guard:      { prio: 5, visits: true,  target: 'other', verb: 'Guard' },
  shield:     { prio: 5, visits: false, target: 'assigned', verb: 'Shield' },
  kill:       { prio: 6, visits: true,  target: 'other', verb: 'Attack' },
  rampage:    { prio: 6, visits: true,  target: 'any',   verb: 'Rampage at' },
  ignite:     { prio: 6, visits: false, target: 'none',  verb: 'Ignite' },
  factionKill:{ prio: 6, visits: true,  target: 'other', verb: 'Kill' },
  bite:       { prio: 6, visits: true,  target: 'other', verb: 'Bite' },
  checkSus:   { prio: 7, visits: true,  target: 'other', verb: 'Check', info: true },
  clue:       { prio: 7, visits: true,  target: 'other', verb: 'Investigate', info: true },
  checkRole:  { prio: 7, visits: true,  target: 'other', verb: 'Investigate', info: true },
  checkAlign: { prio: 7, visits: true,  target: 'other', verb: 'Investigate', info: true },
  checkGun:   { prio: 7, visits: true,  target: 'other', verb: 'Inspect', info: true },
  track:      { prio: 7, visits: true,  target: 'other', verb: 'Track', info: true },
  watch:      { prio: 7, visits: true,  target: 'other', verb: 'Watch', info: true },
  count:      { prio: 7, visits: true,  target: 'other', verb: 'Watch', info: true },
  spy:        { prio: 7, visits: false, target: 'none',  verb: 'Spy on the Mafia', info: true },
  psychic:    { prio: 7, visits: false, target: 'none',  verb: 'Receive a vision', info: true },
  medium:     { prio: 7, visits: false, target: 'dead',  verb: 'Contact', info: true },
  seekMafia:  { prio: 7, visits: false, target: 'other', verb: 'Point at', info: true },
  oracle:     { prio: 7, visits: false, target: 'other', verb: 'Mark', info: true },
  recruit:    { prio: 8, visits: true,  target: 'other', verb: 'Recruit' },
  remember:   { prio: 8, visits: false, target: 'dead',  verb: 'Remember' },
  revive:     { prio: 8, visits: false, target: 'deadTown', verb: 'Revive' },
  reveal:     { prio: 0, visits: false, target: 'self',  verb: 'Reveal', day: true },
  guess:      { prio: 0, visits: false, target: 'other', verb: 'Guess', day: true },
};
// kinds a custom role may use
const CUSTOM_KINDS = ['heal','guard','roleblock','kill','checkSus','clue','checkRole','checkAlign','checkGun','track','watch','count','frame','disguise','blackmail','silence','vest','alert','douse','poison','medium'];

const TEAM_INFO = {
  town:    { name: 'Town',      side: 'town' },
  mafia:   { name: 'Mafia',     side: 'mafia' },
  cult:    { name: 'Cult',      side: 'neutral' },
  vampire: { name: 'Vampires',  side: 'neutral' },
  solo:    { name: 'Solo killer', side: 'neutral' },
  neutral: { name: 'Neutral',   side: 'neutral' },
};

const CLUE_NAMES = {
  weapons: 'Weapons', medicine: 'Medicine', paperwork: 'Paperwork', shadows: 'Shadows', watching: 'Watching',
  visitors: 'Visitors', whispers: 'Whispers', spirits: 'Spirits', survival: 'Survival', chaos: 'Chaos', common: 'Common folk',
};

/* ---------- role library ---------- */
// t: team, tags: filter categories, w: balance weight, wake: console order, def: base defense
function R(id, name, t, o) {
  return Object.assign({
    id, name, team: t, icon: 'mask', tags: [], short: '', desc: '', winText: '', def: 0, rbImmune: false, ctrlImmune: false, trImmune: false,
    sus: t === 'mafia', clue: 'common', gun: false, w: 0, diff: 1, minP: 5, wake: 90, abilities: [], knows: null, unique: false,
  }, o);
}
const WIN_TEXT = {
  town: 'Eliminate every Mafia member, killer and hostile faction.',
  mafia: 'Kill or out-vote everyone who opposes the Mafia.',
  cult: 'Make the Cult the last faction standing, or reach parity.',
  vampire: 'Make the Vampires the last faction standing, or reach parity.',
  solo: 'Be the last faction standing.',
};
const LIB = [
  /* ---- TOWN ---- */
  R('villager','Villager','town',{icon:'user',tags:['support'],w:1,short:'No ability. Your vote and your voice are your weapons.',desc:'You have no night ability. Listen, question, and vote out the killers.'}),
  R('doctor','Doctor','town',{icon:'cross',tags:['protective'],w:4,wake:60,clue:'medicine',short:'Heal one player each night.',desc:'Each night, heal one player. They gain Powerful defense tonight and any poison is cured. You may heal yourself once.',abilities:[{id:'heal',kind:'heal'}]}),
  R('police','Police','town',{icon:'badge',tags:['investigative','information'],w:6,wake:70,clue:'watching',short:'Point at a player: thumbs up if they are Mafia, thumbs down if not.',desc:'Each night, point at one player. The Game Master gives you a thumbs up if they are Mafia, and a thumbs down if they are not. A Framer can make an innocent look guilty, and a Disguiser can hide a Mafia member.',abilities:[{id:'inv',kind:'checkSus'}]}),
  R('investigator','Investigator','town',{icon:'search',tags:['investigative','information'],w:4,wake:71,clue:'paperwork',short:'Get a clue: your target is one of five roles.',desc:'Each night, investigate one player. You learn a short list of roles they could be.',abilities:[{id:'inv',kind:'clue'}]}),
  R('vigilante','Vigilante','town',{icon:'crosshair',tags:['killing'],w:4,wake:65,clue:'weapons',gun:true,short:'Shoot a player at night. 3 bullets.',desc:'From Night 2, you may shoot one player (Basic attack). You have 3 bullets. If you kill a Town member you will die of guilt the next night.',abilities:[{id:'shoot',kind:'kill',attack:1,uses:3,nights:'notFirst',vig:true}]}),
  R('bodyguard','Bodyguard','town',{icon:'shield',tags:['protective','killing'],w:3,wake:61,clue:'shadows',gun:true,short:'Guard a player and die in their place.',desc:'Each night, guard one other player. If they are attacked, you take the hit and strike back at the attacker with a Powerful attack.',abilities:[{id:'guard',kind:'guard'}]}),
  R('mayor','Mayor','town',{icon:'crown',tags:['support'],w:3,unique:true,clue:'paperwork',short:'Reveal yourself to get 3 votes.',desc:'Once during any day, you may reveal yourself. From then on your vote counts as 3, but Doctors can no longer heal you.',abilities:[{id:'reveal',kind:'reveal',uses:1}]}),
  R('jailkeeper','Jailkeeper','town',{icon:'lock',tags:['protective','roleblock','killing'],w:5,unique:true,wake:10,rbImmune:true,clue:'shadows',gun:true,short:'Jail a player: they are blocked and protected.',desc:'Each night, jail one player. Their action is cancelled and they gain Powerful defense. Twice per game you may execute your prisoner instead (Unstoppable). Executing a Town member costs you your remaining executions. You cannot be roleblocked — your jail happens first.',abilities:[{id:'jail',kind:'jail',executes:2}]}),
  R('tracker','Tracker','town',{icon:'footprints',tags:['investigative','information'],w:3,wake:73,clue:'paperwork',short:'See who your target visited.',desc:'Each night, follow one player and learn whom they visited.',abilities:[{id:'track',kind:'track'}]}),
  R('lookout','Lookout','town',{icon:'eye',tags:['investigative','information'],w:3,wake:74,clue:'watching',short:'See who visited your target.',desc:'Each night, watch one house and learn the names of everyone who visited it.',abilities:[{id:'watch',kind:'watch'}]}),
  R('watcher','Watcher','town',{icon:'telescope',tags:['information'],w:2,wake:75,clue:'watching',short:'Count visitors; did the target go out?',desc:'Each night, watch one house. You learn how many visitors it received and whether its owner went out.',abilities:[{id:'count',kind:'count'}]}),
  R('escort','Escort','town',{icon:'ban',tags:['roleblock','support'],w:3,wake:25,rbImmune:true,clue:'visitors',short:'Roleblock a player for the night.',desc:'Each night, distract one player so their night action fails. You cannot be roleblocked. Beware: blocking a Serial Killer gets you attacked.',abilities:[{id:'block',kind:'roleblock'}]}),
  R('veteran','Veteran','town',{icon:'medal',tags:['killing','protective'],w:3,wake:20,rbImmune:true,ctrlImmune:true,trImmune:true,clue:'weapons',gun:true,short:'Go on alert and shoot every visitor.',desc:'Three times per game, go on alert: you gain Basic defense and shoot everyone who visits you (Powerful attack) — friend or foe.',abilities:[{id:'alert',kind:'alert',uses:3}]}),
  R('medium','Medium','town',{icon:'candle',tags:['information','support'],w:2,wake:77,clue:'whispers',short:'Speak with the dead.',desc:'Each night, contact a dead player and learn their true role, even if it was hidden. The Game Master may relay one yes/no question to them.',abilities:[{id:'seance',kind:'medium'}]}),
  R('psychic','Psychic','town',{icon:'sparkle',tags:['information'],w:3,wake:79,clue:'spirits',short:'Receive visions about who is evil.',desc:'You receive a vision each night. Odd nights: three names, at least one evil. Even nights: two names, at least one good.',abilities:[{id:'vision',kind:'psychic'}]}),
  R('gunsmith','Gunsmith','town',{icon:'gun',tags:['investigative','information'],w:3,wake:72,clue:'spirits',short:'Learn whether a player carries a weapon.',desc:'Each night, inspect one player to learn whether they have a killing ability. Framed players look armed.',abilities:[{id:'inspect',kind:'checkGun'}]}),
  R('oracle','Oracle','town',{icon:'orb',tags:['information'],w:2,wake:78,clue:'spirits',short:'If you die, your last mark is revealed.',desc:'Each night, mark one player. If you die, the role of the last player you marked is revealed to everyone.',abilities:[{id:'mark',kind:'oracle'}]}),
  R('goodguesser','Good Guesser','town',{icon:'dice',tags:['killing','chaos'],w:3,clue:'common',gun:true,diff:2,short:'Guess a player\'s role by day. Right: they die. Wrong: you die.',desc:'During the day, name a player and the exact role you think they hold. A correct guess kills them; a wrong guess kills you. Limited shots.',abilities:[{id:'guess',kind:'guess',uses:'guessShots'}]}),
  R('transporter','Transporter','town',{icon:'swap',tags:['support','chaos'],w:3,wake:15,rbImmune:true,ctrlImmune:true,clue:'visitors',diff:3,short:'Swap two players: every action on one hits the other.',desc:'Each night, pick two players (yourself included). Every action targeting one of them hits the other instead.',abilities:[{id:'swap',kind:'transport'}]}),
  R('spy','Spy','town',{icon:'ear',tags:['information'],w:3,wake:76,clue:'watching',diff:2,short:'Learn whom the Mafia visited.',desc:'Each night you overhear the Mafia and learn every player they visited.',abilities:[{id:'spy',kind:'spy'}]}),
  R('priest','Priest','town',{icon:'ankh',tags:['protective','support'],w:3,unique:true,wake:86,clue:'whispers',diff:2,short:'Revive one dead Town member.',desc:'Once per game, choose a dead Town member. They return to life at dawn.',abilities:[{id:'revive',kind:'revive',uses:1}]}),
  R('hunter','Hunter','town',{icon:'bow',tags:['killing'],w:2,clue:'weapons',gun:true,short:'When you die, take one player with you.',desc:'You have no night action. When you die — by night or by vote — you immediately shoot one player of your choice.',onDeath:'hunter'}),
  R('cupid','Cupid','town',{icon:'heart',tags:['chaos','support'],w:0,unique:true,wake:5,clue:'chaos',diff:2,short:'Night 1: bind two lovers. If one dies, both die.',desc:'On Night 1, bind two players as lovers (you may choose yourself). If one lover dies, the other dies of heartbreak.',abilities:[{id:'bind',kind:'lovers',uses:1,nights:'first'}]}),
  R('twin','Twin','town',{icon:'twins',tags:['support','information'],w:2,clue:'common',knows:'twin',short:'You know the other Twin — a guaranteed ally.',desc:'You start the game knowing who the other Twin is. You can trust each other completely.'}),
  R('prince','Prince','town',{icon:'tiara',tags:['protective'],w:2,unique:true,clue:'survival',short:'Survive your first execution.',desc:'The first time you are voted out, you survive and your role is revealed. The second time, you die.'}),
  R('drunk','Drunk','town',{icon:'bottle',tags:['chaos'],w:0,clue:'common',diff:3,short:'Thinks they hold a power role. They do not.',desc:'You were told you hold a Town power role, but your actions do nothing and your results are random. You still win with the Town.'}),
  /* ---- MAFIA ---- */
  R('mafia','Mafia','mafia',{icon:'knife',tags:['killing'],w:-5,gun:true,knows:'mafia',short:'The rank-and-file killer. Can carry out the family\'s kill.',desc:'You know your fellow Mafia. Each night the family chooses one victim, and you may be the one who carries out the kill. If the Godfather dies and there is no Mafioso, you take over.'}),
  R('godfather','Godfather','mafia',{icon:'fedora',tags:['killing'],w:-6,unique:true,def:1,clue:'shadows',gun:true,knows:'mafia',short:'Leads the Mafia and survives a normal attack.',desc:'You lead the Mafia and have Basic defense, so a normal attack will not kill you. If you die, the Mafioso — or failing that, a Mafia member — takes your place. (House-rule option: the Godfather can fool the Police.)'}),
  R('mafioso','Mafioso','mafia',{icon:'knife',tags:['killing'],w:-5,clue:'weapons',gun:true,knows:'mafia',short:'The Godfather\'s chosen heir. First to carry out the kill, first in line to lead.',desc:'You are a Mafia member with two privileges: you carry out the kill by default, and if the Godfather dies you are promoted ahead of any plain Mafia.'}),
  R('strongman','Strongman','mafia',{icon:'fist',tags:['killing'],w:-6,clue:'shadows',gun:true,knows:'mafia',diff:2,short:'Twice per game, the Mafia kill becomes unstoppable.',desc:'When you carry out the Mafia kill, you may use a strong kill (twice per game) that pierces heals and jail.',abilities:[{id:'strong',kind:'kill',uses:2,viaFaction:true}]}),
  R('silencer','Silencer','mafia',{icon:'mute',tags:['support','chaos'],w:-6,wake:31,clue:'whispers',knows:'mafia',short:'Your target cannot vote tomorrow.',desc:'Each night, choose a player. They cannot vote during the next day.',abilities:[{id:'silence',kind:'silence'}]}),
  R('silentmafia','Silent Mafia','mafia',{icon:'hand',tags:['investigative','information'],w:-4,wake:42,rbImmune:true,ctrlImmune:true,hiddenMember:true,clue:'whispers',knows:null,diff:2,short:'On the Mafia\'s side but doesn\'t know them. Point each night — a thumbs up means Mafia.',desc:'You are on the Mafia\'s side, but you do not know who they are — and they do not know you. They may even kill you. Each night, point at one player: the Game Master gives a thumbs up only if that player is Mafia. Find the family, then back them in the vote.',winText:'Win with the Mafia. If every real Mafia member dies, you lose with them.',abilities:[{id:'seek',kind:'seekMafia'}]}),
  R('blackmailer','Blackmailer','mafia',{icon:'envelope',tags:['support'],w:-6,wake:32,clue:'whispers',knows:'mafia',short:'Your target cannot speak tomorrow.',desc:'Each night, blackmail one player. They may not speak during the next day, though they may still vote.',abilities:[{id:'bm',kind:'blackmail'}]}),
  R('consort','Mafia Roleblocker','mafia',{icon:'ban',tags:['roleblock','support'],w:-6,wake:30,rbImmune:true,clue:'visitors',knows:'mafia',short:'Blocks one player\'s night ability — usually a Town power role.',desc:'Each night, choose one player. Their night ability fails tonight. You cannot be roleblocked yourself. (Called the Consort in some rule sets.)',abilities:[{id:'block',kind:'roleblock'}]}),
  R('consigliere','Consigliere','mafia',{icon:'scroll',tags:['investigative','information'],w:-7,wake:39,clue:'paperwork',knows:'mafia',short:'Learn a player\'s exact role.',desc:'Each night, learn the exact role of one player.',abilities:[{id:'inv',kind:'checkRole'}]}),
  R('mafiainv','Mafia Investigator','mafia',{icon:'search',tags:['investigative','information'],w:-6,wake:40,clue:'watching',knows:'mafia',short:'Learn which faction a player belongs to.',desc:'Each night, learn whether one player is Town, Mafia, Neutral, Cult or Vampire.',abilities:[{id:'inv',kind:'checkAlign'}]}),
  R('framer','Framer','mafia',{icon:'frame',tags:['support','chaos'],w:-6,wake:33,clue:'chaos',knows:'mafia',short:'Make an innocent look guilty.',desc:'Each night, frame one player. Tonight the Police get a thumbs up on them, and every other check sees them as armed Mafia.',abilities:[{id:'frame',kind:'frame'}]}),
  R('disguiser','Disguiser','mafia',{icon:'mask',tags:['support','chaos'],w:-6,wake:34,clue:'medicine',knows:'mafia',diff:2,short:'Make a player look like a harmless Villager.',desc:'Each night, disguise one player (often a teammate). Tonight the Police get a thumbs down on them, and every other check sees a harmless Villager.',abilities:[{id:'disguise',kind:'disguise'}]}),
  R('janitor','Janitor','mafia',{icon:'broom',tags:['support','chaos'],w:-6,wake:35,clue:'whispers',knows:'mafia',short:'Hide the role of a player who dies tonight.',desc:'Each night, clean a player. If they die tonight, their role is hidden from everyone and revealed only to you. 3 cleans, spent only when the target dies.',abilities:[{id:'clean',kind:'clean',uses:3}]}),
  R('hypnotist','Hypnotist','mafia',{icon:'spiral',tags:['chaos','support'],w:-6,wake:36,clue:'visitors',knows:'mafia',diff:2,short:'Plant a false night message.',desc:'Each night, send one player a fake message such as "You were roleblocked" or "You were healed".',abilities:[{id:'hyp',kind:'hypnotize'}]}),
  R('ambusher','Ambusher','mafia',{icon:'dagger',tags:['killing'],w:-6,wake:38,clue:'weapons',gun:true,knows:'mafia',diff:2,short:'Lie in wait and kill a visitor.',desc:'Each night, wait outside a house. One non-Mafia visitor is attacked (Basic).',abilities:[{id:'ambush',kind:'ambush'}]}),
  R('poisoner','Poisoner','mafia',{icon:'vial',tags:['killing'],w:-6,wake:37,clue:'medicine',gun:true,knows:'mafia',diff:2,short:'Poison: the target dies at the end of the next night.',desc:'Each night, poison one player. They die at the end of the following night unless a Doctor heals them in time.',abilities:[{id:'poison',kind:'poison'}]}),
  R('evilguesser','Evil Guesser','mafia',{icon:'dice',tags:['killing','chaos'],w:-6,clue:'common',gun:true,knows:'mafia',diff:2,short:'Guess roles by day. Right: they die. Wrong: you die.',desc:'During the day, name a player and the exact role you think they hold. A correct guess kills them; a wrong guess kills you.',abilities:[{id:'guess',kind:'guess',uses:'guessShots'}]}),
  /* ---- NEUTRAL ---- */
  R('jester','Jester','neutral',{icon:'jester',tags:['chaos'],w:-1,clue:'chaos',short:'Get yourself voted out.',desc:'You win if the town executes you. Then you haunt one of the players who voted for you: they die the next night.',winText:'Be executed by the town\'s vote.',win:'jester'}),
  R('executioner','Executioner','neutral',{icon:'noose',tags:['chaos'],w:-2,def:1,clue:'survival',short:'Get your target executed.',desc:'You are given a Town target. Win by getting them executed. You have Basic defense. If your target dies another way, you become a Jester.',winText:'Get your target executed by vote.',win:'executioner'}),
  R('survivor','Survivor','neutral',{icon:'vest',tags:['protective'],w:0,wake:21,clue:'survival',short:'Just survive. 4 vests.',desc:'You win if you are alive at the end, whoever wins. Four times per game, wear a vest for Basic defense.',winText:'Be alive when the game ends.',win:'survivor',abilities:[{id:'vest',kind:'vest',uses:4}]}),
  R('guardian','Guardian Angel','neutral',{icon:'wings',tags:['protective'],w:1,wake:62,clue:'survival',diff:2,short:'Keep your assigned player alive.',desc:'You are given a target. Twice per game, shield them from anywhere (Powerful defense). You win if they are alive at the end, even if you are dead. If they die, you become a Survivor.',winText:'Your target is alive at the end.',win:'guardian',abilities:[{id:'shield',kind:'shield',uses:2}]}),
  R('amnesiac','Amnesiac','neutral',{icon:'cloud',tags:['chaos'],w:0,wake:85,clue:'survival',diff:2,short:'Take the role of a dead player.',desc:'Once per game, choose a dead player. You become their role and join their team.',winText:'Remember a role, then win with it.',win:'amnesiac',abilities:[{id:'remember',kind:'remember',uses:1}]}),
  R('politician','Politician','neutral',{icon:'podium',tags:['chaos'],w:-1,clue:'paperwork',appearsTown:true,diff:2,short:'Back the winning side of every vote.',desc:'You appear Town. You win if you are alive at the end and you voted for the executed player in at least half of all executions.',winText:'Be alive and on the right side of half the executions.',win:'politician'}),
  R('witch','Witch','neutral',{icon:'cauldron',tags:['chaos'],w:-3,wake:18,clue:'spirits',diff:3,short:'Control a player\'s action.',desc:'Each night, force one player to use their ability on a target you choose. You learn their role. You win if you are alive and the Town does not win.',winText:'Be alive when the Town loses.',win:'witch',abilities:[{id:'control',kind:'control'}]}),
  R('pirate','Pirate','neutral',{icon:'skullbones',tags:['killing','chaos'],w:-3,wake:28,rbImmune:true,clue:'visitors',gun:true,diff:2,short:'Duel a player each night. Win two duels.',desc:'Each night, duel a player (not the same one twice in a row). The Game Master runs a quick rock-paper-scissors. Win and your target is roleblocked and plundered (Powerful attack). Two wins and you win.',winText:'Win two duels.',win:'pirate',abilities:[{id:'duel',kind:'duel'}]}),
  R('serialkiller','Serial Killer','solo',{icon:'knife',tags:['killing'],w:-7,wake:45,def:1,rbImmune:true,clue:'medicine',gun:true,short:'Kill one player every night.',desc:'Each night, attack one player (Basic). You have Basic defense and cannot be roleblocked — anyone who tries is attacked too.',retaliate:1,abilities:[{id:'kill',kind:'kill',attack:1}]}),
  R('arsonist','Arsonist','solo',{icon:'flame',tags:['killing','chaos'],w:-7,wake:46,def:1,clue:'shadows',gun:true,diff:2,short:'Douse players, then burn them all.',desc:'Each night, douse one player in gasoline or ignite everyone doused (Unstoppable). Anyone who visits you is doused. You have Basic defense.',abilities:[{id:'douse',kind:'douse'},{id:'ignite',kind:'ignite'}]}),
  R('werewolf','Werewolf','solo',{icon:'wolf',tags:['killing'],w:-8,wake:47,def:1,rbImmune:true,clue:'chaos',gun:true,diff:2,short:'On full moons, maul a house and every visitor.',desc:'On even nights (full moon), rampage at a house: its owner and every visitor suffer a Powerful attack. Stay home to maul your own visitors. You have Basic defense, and the Police give you a thumbs down — you are not Mafia.',retaliate:2,abilities:[{id:'rampage',kind:'rampage',attack:2,nights:'even'}]}),
  R('cultleader','Cult Leader','cult',{icon:'eye3',tags:['chaos'],w:-7,unique:true,wake:50,clue:'spirits',knows:'cult',diff:3,short:'Recruit players into your Cult.',desc:'Each night, recruit one player into the Cult. Mafia, killers, Vampires, jailed or protected players resist. If you die, your oldest follower takes over.',abilities:[{id:'recruit',kind:'recruit'}]}),
  R('cultist','Cultist','cult',{icon:'hood',tags:['chaos'],w:-3,clue:'common',knows:'cult',short:'A follower of the Cult.',desc:'You have joined the Cult. You know your fellow members. Help the Cult take over the town.'}),
  R('vampire','Vampire','vampire',{icon:'fang',tags:['killing','chaos'],w:-6,clue:'chaos',gun:true,knows:'vampire',diff:3,short:'Bite players to turn them into Vampires.',desc:'Each night the Vampires bite one player. Town and neutral targets become Vampires (up to the cap); others are attacked (Basic).'}),
];
LIB.forEach(r => { if (!r.winText) r.winText = WIN_TEXT[r.team] || ''; if (!r.win) r.win = r.team; });
const LIBMAP = Object.fromEntries(LIB.map(r => [r.id, r]));
const ORDER = LIB.map(r => r.id);

function getRole(s, id) { return (s && s.customRoles && s.customRoles[id]) || LIBMAP[id] || null; }
function allRoles(s) { return LIB.concat(Object.values((s && s.customRoles) || {})); }
function abilityDef(s, roleId, abId) { const r = getRole(s, roleId); return r && r.abilities.find(a => a.id === abId); }
function kindOf(ab) { return KINDS[ab.kind] || {}; }
function rolesInClue(s, clue) { return allRoles(s).filter(r => r.clue === clue && r.id !== 'cultist').map(r => r.name); }

/* ---------- configuration ---------- */
const DEFAULT_CONFIG = {
  revealOnDeath: true, showCause: true, selfHeal: 'once', healMode: 'all', doctorNotified: true,
  godfatherInnocent: false, nkSuspicious: false, cfgv: 2, mafiaBackup: false, promote: true,
  vigTown: 'guilt', vigNight1: false, exeFallback: 'jester', jesterHaunt: true,
  guessShots: 2, guessWrong: 'die', voteThreshold: 'plurality', voteTie: 'none', allowSkip: true, mayorWeight: 3,
  parity: true, showdown: true, bluffDead: true, announceAmnesiac: true, convertCap: 4,
  dayTimer: 5, nightTimer: 0, godPin: '', stalemateCycles: 3,
};
const HYPNO_MSGS = [
  'You were roleblocked!', 'You were attacked, but someone nursed you back to health!', 'You were transported to another location.',
  'You were doused in gasoline!', 'Someone attacked you, but a Bodyguard fought them off!', 'You were controlled by a Witch.',
];

/* ---------- game creation & players ---------- */
const COLORS = ['#e05a5a','#e0925a','#d9b44a','#8fbf5a','#4fb38f','#4aa8c9','#6b8de0','#9a7be0','#c86bc9','#e06b9a','#b08a6b','#7f9aa8'];
function newGame() {
  return {
    v: 1, id: uid('g'), createdAt: Date.now(), startedAt: null, endedAt: null,
    phase: 'setup', night: 0, day: 0, players: [], customRoles: {},
    setup: { style: 'balanced', pool: {}, seed: 1, autoRecommend: true },
    config: clone(DEFAULT_CONFIG), actions: [], dayState: null, pending: [], scheduled: [], deaths: [], events: [],
    reports: {}, votes: [], publicNotes: [], showdown: null, winPrompt: null, result: null, executions: 0, initialRoles: [],
  };
}
function addPlayer(s, name) {
  const p = { id: uid('p'), name: String(name).trim().slice(0, 24) || 'Player', color: COLORS[s.players.length % COLORS.length], roleId: null, team: null, alive: true, fx: {}, uses: {}, meta: {}, lock: false };
  s.players.push(p); return p;
}
function getP(s, id) { return s.players.find(p => p.id === id); }
function pname(s, id) { const p = getP(s, id); return p ? p.name : '?'; }

/* ---------- role assignment ---------- */
function initUses(s, role) {
  const u = {};
  for (const ab of role.abilities || []) {
    if (ab.uses === 'guessShots') u[ab.id] = s.config.guessShots;
    else if (typeof ab.uses === 'number') u[ab.id] = ab.uses;
    if (ab.executes) u.execute = ab.executes;
  }
  return u;
}
function setRole(s, p, roleId, opt = {}) {
  const role = getRole(s, roleId); if (!role) throw new Error('Unknown role ' + roleId);
  p.roleId = roleId; if (!opt.keepTeam) p.team = role.team;
  p.uses = initUses(s, role);
  if (!opt.keepMeta) p.meta = { joined: s.night || 0 };
  ensureRoleMeta(s, p);
}
const DRUNK_FAKES = ['doctor','police','investigator','lookout','tracker','gunsmith','bodyguard','escort','watcher'];
// any role change fills in what the role needs: Executioner/Guardian targets, the Drunk's believed role
function ensureRoleMeta(s, p) {
  const live = q => q.alive !== false && q.id !== p.id;
  if (p.roleId === 'executioner' && !(p.meta.target && getP(s, p.meta.target))) {
    const c = s.players.filter(q => live(q) && q.team === 'town' && !['mayor', 'jailkeeper'].includes(q.roleId)); const c2 = c.length ? c : s.players.filter(q => live(q) && q.team === 'town');
    p.meta.target = c2.length ? pick(c2).id : null;
  }
  if (p.roleId === 'guardian' && !(p.meta.target && getP(s, p.meta.target))) { const c = s.players.filter(live); p.meta.target = c.length ? pick(c).id : null; }
  if (p.roleId === 'drunk' && !p.meta.fake) p.meta.fake = pick(DRUNK_FAKES);
}
function poolList(pool) { const out = []; for (const id of ORDER.concat(Object.keys(pool).filter(k => !LIBMAP[k]))) { const n = pool[id] | 0; for (let i = 0; i < n; i++) out.push(id); } return out; }
function assignRoles(s) {
  const list = poolList(s.setup.pool);
  if (list.length !== s.players.length) throw new Error(`Role count (${list.length}) must equal player count (${s.players.length}).`);
  const remaining = list.slice();
  for (const p of s.players) if (p.lock && p.roleId) { const i = remaining.indexOf(p.roleId); if (i >= 0) remaining.splice(i, 1); else p.lock = false; }
  const free = shuffle(s.players.filter(p => !(p.lock && p.roleId)));
  const bag = shuffle(remaining);
  free.forEach((p, i) => { p.roleId = bag[i]; });
  finalizeAssignment(s);
}
function finalizeAssignment(s) {
  for (const p of s.players) { const r = p.roleId; p.alive = true; p.fx = {}; setRole(s, p, r); }
  for (const p of s.players) {
    if (p.roleId === 'executioner') { const c = s.players.filter(q => q.id !== p.id && q.team === 'town' && !['mayor','jailkeeper'].includes(q.roleId)); const c2 = c.length ? c : s.players.filter(q => q.id !== p.id && q.team === 'town'); p.meta.target = c2.length ? pick(c2).id : null; }
    if (p.roleId === 'guardian') { const c = s.players.filter(q => q.id !== p.id); p.meta.target = c.length ? pick(c).id : null; }
    if (p.roleId === 'drunk') { const fakes = ['doctor','police','investigator','lookout','tracker','gunsmith','bodyguard','escort','watcher']; p.meta.fake = pick(fakes); }
  }
  s.initialRoles = s.players.map(p => ({ id: p.id, roleId: p.roleId, team: p.team, target: p.meta.target || null, fake: p.meta.fake || null }));
}

/* ---------- setup sanity warnings (advisory) ---------- */
function setupWarnings(s, pool) {
  pool = pool || s.setup.pool; const ids = poolList(pool); const w = [];
  const roles = ids.map(id => getRole(s, id)).filter(Boolean);
  const has = id => ids.includes(id);
  const realMafia = roles.filter(r => r.team === 'mafia' && !r.hiddenMember).length;
  const threats = roles.filter(r => (r.team === 'mafia' && !r.hiddenMember) || ['solo', 'cult', 'vampire'].includes(r.team)).length;
  if (ids.length && !threats) w.push('No Mafia or killer is in the game, so the Town wins at once.');
  if (has('silentmafia') && !realMafia) w.push('The Silent Mafia needs at least one real Mafia member to find.');
  if (ids.filter(x => x === 'twin').length === 1) w.push('A single Twin has nobody to know. Add Twins in pairs.');
  if (has('executioner') && !roles.some(r => r.team === 'town')) w.push('The Executioner needs a Town player as a target.');
  for (const r of roles) if (r.unique && ids.filter(x => x === r.id).length > 1 && !w.some(t => t.startsWith(r.name))) w.push(`${r.name} is meant to be unique — ${ids.filter(x => x === r.id).length} are in the list.`);
  if (ids.filter(x => x === 'vampire').length > s.config.convertCap) w.push('More starting Vampires than the size cap allows.');
  if (has('cultist') && !has('cultleader')) w.push('Cultists without a Cult Leader can never grow.');
  return w;
}

/* ---------- balance & recommender ---------- */
function balanceOf(s, pool) {
  let score = 0; const counts = { town: 0, mafia: 0, neutral: 0 };
  for (const id of poolList(pool)) { const r = getRole(s, id); if (!r) continue; score += r.w; counts[TEAM_INFO[r.team].side]++; }
  const n = counts.town + counts.mafia + counts.neutral;
  const label = score > 6 ? 'Strongly Town-favored' : score > 3 ? 'Town-favored' : score >= -3 ? 'Fair' : score >= -6 ? 'Evil-favored' : 'Strongly evil-favored';
  return { score: Math.round(score * 10) / 10, label, counts, n, fair: Math.abs(score) <= 3 };
}
const STYLES = {
  beginner: { town: ['doctor','police','bodyguard'], mafia: ['mafia'], objective: ['jester'], killers: [], villagerShare: 0.5 },
  classic:  { town: ['doctor','police','vigilante','bodyguard','investigator','mayor','lookout','escort','veteran','tracker','medium','gunsmith'], mafia: ['godfather','mafia','silentmafia','consort','mafia','framer','janitor','blackmailer','consigliere'], objective: ['jester','survivor','executioner'], killers: ['serialkiller'], villagerShare: 0.4 },
  balanced: { town: ['doctor','police','bodyguard','investigator','lookout','vigilante','mayor','escort','jailkeeper','tracker','veteran','medium','gunsmith','psychic','transporter','spy','priest','watcher'], mafia: ['godfather','mafia','consort','silentmafia','framer','janitor','blackmailer','consigliere','disguiser','silencer','ambusher'], objective: ['jester','survivor','executioner','guardian','amnesiac'], killers: ['serialkiller','arsonist','werewolf'], villagerShare: 0.35 },
  chaos:    { town: ['doctor','police','transporter','vigilante','lookout','cupid','veteran','hunter','spy','drunk','escort','prince','oracle','goodguesser','psychic','priest','investigator','bodyguard'], mafia: ['godfather','mafia','silentmafia','poisoner','hypnotist','framer','disguiser','ambusher','strongman','evilguesser','silencer'], objective: ['jester','witch','pirate','executioner','amnesiac','politician'], killers: ['arsonist','werewolf','cultleader','serialkiller'], villagerShare: 0.3 },
  advanced: { town: ['doctor','police','investigator','jailkeeper','lookout','tracker','bodyguard','vigilante','mayor','escort','transporter','spy','priest','hunter','oracle','psychic','gunsmith','medium','watcher','goodguesser','prince','veteran'], mafia: ['godfather','mafia','consort','silentmafia','consigliere','framer','janitor','blackmailer','poisoner','disguiser','silencer','hypnotist','strongman','ambusher','evilguesser','mafiainv'], objective: ['jester','executioner','survivor','guardian','witch','pirate','politician','amnesiac'], killers: ['serialkiller','arsonist','werewolf','cultleader'], villagerShare: 0.3 },
};
STYLES.large = Object.assign({}, STYLES.advanced, { villagerShare: 0.38 });
const STYLE_NAMES = { beginner: 'Beginner', classic: 'Classic', balanced: 'Balanced', chaos: 'Chaos', advanced: 'Advanced', large: 'Large group' };
function seats(n, style) {
  const mafia = Math.max(1, Math.floor((n + 1) / 4));
  let neutral = n <= 6 ? 0 : n <= 10 ? 1 : n <= 15 ? 2 : n <= 20 ? 3 : n <= 25 ? 4 : 5;
  let killers = n >= 21 ? 2 : n >= 11 ? 1 : 0;
  if (style === 'beginner') { neutral = n >= 10 ? 1 : 0; killers = 0; }
  if (style === 'classic') { neutral = Math.min(neutral, n >= 8 ? (n >= 13 ? 2 : 1) : 0); killers = n >= 13 ? 1 : 0; }
  if (style === 'chaos') { neutral = n <= 5 ? 0 : n <= 8 ? 1 : neutral; killers = n >= 9 ? (n >= 20 ? 2 : 1) : 0; }
  if (style === 'large') { neutral = Math.max(neutral, n >= 12 ? 3 : neutral); }
  killers = Math.min(killers, neutral);
  const town = n - mafia - neutral;
  return { mafia, neutral, killers, town };
}
function rotate(list, keep, seed) {
  // keep the first `keep` items fixed; shuffle the rest deterministically by seed
  const head = list.slice(0, keep), tail = list.slice(keep);
  if (seed > 1) { const prev = _rng; _rng = seeded(seed * 7919); const t = shuffle(tail); _rng = prev; return head.concat(t); }
  return list.slice();
}
function recommend(n, style = 'balanced', seed = 1, s = null) {
  n = Math.max(5, Math.min(40, n | 0));
  const st = STYLES[style] || STYLES.balanced; const seat = seats(n, style);
  const dis = new Set((s && s.setup && s.setup.disabled) || []);
  const en = l => l.filter(id => !dis.has(id));
  const townList = rotate(en(st.town), 2, seed), mafiaList = rotate(en(st.mafia), 2, seed), objList = rotate(en(st.objective).length ? en(st.objective) : ['survivor'], 1, seed), killList = rotate(en(st.killers), 0, seed);
  const pool = {};
  const add = (id, k = 1) => { pool[id] = (pool[id] || 0) + k; };
  // town
  let villagers = Math.round(seat.town * st.villagerShare);
  let power = seat.town - villagers;
  if (seat.town >= 3) power = Math.max(2, power);
  power = Math.min(power, townList.length); villagers = seat.town - power;
  townList.slice(0, power).forEach(id => add(id));
  if (villagers) add('villager', villagers);
  // mafia
  if (seat.mafia === 1) add('mafia');
  else { for (let i = 0; i < seat.mafia; i++) add(i < mafiaList.length ? mafiaList[i] : 'mafia'); }
  if (style === 'beginner') { delete pool.godfather; delete pool.mafioso; pool.mafia = seat.mafia; }
  // neutral
  for (let i = 0; i < seat.killers; i++) add(killList.length ? killList[i % killList.length] : objList[i % objList.length]);
  for (let i = 0; i < seat.neutral - seat.killers; i++) add(objList[i % objList.length]);
  for (const k of Object.keys(pool)) if (!pool[k]) delete pool[k];
  // tune toward the fair band
  const usedTown = () => Object.keys(pool).filter(id => LIBMAP[id] && LIBMAP[id].team === 'town' && id !== 'villager');
  const DUPES = ['police','doctor','investigator','lookout','vigilante','bodyguard','tracker','escort'].filter(id => !dis.has(id));
  for (let it = 0; it < 40; it++) {
    const b = balanceOf(s, pool);
    const tol = style === 'chaos' ? 6 : 3;
    if (Math.abs(b.score) <= tol) break;
    if (b.score > tol) {
      const mafiaPlain = (pool.mafia || 0) > 1 ? 'mafia' : null; // always keep one plain Mafia
      const upgrade = mafiaList.find(id => !pool[id]);
      if (mafiaPlain && upgrade && style !== 'beginner') { pool.mafia--; if (!pool.mafia) delete pool.mafia; add(upgrade); continue; }
      const cand = usedTown().filter(id => !['doctor','police'].includes(id)).sort((a, b) => LIBMAP[b].w - LIBMAP[a].w)[0];
      if (cand) { pool[cand]--; if (!pool[cand]) delete pool[cand]; add('villager'); continue; }
      const obj = objList.find(id => !pool[id] && LIBMAP[id].w < 0);
      if (pool.villager && obj && style !== 'beginner') { pool.villager--; if (!pool.villager) delete pool.villager; add(obj); continue; }
      break;
    } else {
      const next = townList.find(id => !pool[id] && LIBMAP[id].w > 0) || (style !== 'beginner' && DUPES.find(id => (pool[id] || 0) < 2));
      if (pool.villager && next) { pool.villager--; if (!pool.villager) delete pool.villager; add(next); continue; }
      const sup = Object.keys(pool).find(id => LIBMAP[id] && LIBMAP[id].team === 'mafia' && LIBMAP[id].w <= -6 && id !== 'godfather' && id !== 'strongman');
      if (sup) { pool[sup]--; if (!pool[sup]) delete pool[sup]; add('mafia'); continue; }
      const killer = Object.keys(pool).find(id => LIBMAP[id] && ['solo','cult','vampire'].includes(LIBMAP[id].team));
      const obj = objList.find(id => !pool[id] && LIBMAP[id].w >= 0) || 'survivor';
      if (killer && style !== 'chaos') { pool[killer]--; if (!pool[killer]) delete pool[killer]; add(obj); continue; }
      if (pool.godfather && seat.mafia >= 2) { pool.godfather--; if (!pool.godfather) delete pool.godfather; add('mafia'); continue; }
      if (killer) { pool[killer]--; if (!pool[killer]) delete pool[killer]; add(obj); continue; }
      break;
    }
  }
  return { pool, balance: balanceOf(s, pool), seats: seat };
}

/* ---------- events ---------- */
function phaseTag(s) { return s.phase === 'night' ? 'N' + s.night : s.phase === 'setup' || s.phase === 'reveal' || s.phase === 'reveal-done' ? 'Setup' : 'D' + Math.max(1, s.day); }
function log(s, type, text, extra) { s.events.push(Object.assign({ t: Date.now(), ph: phaseTag(s), type, text }, extra || {})); }

const isHidden = (s, p) => { const r = getRole(s, p.roleId); return !!(r && r.hiddenMember); };
/* ---------- abilities availability ---------- */
function effRole(s, p) { return getRole(s, p.roleId === 'drunk' && p.meta.fake ? p.meta.fake : p.roleId); }
function nightAbilities(s, p) { const r = effRole(s, p); return (r.abilities || []).filter(a => !kindOf(a).day && !a.viaFaction); }
function dayAbilities(s, p) { const r = getRole(s, p.roleId); return (r.abilities || []).filter(a => kindOf(a).day); }
function abilityStatus(s, p, ab) {
  const N = s.night, k = kindOf(ab);
  if (!p.alive) return { ok: false, why: 'Dead' };
  const usesKey = ab.id;
  const isDrunk = p.roleId === 'drunk';
  if (!isDrunk && p.uses[usesKey] !== undefined && p.uses[usesKey] <= 0) return { ok: false, why: 'No uses left' };
  const nights = ab.vig && s.config.vigNight1 ? 'all' : ab.nights || 'all';
  if (nights === 'notFirst' && N <= 1) return { ok: false, why: 'Not on Night 1' };
  if (nights === 'first' && N !== 1) return { ok: false, why: 'Night 1 only' };
  if (nights === 'even' && N % 2 !== 0) return { ok: false, why: 'Only on full-moon (even) nights' };
  if (k.target === 'dead' && !s.players.some(q => !q.alive)) return { ok: false, why: 'Nobody has died yet' };
  if (k.target === 'deadTown' && !s.players.some(q => !q.alive && q.team === 'town')) return { ok: false, why: 'No dead Town members' };
  if (ab.kind === 'recruit' && s.players.filter(q => q.alive && q.team === 'cult').length >= s.config.convertCap) return { ok: false, why: 'Cult is at the size cap' };
  if (ab.kind === 'shield' && (!p.meta.target || !getP(s, p.meta.target) || !getP(s, p.meta.target).alive)) return { ok: false, why: 'Target is dead' };
  return { ok: true };
}

/* ---------- night console steps ---------- */
const CARRIER_PRIORITY = { mafioso: 1, strongman: 2, mafia: 3, godfather: 4 };
function defaultCarrier(s, faction) {
  const m = s.players.filter(p => p.alive && p.team === faction && !isHidden(s, p));
  if (!m.length) return null;
  return m.slice().sort((a, b) => (CARRIER_PRIORITY[a.roleId] || 9) - (CARRIER_PRIORITY[b.roleId] || 9))[0].id;
}
function nightSteps(s) {
  const steps = [];
  const alive = s.players.filter(p => p.alive);
  for (const f of ['mafia', 'vampire']) {
    const m = alive.filter(p => p.team === f && !isHidden(s, p));
    if (m.length) steps.push({ key: f, type: 'faction', faction: f, wake: f === 'mafia' ? 29 : 52, title: f === 'mafia' ? 'The Mafia' : 'The Vampires', actors: m.map(p => p.id), kind: f === 'mafia' ? 'factionKill' : 'bite', script: f === 'mafia' ? 'Mafia, wake up. Choose tonight\'s victim and who carries out the kill.' : 'Vampires, wake up. Choose who to bite.' });
  }
  for (const p of alive) {
    const abs = nightAbilities(s, p);
    if (!abs.length) continue;
    const r = effRole(s, p);
    steps.push({ key: p.id, type: 'player', actor: p.id, roleId: r.id, wake: r.wake, title: r.name, drunk: p.roleId === 'drunk',
      abilities: abs.map(ab => Object.assign({ id: ab.id, kind: ab.kind, verb: kindOf(ab).verb, target: kindOf(ab).target }, abilityStatus(s, p, ab))),
      script: `${r.name}, wake up.` });
  }
  if (s.config.bluffDead) {
    const seen = new Set();
    for (const ir of s.initialRoles || []) {
      if (seen.has(ir.roleId)) continue; seen.add(ir.roleId);
      const r = getRole(s, ir.roleId); if (!r) continue;
      const hasNight = (r.abilities || []).some(a => !kindOf(a).day && !a.viaFaction);
      if (!hasNight) continue;
      const holders = s.players.filter(p => (p.roleId === 'drunk' ? p.meta.fake : p.roleId) === ir.roleId && p.alive);
      if (!holders.length) steps.push({ key: 'bluff:' + r.id, type: 'bluff', wake: r.wake, title: r.name, script: `Call the ${r.name} as usual and wait a few seconds — every holder is dead.` });
    }
  }
  steps.sort((a, b) => a.wake - b.wake);
  return steps;
}

/* ---------- target legality ---------- */
function legalTargets(s, actorId, abId, slot = 0, firstTarget = null) {
  const out = [];
  let kind, tgt, faction = null, actor = getP(s, actorId);
  if (abId === 'factionKill' || abId === 'bite') { kind = abId; tgt = 'other'; faction = abId === 'factionKill' ? 'mafia' : 'vampire'; }
  else { const ab = nightAbilities(s, actor).concat(dayAbilities(s, actor)).find(a => a.id === abId); if (!ab) return out; kind = ab.kind; tgt = kindOf(ab).target; }
  for (const p of s.players) {
    let ok = true, why = '';
    const self = actor && p.id === actor.id;
    if (tgt === 'dead') { ok = !p.alive; why = ok ? '' : 'Alive'; }
    else if (tgt === 'deadTown') { ok = !p.alive && p.team === 'town'; why = p.alive ? 'Alive' : ok ? '' : 'Not Town'; }
    else if (!p.alive) { ok = false; why = 'Dead'; }
    else if (faction && p.team === faction && !isHidden(s, p)) { ok = false; why = 'Teammate'; }
    else if (tgt === 'other' && self) { ok = false; why = 'Cannot target self'; }
    else if (tgt === 'two') {
      if (kind === 'control' && slot === 0 && self) { ok = false; why = 'Cannot control self'; }
      if (slot === 1 && firstTarget === p.id) { ok = false; why = 'Already chosen'; }
    }
    if (ok && kind === 'heal' && self) {
      const sh = s.config.selfHeal; if (sh === 'never' || (sh === 'once' && (actor.meta.selfHeals || 0) >= 1)) { ok = false; why = sh === 'never' ? 'Self-heal disabled' : 'Self-heal used'; }
    }
    if (ok && kind === 'heal' && !self && p.fx.revealed && p.roleId === 'mayor') { ok = false; why = 'Revealed Mayor cannot be healed'; }
    if (ok && kind === 'duel' && actor.meta.lastDuel === p.id && actor.meta.lastDuelNight === s.night - 1) { ok = false; why = 'Dueled last night'; }
    if (ok && kind === 'transport' && p.id !== actorId && getRole(s, p.roleId).trImmune) { ok = false; why = 'Cannot be transported'; }
    out.push({ id: p.id, ok, why });
  }
  return out;
}

/* ---------- recording actions ---------- */
function setAction(s, a) {
  // a: {key, actor, ab, targets, opts}
  s.actions = s.actions.filter(x => x.key !== a.key);
  s.actions.push(Object.assign({ targets: [], opts: {}, at: Date.now() }, a));
  log(s, 'action', describeAction(s, a), { secret: true });
  return s;
}
function describeAction(s, a) {
  const tnames = (a.targets || []).map(t => pname(s, t)).join(' & ');
  if (a.key === 'mafia' || a.key === 'vampire') return `${a.key === 'mafia' ? 'Mafia' : 'Vampires'} (carried out by ${pname(s, a.actor)}): ${a.key === 'mafia' ? 'kill' : 'bite'} → ${tnames}${a.opts && a.opts.strong ? ' (strong kill)' : ''}`;
  const p = getP(s, a.actor); const r = p ? effRole(s, p) : null; const ab = p ? nightAbilities(s, p).find(x => x.id === a.ab) : null;
  const verb = ab ? (KINDS[ab.kind].verb || ab.kind).toLowerCase() : a.ab;
  return `${pname(s, a.actor)}${r ? ` (${r.name}${p.roleId === 'drunk' ? ', Drunk' : ''})` : ''}: ${verb}${tnames ? ' → ' + tnames : ''}${a.opts && a.opts.execute ? ' (execute)' : ''}`;
}
function clearAction(s, key) { s.actions = s.actions.filter(x => x.key !== key); return s; }

/* ---------- appearance for investigations ---------- */
function isEvil(s, p) { return ['mafia', 'cult', 'vampire', 'solo'].includes(p.team) || p.roleId === 'witch'; }
function teamLabel(p) { return { town: 'Town', mafia: 'Mafia', cult: 'Cult', vampire: 'Vampire', solo: 'Neutral', neutral: 'Neutral' }[p.team] || 'Neutral'; }
function appearance(s, p, ctx) {
  const role = getRole(s, p.roleId);
  if (ctx.disguised.has(p.id)) return { sus: false, clue: 'common', align: 'Town', gun: false, roleName: 'Villager' };
  if (ctx.framed.has(p.id)) return { sus: true, clue: 'chaos', align: 'Mafia', gun: true, roleName: role.name };
  // Police: thumbs up only for the Mafia (Godfather and Silent Mafia included). Options below are house rules.
  const explicit = role.custom && typeof role.sus === 'boolean';
  let sus = explicit ? role.sus : p.team === 'mafia';
  if (!explicit && p.roleId === 'godfather' && s.config.godfatherInnocent) sus = false;
  if (!explicit && s.config.nkSuspicious && (p.team === 'solo' || p.team === 'vampire')) sus = p.roleId !== 'werewolf' || s.night % 2 === 0;
  let align = role.appearsTown ? 'Town' : teamLabel(p);
  return { sus, clue: role.clue, align, gun: !!role.gun || (role.abilities || []).some(a => ['kill','rampage','ignite'].includes(a.kind)), roleName: role.name };
}

/* ---------- night resolution ---------- */
function resolveNight(s0) {
  const s = clone(s0); const N = s.night; const cfg = s.config;
  const rep = { night: N, deaths: [], saves: [], messages: [], lines: [], publicNotes: [], visits: [], cancelled: [] };
  const msg = (to, text, tag = 'info', extra) => rep.messages.push(Object.assign({ to, text, tag }, extra || {}));
  const line = t => rep.lines.push(t);
  const P = id => getP(s, id);
  const nm = id => pname(s, id);
  const aliveAtStart = new Set(s.players.filter(p => p.alive).map(p => p.id));

  // 0. validate & normalize
  let acts = [];
  for (const a of s.actions) {
    if (a.key === 'mafia' || a.key === 'vampire') {
      const c = P(a.actor);
      if (!c || !c.alive || c.team !== a.key || isHidden(s, c) || !a.targets[0]) continue;
      acts.push({ key: a.key, actor: a.actor, kind: a.key === 'mafia' ? 'factionKill' : 'bite', targets: a.targets.slice(), opts: a.opts || {}, faction: a.key, live: true });
      continue;
    }
    const p = P(a.actor); if (!p || !aliveAtStart.has(p.id)) continue;
    const ab = nightAbilities(s, p).find(x => x.id === a.ab); if (!ab) continue;
    const st = abilityStatus(s, p, ab); if (!st.ok) { line(`${p.name}'s ${ab.id} was invalid: ${st.why}`); continue; }
    const k = kindOf(ab);
    if (k.target === 'self') a.targets = [p.id];
    if (k.target === 'assigned') a.targets = [p.meta.target];
    if (['other','any','two','dead','deadTown'].includes(k.target) && !a.targets.filter(Boolean).length) continue;
    acts.push({ key: a.key, actor: p.id, ab, kind: ab.kind, targets: a.targets.slice(), orig: a.targets.slice(), opts: a.opts || {}, live: true, inert: p.roleId === 'drunk' });
  }
  const WHY = { roleblocked: 'they were roleblocked', jailed: 'they were in jail', 'carried out the faction action': null };
  const cancel = (act, why) => {
    if (!act.live) return; act.live = false; act.why = why; rep.cancelled.push({ actor: act.actor, kind: act.kind, why });
    const fac = acts.find(x => x.faction && x.actor === act.actor);
    const reason = why === 'carried out the faction action' ? `they carried out the ${fac && fac.faction === 'vampire' ? 'Vampire bite' : 'Mafia kill'} instead` : (WHY[why] || why);
    const verb = act.faction ? (act.faction === 'mafia' ? 'Mafia kill' : 'Vampire bite') : ((KINDS[act.kind] || {}).verb || act.kind).toLowerCase();
    const tn = act.targets.filter(Boolean).map(nm).join(' & ');
    rep.lines.push(`${nm(act.actor)}'s ${verb}${tn ? ' on ' + tn : ''} did not happen — ${reason}.`);
  };
  const actsBy = id => acts.filter(x => x.actor === id && x.live);
  const roleOf = id => getRole(s, P(id).roleId);
  // carriers forfeit their own ability
  for (const f of acts.filter(x => x.faction)) for (const own of acts.filter(x => x.actor === f.actor && !x.faction)) cancel(own, 'carried out the faction action');

  const night = { jailed: new Set(), blocked: new Set(), defense: {}, guards: {}, framed: new Set(), disguised: new Set(), clean: {}, ambush: [], healers: {}, conv: [] };
  const grant = (id, level, src, by) => { (night.defense[id] = night.defense[id] || []).push({ level, src, by, left: src === 'heal' && cfg.healMode === 'one' ? 1 : Infinity }); };
  const attacks = [];

  // 1. detain & self-buffs
  for (const a of acts.filter(x => x.live && x.kind === 'jail' && !x.inert)) {
    const t = a.targets[0]; night.jailed.add(t); grant(t, 2, 'jail', a.actor);
    msg(t, 'You were jailed tonight. Your action was cancelled, and you were protected.', 'status');
    line(`${nm(a.actor)} jailed ${nm(t)}.`);
    if (a.opts.execute && (P(a.actor).uses.execute || 0) > 0) {
      P(a.actor).uses.execute--;
      attacks.push({ from: a.actor, to: t, level: 3, direct: false, cause: 'executed by the Jailkeeper', src: 'execute' });
      if (P(t).team === 'town') { P(a.actor).uses.execute = 0; msg(a.actor, 'You executed a Town member. You can no longer execute.', 'status'); }
    }
  }
  for (const t of night.jailed) for (const a of acts.filter(x => x.actor === t)) cancel(a, 'jailed');
  for (const a of acts.filter(x => x.live && (x.kind === 'alert' || x.kind === 'vest'))) {
    const p = P(a.actor); if (!a.inert) grant(p.id, 1, a.kind, p.id);
    line(`${p.name} ${a.kind === 'alert' ? 'went on alert' : 'wore a vest'}.`);
  }
  const alerted = new Set(acts.filter(x => x.live && x.kind === 'alert' && !x.inert).map(x => x.actor));

  // 2. transport
  for (const a of acts.filter(x => x.live && x.kind === 'transport')) {
    const [x, y] = a.targets; if (!x || !y || x === y) continue;
    if (a.inert) continue;
    if ([x, y].some(id => id !== a.actor && roleOf(id).trImmune)) { line(`Transport of ${nm(x)} and ${nm(y)} failed (immune).`); continue; }
    for (const b of acts) {
      if (b === a || !b.live || ['jail','alert','vest','ignite','spy','psychic','medium','remember','revive','seekMafia'].includes(b.kind)) continue;
      b.targets = b.targets.map(t => t === x ? y : t === y ? x : t);
    }
    msg(x, 'You were transported to another location.', 'status'); msg(y, 'You were transported to another location.', 'status');
    line(`${nm(a.actor)} swapped ${nm(x)} and ${nm(y)}.`);
  }

  // 3. control
  for (const a of acts.filter(x => x.live && x.kind === 'control')) {
    const [x, y] = a.targets; if (!x || !y) continue;
    if (a.inert) continue;
    if (night.jailed.has(x) || roleOf(x).ctrlImmune) { msg(a.actor, `Your control over ${nm(x)} failed.`, 'result'); line(`Witch control on ${nm(x)} failed.`); continue; }
    let b = acts.find(z => z.actor === x && z.live && !z.faction && z.targets.length && kindOf(z.ab).target !== 'self');
    if (!b) {
      const xp = P(x); const ab = nightAbilities(s, xp).find(q => ['other','any'].includes(kindOf(q).target) && abilityStatus(s, xp, q).ok);
      if (ab) { b = { key: x, actor: x, ab, kind: ab.kind, targets: [y], opts: {}, live: true, forced: true, inert: xp.roleId === 'drunk' }; acts.push(b); }
    } else b.targets[0] = y;
    msg(a.actor, `${nm(x)} is the ${roleOf(x).name}.${b ? ` You forced them to target ${nm(y)}.` : ' They had no ability to control.'}`, 'result');
    if (b) msg(x, 'You were controlled by a Witch.', 'status');
    line(`Witch ${nm(a.actor)} controlled ${nm(x)}${b ? ' onto ' + nm(y) : ' (no ability)'}.`);
  }

  // 4. roleblock & duel
  const block = (t, by, why) => {
    if (night.jailed.has(t)) return;
    const tr = roleOf(t);
    if (tr.rbImmune && why !== 'duel') {
      const ret = tr.retaliate && (P(t).roleId !== 'werewolf' || N % 2 === 0) ? tr.retaliate : 0;
      if (ret) { attacks.push({ from: t, to: by, level: ret, direct: true, cause: `attacked by the ${tr.name} they tried to block`, src: 'retaliate' }); line(`${nm(by)} tried to block ${nm(t)} and was attacked.`); }
      else line(`${nm(t)} is immune to ${nm(by)}'s roleblock.`);
      return;
    }
    night.blocked.add(t);
    for (const b of acts.filter(x => x.actor === t && x.live)) cancel(b, 'roleblocked');
    msg(t, 'Someone occupied your night. You were roleblocked!', 'status');
    line(`${nm(by)} roleblocked ${nm(t)}.`);
  };
  for (const a of acts.filter(x => x.live && x.kind === 'roleblock' && !x.inert)) block(a.targets[0], a.actor, 'rb');
  for (const a of acts.filter(x => x.live && x.kind === 'duel')) {
    const t = a.targets[0]; const pir = P(a.actor);
    pir.meta.lastDuel = t; pir.meta.lastDuelNight = N;
    if (night.jailed.has(t)) { msg(a.actor, `${nm(t)} was not home. No duel.`, 'result'); continue; }
    if (a.opts.won) {
      pir.meta.duelWins = (pir.meta.duelWins || 0) + 1;
      block(t, a.actor, 'duel');
      attacks.push({ from: a.actor, to: t, level: 2, direct: true, cause: 'plundered by the Pirate', src: 'plunder' });
      msg(a.actor, `You won the duel against ${nm(t)} (${pir.meta.duelWins}/2).`, 'result'); line(`Pirate ${pir.name} won the duel against ${nm(t)}.`);
    } else { msg(a.actor, `You lost the duel against ${nm(t)}.`, 'result'); msg(t, 'A Pirate challenged you to a duel — and lost.', 'status'); line(`Pirate ${pir.name} lost the duel against ${nm(t)}.`); }
  }
  // backup carrier
  for (const f of ['mafia', 'vampire']) {
    const fa = acts.find(x => x.faction === f);
    if (!fa || fa.live || !cfg.mafiaBackup) continue;
    const alt = s.players.find(p => p.alive && p.team === f && !isHidden(s, p) && p.id !== fa.actor && !night.jailed.has(p.id) && !night.blocked.has(p.id));
    if (alt) { fa.actor = alt.id; fa.live = true; fa.why = ''; for (const own of acts.filter(x => x.actor === alt.id && !x.faction)) cancel(own, 'carried out the faction action'); line(`${alt.name} carried out the ${f} action instead.`); }
  }

  // 5. support & manipulation (poison/frames first, heals last so heals cure poison)
  for (const a of acts.filter(x => x.live && kindOf(x.ab || {}).prio === 5 && !['heal','guard','shield'].includes(x.kind))) {
    const t = a.targets[0]; if (a.inert) continue;
    const tp = P(t); if (!tp) continue;
    switch (a.kind) {
      case 'frame': night.framed.add(t); line(`${nm(a.actor)} framed ${nm(t)}.`); break;
      case 'disguise': night.disguised.add(t); line(`${nm(a.actor)} disguised ${nm(t)}.`); break;
      case 'clean': night.clean[t] = a.actor; line(`${nm(a.actor)} prepared to clean ${nm(t)}.`); break;
      case 'douse': if (tp.roleId !== 'arsonist') { tp.fx.doused = true; line(`${nm(a.actor)} doused ${nm(t)}.`); } break;
      case 'poison': if (tp.alive) { tp.fx.poison = { night: N + 1, by: a.actor }; msg(t, 'You feel sick. You have been poisoned!', 'status'); line(`${nm(a.actor)} poisoned ${nm(t)}.`); } break;
      case 'blackmail': tp.fx.blackmailed = N; msg(t, 'You were blackmailed. You may not speak tomorrow.', 'status'); line(`${nm(a.actor)} blackmailed ${nm(t)}.`); break;
      case 'silence': tp.fx.silenced = N; msg(t, 'You were silenced. You may not vote tomorrow.', 'status'); line(`${nm(a.actor)} silenced ${nm(t)}.`); break;
      case 'hypnotize': msg(t, a.opts.msg || HYPNO_MSGS[0], 'status'); line(`${nm(a.actor)} hypnotized ${nm(t)}: "${a.opts.msg || HYPNO_MSGS[0]}".`); break;
      case 'ambush': night.ambush.push({ by: a.actor, at: t }); line(`${nm(a.actor)} lay in wait at ${nm(t)}'s house.`); break;
      case 'lovers': {
        const [x, y] = a.targets; if (!x || !y || x === y) break;
        P(x).fx.lover = y; P(y).fx.lover = x; P(a.actor).uses[a.ab.id] = 0;
        msg(x, `You are in love with ${nm(y)}. If one of you dies, so does the other.`, 'status'); msg(y, `You are in love with ${nm(x)}. If one of you dies, so does the other.`, 'status');
        line(`Cupid bound ${nm(x)} and ${nm(y)} as lovers.`); break;
      }
    }
  }
  for (const a of acts.filter(x => x.live && ['heal','guard','shield'].includes(x.kind))) {
    const t = a.targets[0]; const tp = P(t); if (!tp || a.inert) continue;
    if (a.kind === 'heal') {
      if (tp.fx.revealed && tp.roleId === 'mayor' && t !== a.actor) { line(`${nm(a.actor)} could not heal the revealed Mayor.`); continue; }
      if (t === a.actor) P(a.actor).meta.selfHeals = (P(a.actor).meta.selfHeals || 0) + 1;
      grant(t, 2, 'heal', a.actor); (night.healers[t] = night.healers[t] || []).push(a.actor);
      if (tp.fx.poison) { delete tp.fx.poison; msg(t, 'A Doctor cured your poison.', 'status'); line(`${nm(a.actor)} cured ${nm(t)}'s poison.`); }
      line(`${nm(a.actor)} healed ${nm(t)}.`);
    } else if (a.kind === 'guard') { (night.guards[t] = night.guards[t] || []).push(a.actor); line(`${nm(a.actor)} guarded ${nm(t)}.`); }
    else { grant(t, 2, 'shield', a.actor); if (tp.fx.poison) delete tp.fx.poison; line(`Guardian Angel ${nm(a.actor)} shielded ${nm(t)}.`); }
  }

  // visits
  const visits = [];
  for (const a of acts.filter(x => x.live)) {
    const vis = a.faction ? true : kindOf(a.ab).visits;
    if (!vis) continue;
    const ts = a.kind === 'control' ? [a.targets[0]] : a.targets;
    for (const t of ts) if (t && t !== a.actor && P(t)) visits.push({ from: a.actor, to: t, kind: a.kind });
  }
  rep.visits = visits;
  const visitorsOf = id => [...new Set(visits.filter(v => v.to === id).map(v => v.from))];
  for (const p of s.players.filter(p => p.alive && p.roleId === 'arsonist')) for (const v of visitorsOf(p.id)) if (P(v).roleId !== 'arsonist') P(v).fx.doused = true;

  // 6. attacks
  for (const a of acts.filter(x => x.live)) {
    if (a.inert) continue;
    if (a.kind === 'factionKill') {
      const c = P(a.actor); let level = 1;
      if (a.opts.strong && c.roleId === 'strongman' && (c.uses.strong || 0) > 0) { level = 3; c.uses.strong--; }
      attacks.push({ from: a.actor, to: a.targets[0], level, direct: true, cause: 'killed by the Mafia', src: 'mafia', faction: 'mafia' });
    } else if (a.kind === 'bite') {
      const t = P(a.targets[0]); const vamps = s.players.filter(p => p.alive && p.team === 'vampire').length;
      if (['town','neutral'].includes(t.team) && vamps < cfg.convertCap) night.conv.push({ type: 'bite', by: a.actor, to: t.id });
      else attacks.push({ from: a.actor, to: t.id, level: 1, direct: true, cause: 'bitten by a Vampire', src: 'bite' });
    } else if (a.kind === 'kill') {
      const r = roleOf(a.actor);
      attacks.push({ from: a.actor, to: a.targets[0], level: a.ab.attack || 1, direct: true, cause: `killed by the ${r.name}`, src: a.ab.vig ? 'vig' : 'kill' });
    } else if (a.kind === 'rampage') {
      const t = a.targets[0];
      if (t !== a.actor) attacks.push({ from: a.actor, to: t, level: 2, direct: true, cause: 'mauled by the Werewolf', src: 'rampage' });
      for (const v of visitorsOf(t)) if (v !== a.actor) attacks.push({ from: a.actor, to: v, level: 2, direct: false, cause: 'mauled by the Werewolf', src: 'rampage' });
      line(`Werewolf ${nm(a.actor)} rampaged at ${nm(t)}'s house.`);
    } else if (a.kind === 'ignite') {
      const burn = s.players.filter(p => p.alive && p.fx.doused && p.id !== a.actor);
      for (const p of burn) attacks.push({ from: a.actor, to: p.id, level: 3, direct: false, cause: 'burned by the Arsonist', src: 'ignite' });
      line(`Arsonist ${nm(a.actor)} ignited ${burn.length} doused player(s).`);
    }
  }
  for (const v of alerted) for (const vis of visitorsOf(v)) attacks.push({ from: v, to: vis, level: 2, direct: false, cause: 'shot by the Veteran', src: 'veteran' });
  for (const am of night.ambush) {
    const victim = visitorsOf(am.at).filter(v => v !== am.by && (P(v).team !== 'mafia' || isHidden(s, P(v)))).sort((x, y) => s.players.findIndex(p => p.id === x) - s.players.findIndex(p => p.id === y))[0];
    if (victim) attacks.push({ from: am.by, to: victim, level: 1, direct: false, cause: 'ambushed by the Mafia', src: 'ambush' });
  }
  for (const sc of s.scheduled.filter(x => x.night === N)) attacks.push({ from: sc.source || null, to: sc.target, level: 3, direct: false, cause: sc.cause, src: sc.type });
  s.scheduled = s.scheduled.filter(x => x.night !== N);
  for (const p of s.players.filter(p => p.alive && p.fx.poison && p.fx.poison.night === N)) { attacks.push({ from: p.fx.poison.by, to: p.id, level: 3, direct: false, cause: 'poisoned', src: 'poison' }); delete p.fx.poison; }

  const died = new Map(); const usedGuard = new Set(); const vigKills = [];
  const queue = attacks.slice();
  let guardSafety = 0;
  while (queue.length && guardSafety++ < 500) {
    const a = queue.shift(); const T = P(a.to);
    if (!T || !aliveAtStart.has(T.id)) continue;
    if (died.has(T.id)) { const d = died.get(T.id); if (a.from && !d.killers.includes(a.from)) d.killers.push(a.from); d.causes.push(a.cause); continue; }
    if (a.direct && !a.noIntercept) {
      const g = (night.guards[T.id] || []).find(b => !usedGuard.has(b) && b !== a.from);
      if (g) {
        usedGuard.add(g);
        queue.push({ from: a.from, to: g, level: a.level, direct: false, noIntercept: true, cause: a.cause.replace(/^(\w+)/, '$1') + ' while guarding', src: a.src });
        if (a.from) queue.push({ from: g, to: a.from, level: 2, direct: false, noIntercept: true, cause: 'killed by a Bodyguard', src: 'bodyguard' });
        msg(T.id, 'You were attacked, but a Bodyguard fought them off!', 'status');
        rep.saves.push({ target: T.id, by: g, how: 'bodyguard', attacker: a.from, cause: a.cause });
        line(`Bodyguard ${nm(g)} intercepted the attack on ${T.name}.`);
        continue;
      }
    }
    const base = Math.max(roleOf(T.id).def || 0, T.roleId === 'executioner' ? 1 : 0);
    const granted = (night.defense[T.id] || []).filter(d => d.left > 0);
    const best = Math.max(base, ...granted.map(d => d.level), 0);
    if (a.level > best) {
      died.set(T.id, { killers: a.from ? [a.from] : [], causes: [a.cause], src: a.src });
      if (a.src === 'vig' && T.team === 'town') vigKills.push(a.from);
      line(`${T.name} was ${a.cause}.`);
    } else {
      let how = 'defense', by = null;
      if (base >= a.level) { how = 'defense'; msg(T.id, 'Someone attacked you, but your defense was too strong.', 'status'); }
      else {
        const src = granted.filter(d => d.level >= a.level).sort((x, y) => (x.left === Infinity) - (y.left === Infinity))[0];
        if (src) { if (src.left !== Infinity) src.left--; how = src.src; by = src.by; }
        if (how === 'heal') { msg(T.id, 'You were attacked, but someone nursed you back to health!', 'status'); if (cfg.doctorNotified) msg(by, `Your target ${T.name} was attacked tonight — and you saved them.`, 'result'); }
        else if (how === 'jail') msg(T.id, 'You were attacked in jail, but survived.', 'status');
        else if (how === 'shield') msg(T.id, 'You were attacked, but your Guardian Angel protected you!', 'status');
        else msg(T.id, 'Someone attacked you, but your defense was too strong.', 'status');
      }
      if (a.from && ['mafia','kill','vig','bite'].includes(a.src)) msg(a.from, `Your target ${T.name} survived the attack.`, 'result');
      rep.saves.push({ target: T.id, by, how, attacker: a.from, cause: a.cause });
      line(`${T.name} survived an attack (${a.cause}) — ${how === 'defense' ? 'their own defense' : how}${by ? ' by ' + nm(by) : ''}.`);
    }
  }

  // 7. information (delivered even if the investigator died tonight)
  const ctx = night;
  const rndName = () => { const al = s.players.filter(p => p.alive); return al.length ? pick(al).name : 'nobody'; };
  for (const a of acts.filter(x => x.live && kindOf(x.ab || {}).info)) {
    const t = a.targets[0]; const tp = t ? P(t) : null; const me = a.actor;
    // the player is told about the one they pointed at; a Transporter or Witch can swap who was really checked
    const shownId = a.orig && a.orig[0] && P(a.orig[0]) && kindOf(a.ab).target !== 'dead' ? a.orig[0] : t;
    const shown = { name: shownId ? nm(shownId) : '' }; const det = { about: t, pointed: shownId };
    const say = text => msg(me, text, 'result', det);
    if (a.inert) {
      const prevRng = _rng; let h = 2166136261; for (const ch of `${N}|${me}|${t}|${a.kind}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } _rng = seeded(h || 7);
      const fakes = {
        checkSus: () => _rng() < 0.5 ? `Thumbs up — ${shown.name} is Mafia.` : `Thumbs down — ${shown.name} is not Mafia.`,
        clue: () => { const c = pick(Object.keys(CLUE_NAMES)); return `${shown.name} could be: ${rolesInClue(s, c).join(', ')}.`; },
        checkGun: () => `${shown.name} ${_rng() < 0.5 ? 'carries a weapon' : 'is unarmed'}.`,
        track: () => `${shown.name} visited ${_rng() < 0.5 ? rndName() : 'nobody'}.`,
        watch: () => `${_rng() < 0.5 ? rndName() : 'Nobody'} visited ${shown.name}.`,
        count: () => `${shown.name} received ${rnd(3)} visitor(s).`,
      };
      say((fakes[a.kind] || (() => 'You learned nothing useful.'))());
      _rng = prevRng;
      continue;
    }
    switch (a.kind) {
      case 'checkSus': { const ap = appearance(s, tp, ctx); say(ap.sus ? `Thumbs up — ${shown.name} is Mafia.` : `Thumbs down — ${shown.name} is not Mafia.`); break; }
      case 'clue': { const ap = appearance(s, tp, ctx); say(`${shown.name} could be: ${rolesInClue(s, ap.clue).join(', ')}.`); break; }
      case 'checkRole': { const ap = appearance(s, tp, ctx); say(`${shown.name} is the ${ap.roleName}.`); break; }
      case 'checkAlign': { const ap = appearance(s, tp, ctx); say(`${shown.name} belongs to the ${ap.align}.`); break; }
      case 'checkGun': { const ap = appearance(s, tp, ctx); say(`${shown.name} ${ap.gun ? 'carries a weapon' : 'is unarmed'}.`); break; }
      case 'track': { const went = [...new Set(visits.filter(v => v.from === t).map(v => nm(v.to)))]; say(went.length ? `${shown.name} visited ${went.join(', ')}.` : `${shown.name} stayed home.`); break; }
      case 'watch': { const who = visitorsOf(t).filter(v => v !== me).map(nm); say(who.length ? `${shown.name} was visited by ${who.join(', ')}.` : `Nobody visited ${shown.name}.`); break; }
      case 'count': { const n = visitorsOf(t).filter(v => v !== me).length; const out = visits.some(v => v.from === t); say(`${shown.name} received ${n} visitor${n === 1 ? '' : 's'} and ${out ? 'went out' : 'stayed home'}.`); break; }
      case 'spy': { const mv = [...new Set(visits.filter(v => P(v.from).team === 'mafia' && !isHidden(s, P(v.from))).map(v => nm(v.to)))]; msg(me, mv.length ? `The Mafia visited ${mv.join(', ')}.` : 'The Mafia visited nobody.', 'result'); break; }
      case 'seekMafia': { const yes = tp.team === 'mafia'; msg(me, yes ? `Thumbs up: ${tp.name} is Mafia.` : `No thumbs up for ${tp.name}.`, 'result'); break; }
      case 'medium': { msg(me, `${tp.name} was the ${getRole(s, tp.roleId).name}.`, 'result'); break; }
      case 'oracle': { P(me).meta.oracleMark = t; msg(me, `You marked ${tp.name}.`, 'result'); break; }
      case 'psychic': {
        const pool = s.players.filter(p => p.alive && p.id !== me);
        if (N % 2 === 1) {
          const evil = pool.filter(p => isEvil(s, p));
          if (pool.length < 3 || !evil.length) { msg(me, 'Your vision was clouded tonight.', 'result'); break; }
          const e = pick(evil); const rest = shuffle(pool.filter(p => p.id !== e.id)).slice(0, 2);
          msg(me, `At least one of ${shuffle([e, ...rest]).map(p => p.name).join(', ')} is evil.`, 'result');
        } else {
          const good = pool.filter(p => p.team === 'town');
          if (pool.length < 2 || !good.length) { msg(me, 'Your vision was clouded tonight.', 'result'); break; }
          const g = pick(good); const o = pick(pool.filter(p => p.id !== g.id));
          msg(me, `At least one of ${shuffle([g, o]).map(p => p.name).join(', ')} is good.`, 'result');
        }
        break;
      }
    }
  }

  // death records (with Janitor cleaning)
  const deathList = [];
  for (const [id, d] of died) {
    const jan = night.clean[id];
    const cleaned = !!(jan && P(jan).alive !== undefined && (P(jan).uses.clean || 0) > 0);
    if (cleaned) { P(jan).uses.clean--; msg(jan, `You cleaned ${nm(id)}'s body. They were the ${roleOf(id).name}.`, 'result'); }
    deathList.push({ id, cause: d.causes[0], causes: d.causes, killers: d.killers, cleaned });
  }

  // 8. transformations (only on players who survived and had no defense tonight)
  const defended = id => (night.defense[id] || []).length > 0 || (roleOf(id).def || 0) > 0 || night.jailed.has(id);
  for (const a of acts.filter(x => x.live && kindOf(x.ab || {}).prio === 8 && !x.inert)) {
    const t = a.targets[0]; const tp = P(t);
    if (a.kind === 'recruit') {
      const cult = s.players.filter(p => p.alive && p.team === 'cult').length;
      if (died.has(t) || defended(t) || !['town','neutral'].includes(tp.team) || cult >= cfg.convertCap) { msg(a.actor, `${tp.name} resisted your recruitment.`, 'result'); line(`Recruitment of ${tp.name} failed.`); continue; }
      setRole(s, tp, 'cultist'); tp.meta.joined = N;
      msg(t, 'You have been recruited into the Cult. Wake with the Cult from now on.', 'status'); msg(a.actor, `${tp.name} joined the Cult.`, 'result');
      line(`${tp.name} was recruited into the Cult.`); log(s, 'convert', `${tp.name} was recruited into the Cult.`, { secret: true });
    } else if (a.kind === 'remember') {
      if (!tp || tp.alive) continue;
      const nr = getRole(s, tp.roleId === 'drunk' ? 'villager' : tp.roleId); const me = P(a.actor); // a dead Drunk had nothing real to remember
      setRole(s, me, nr.id); me.team = nr.team;
      if (nr.id === 'executioner') { const c = s.players.filter(q => q.alive && q.team === 'town' && q.id !== me.id); me.meta.target = c.length ? pick(c).id : null; }
      if (nr.id === 'guardian') { const c = s.players.filter(q => q.alive && q.id !== me.id); me.meta.target = c.length ? pick(c).id : null; }
      msg(a.actor, `You remembered that you were like the ${nr.name}. You are now the ${nr.name}.`, 'status');
      if (cfg.announceAmnesiac) rep.publicNotes.push(`An Amnesiac remembered that they were like the ${nr.name}.`);
      line(`Amnesiac ${me.name} became the ${nr.name}.`);
    } else if (a.kind === 'revive') {
      if (!tp || tp.alive) continue;
      tp.alive = true; tp.fx.revived = N; delete tp.fx.poison; delete tp.fx.doused; tp.diedAt = null;
      rep.publicNotes.push(`${tp.name} has been raised from the dead!`);
      msg(t, 'You have been revived by the Priest.', 'status'); line(`Priest ${nm(a.actor)} revived ${tp.name}.`);
      log(s, 'revive', `${tp.name} was revived by the Priest.`);
    }
  }
  for (const c of night.conv) {
    const tp = P(c.to);
    if (died.has(c.to)) continue;
    if (defended(c.to)) { msg(c.by, `${tp.name} resisted your bite.`, 'result'); line(`Bite on ${tp.name} failed (protected).`); continue; }
    setRole(s, tp, 'vampire'); tp.meta.joined = N;
    msg(c.to, 'You were bitten and turned into a Vampire. Wake with the Vampires from now on.', 'status');
    line(`${tp.name} became a Vampire.`); log(s, 'convert', `${tp.name} was turned into a Vampire.`, { secret: true });
  }

  // spend limited uses for every action that was actually performed
  for (const a of acts) {
    if (!a.live || a.inert || a.faction || !a.ab || ['clean', 'lovers'].includes(a.kind)) continue;
    const u = P(a.actor).uses; if (typeof u[a.ab.id] === 'number') u[a.ab.id] = Math.max(0, u[a.ab.id] - 1);
  }

  // 9. deaths & triggers (phase flips to dawn only after everything tonight is logged under Night N)
  const tag = 'N' + N;
  const out = processDeaths(s, deathList, tag, rep);
  for (const v of vigKills) {
    const vp = P(v);
    if (cfg.vigTown === 'guilt' && vp.alive) { s.scheduled.push({ night: N + 1, type: 'guilt', target: v, source: v, cause: 'died of guilt' }); msg(v, 'You killed a Town member. Guilt will overcome you tomorrow night.', 'status'); }
    else if (cfg.vigTown === 'lose') { vp.uses.shoot = 0; msg(v, 'You killed a Town member. You put your gun down for good.', 'status'); }
  }
  rep.deaths = out;
  for (const m of rep.messages) log(s, 'result', `${nm(m.to)}: ${m.text}`, { secret: true, to: m.to });
  for (const l of rep.lines) log(s, 'resolve', l, { secret: true });
  for (const d of out) log(s, 'death', `${nm(d.id)} died (${d.cause}).`);
  for (const n of rep.publicNotes) log(s, 'public', n);
  log(s, 'phase', `Night ${N} resolved: ${out.length ? out.map(d => nm(d.id)).join(', ') + ' died' : 'nobody died'}.`);
  s.reports[N] = rep;
  s.actions = [];
  s.phase = 'dawn'; s.day = N;
  afterChange(s);
  return s;
}

/* ---------- death processing & triggers ---------- */
function publicRoleOf(s, rec) { if (rec.cleaned) return null; if (!s.config.revealOnDeath) return null; return getRole(s, rec.role).name; }
function processDeaths(s, list, tag, rep) {
  const q = list.slice(); const out = [];
  let safety = 0;
  while (q.length && safety++ < 200) {
    const d = q.shift(); const p = getP(s, d.id);
    if (!p || !p.alive) continue;
    const dying = new Set(q.map(x => x.id));
    p.alive = false; p.diedAt = tag;
    const rec = { id: p.id, ph: tag, cause: d.cause, killers: d.killers || [], role: p.roleId, team: p.team, cleaned: !!d.cleaned, execution: !!d.execution, triggers: [] };
    rec.publicRole = publicRoleOf(s, rec);
    s.deaths.push(rec); out.push(rec);
    if (p.fx.lover) { const l = getP(s, p.fx.lover); if (l && l.alive) { q.push({ id: l.id, cause: 'died of heartbreak', killers: [] }); rec.triggers.push('heartbreak'); } }
    if (p.roleId === 'hunter' && !p.meta.hunterUsed) { p.meta.hunterUsed = true; s.pending.push({ id: uid('q'), type: 'hunter', actor: p.id }); rec.triggers.push('hunter'); }
    if (p.roleId === 'oracle' && p.meta.oracleMark) {
      const m = getP(s, p.meta.oracleMark);
      if (m) { const note = `The Oracle's last vision: ${m.name} is the ${getRole(s, m.roleId).name}.`; s.publicNotes.push({ ph: tag, text: note }); if (rep) rep.publicNotes.push(note); rec.triggers.push('oracle'); }
    }
    if (p.roleId === 'godfather' && s.config.promote) {
      const mf = s.players.find(x => x.alive && !dying.has(x.id) && x.team === 'mafia' && x.roleId === 'mafioso') || s.players.find(x => x.alive && !dying.has(x.id) && x.team === 'mafia' && x.roleId === 'mafia');
      if (mf) { setRole(s, mf, 'godfather', { keepTeam: true, keepMeta: true }); log(s, 'promote', `${mf.name} was promoted to Godfather.`, { secret: true }); if (rep) rep.messages.push({ to: mf.id, text: 'The Godfather is dead. You are the new Godfather.', tag: 'status' }); rec.triggers.push('promotion'); }
    }
    if (p.roleId === 'cultleader') {
      const heir = s.players.filter(x => x.alive && !dying.has(x.id) && x.team === 'cult').sort((a, b) => (a.meta.joined || 0) - (b.meta.joined || 0))[0];
      if (heir) { setRole(s, heir, 'cultleader', { keepTeam: true, keepMeta: true }); log(s, 'promote', `${heir.name} now leads the Cult.`, { secret: true }); if (rep) rep.messages.push({ to: heir.id, text: 'The Cult Leader is dead. You now lead the Cult.', tag: 'status' }); rec.triggers.push('succession'); }
    }
    for (const e of s.players.filter(x => x.alive && !dying.has(x.id) && x.roleId === 'executioner' && x.meta.target === p.id && !x.meta.won)) {
      if (d.execution) continue;
      const to = s.config.exeFallback === 'survivor' ? 'survivor' : 'jester';
      setRole(s, e, to); e.team = 'neutral';
      log(s, 'convert', `${e.name}'s target died — the Executioner became a ${getRole(s, to).name}.`, { secret: true });
      if (rep) rep.messages.push({ to: e.id, text: `Your target died. You are now a ${getRole(s, to).name}.`, tag: 'status' });
      rec.triggers.push('executioner');
    }
    for (const g of s.players.filter(x => x.alive && !dying.has(x.id) && x.roleId === 'guardian' && x.meta.target === p.id)) {
      setRole(s, g, 'survivor'); g.team = 'neutral';
      log(s, 'convert', `${g.name}'s ward died — the Guardian Angel became a Survivor.`, { secret: true });
      if (rep) rep.messages.push({ to: g.id, text: 'Your ward died. You are now a Survivor.', tag: 'status' });
    }
  }
  return out;
}

/* ---------- manual overrides ---------- */
function manualKill(s, id, cause = 'removed by the Game Master') { const tag = phaseTag(s); const out = processDeaths(s, [{ id, cause, killers: [] }], tag); log(s, 'override', `Game Master killed ${pname(s, id)} (${cause}).`); afterChange(s); return out; }
function manualRevive(s, id) { const p = getP(s, id); if (!p || p.alive) return; p.alive = true; p.fx.revived = s.night; p.diedAt = null; log(s, 'override', `Game Master revived ${p.name}.`); afterChange(s); }
function manualSetRole(s, id, roleId, team) { const p = getP(s, id); setRole(s, p, roleId); if (team) p.team = team; log(s, 'override', `Game Master changed ${p.name} to ${getRole(s, roleId).name} (${teamLabel(p)}).`, { secret: true }); afterChange(s); }

/* ---------- phases ---------- */
function startGame(s) { s.startedAt = Date.now(); s.phase = 'reveal-done'; log(s, 'phase', `Game started with ${s.players.length} players.`); startNight(s); return s; }
function startNight(s) {
  s.night += 1; s.phase = 'night'; s.actions = []; s.dayState = null;
  for (const p of s.players) { if (p.fx.blackmailed !== undefined && p.fx.blackmailed < s.night) delete p.fx.blackmailed; if (p.fx.silenced !== undefined && p.fx.silenced < s.night) delete p.fx.silenced; }
  log(s, 'phase', `Night ${s.night} begins.`);
  return s;
}
function startDay(s) {
  s.phase = 'day'; s.day = s.night;
  s.dayState = { nominees: [], votes: {}, open: false, round: 1, done: false, result: null, startedAt: Date.now() };
  log(s, 'phase', `Day ${s.day} begins.`);
  afterChange(s);
  return s;
}
function endDay(s) {
  if (s.showdown && s.day >= s.showdown.endsAfterDay) {
    const w = evaluateWin(s, { ignoreShowdown: true }); s.showdown = null;
    if (w.status === 'over') { s.winPrompt = w; log(s, 'phase', 'The showdown is over.'); return s; }
  }
  startNight(s); return s;
}
function isSilenced(s, p) { return p.fx.silenced === s.day && s.phase === 'day'; }
function isBlackmailed(s, p) { return p.fx.blackmailed === s.day && s.phase === 'day'; }

/* ---------- prompts (Hunter, Jester haunt) ---------- */
function promptChoices(s, q) {
  if (q.type === 'hunter') return s.players.filter(p => p.alive && p.id !== q.actor).map(p => p.id);
  if (q.type === 'haunt') return (q.choices || []).filter(id => getP(s, id) && getP(s, id).alive);
  return [];
}
function resolvePrompt(s, qid, target) {
  const q = s.pending.find(x => x.id === qid); if (!q) return s;
  s.pending = s.pending.filter(x => x.id !== qid);
  if (!target) { log(s, 'prompt', `${pname(s, q.actor)}'s ${q.type === 'hunter' ? 'last shot' : 'haunt'} was skipped.`); afterChange(s); return s; }
  if (q.type === 'hunter') {
    processDeaths(s, [{ id: target, cause: 'shot by the Hunter', killers: [q.actor] }], phaseTag(s));
    log(s, 'death', `The Hunter ${pname(s, q.actor)} took ${pname(s, target)} down with them.`);
  } else if (q.type === 'haunt') {
    const nightNo = (s.phase === 'night' ? s.night : s.day) + 1;
    s.scheduled.push({ night: nightNo, type: 'haunt', target, source: q.actor, cause: 'haunted by the Jester' });
    log(s, 'prompt', `The Jester will haunt ${pname(s, target)} on Night ${nightNo}.`, { secret: true });
  }
  afterChange(s); return s;
}

/* ---------- day abilities ---------- */
function mayorReveal(s, id) {
  const p = getP(s, id); if (!p || !p.alive || p.roleId !== 'mayor' || p.fx.revealed) return s;
  p.fx.revealed = true; p.uses.reveal = 0;
  s.publicNotes.push({ ph: phaseTag(s), text: `${p.name} has revealed themselves as the Mayor!` });
  log(s, 'public', `${p.name} revealed as the Mayor. Their vote now counts ${s.config.mayorWeight}.`);
  return s;
}
function guessStatus(s, p) {
  if (!p.alive) return { ok: false, why: 'Dead' };
  if ((p.uses.guess || 0) <= 0) return { ok: false, why: 'No shots left' };
  if (p.meta.lastGuessDay === s.day) return { ok: false, why: 'Already guessed today' };
  if (s.phase !== 'day') return { ok: false, why: 'Only during the day' };
  return { ok: true };
}
function guess(s, actorId, targetId, roleId) {
  const a = getP(s, actorId), t = getP(s, targetId);
  const st = guessStatus(s, a); if (!st.ok || !t || !t.alive) return { error: st.why || 'Invalid target' };
  a.uses.guess--; a.meta.lastGuessDay = s.day;
  const correct = t.roleId === roleId;
  if (correct) {
    processDeaths(s, [{ id: t.id, cause: 'shot by a Guesser', killers: [a.id] }], phaseTag(s));
    log(s, 'death', `${a.name} guessed ${t.name} as ${getRole(s, roleId).name} — correct. ${t.name} was shot.`);
  } else {
    log(s, 'action', `${a.name} guessed ${t.name} as ${getRole(s, roleId).name} — wrong.`);
    if (s.config.guessWrong === 'die') processDeaths(s, [{ id: a.id, cause: 'misfired a guess', killers: [] }], phaseTag(s));
    else if (s.config.guessWrong === 'lose') a.uses.guess = 0;
  }
  afterChange(s); return { correct };
}

/* ---------- voting ---------- */
function voteWeight(s, p) { return p.roleId === 'mayor' && p.fx.revealed ? s.config.mayorWeight : 1; }
function canVote(s, p) { return p.alive && !isSilenced(s, p); }
function openVote(s, nominees) {
  const ds = s.dayState; ds.nominees = nominees.filter(id => getP(s, id) && getP(s, id).alive); ds.votes = {}; ds.open = true;
  log(s, 'vote', `Voting opened (round ${ds.round}) on ${ds.nominees.map(id => pname(s, id)).join(', ')}.`);
  return s;
}
function castVote(s, voter, target) {
  const ds = s.dayState; const p = getP(s, voter);
  if (!ds || !ds.open || !p || !canVote(s, p)) return s;
  if (target === null || ds.votes[voter] === target) delete ds.votes[voter]; else ds.votes[voter] = target;
  return s;
}
function tally(s) {
  const ds = s.dayState; const cfg = s.config; const totals = {};
  for (const n of ds.nominees) totals[n] = 0;
  if (cfg.allowSkip) totals.skip = 0;
  const eligible = s.players.filter(p => canVote(s, p));
  let totalW = 0, cast = 0;
  for (const p of eligible) { const w = voteWeight(s, p); totalW += w; const v = ds.votes[p.id]; if (v !== undefined && totals[v] !== undefined) { totals[v] += w; cast += w; } }
  const vals = Object.values(totals); const max = vals.length ? Math.max(...vals) : 0;
  const leaders = Object.keys(totals).filter(k => totals[k] === max && max > 0);
  let result;
  if (!ds.nominees.length) result = { type: 'none', reason: 'No one was nominated.' };
  else if (!max) result = { type: 'none', reason: 'No votes were cast.' };
  else if (cfg.voteThreshold === 'majority' && max * 2 <= totalW) result = { type: 'none', reason: `No majority — needed more than ${totalW / 2} of ${totalW} votes.` };
  else if (leaders.length === 1) result = leaders[0] === 'skip' ? { type: 'none', reason: 'The town chose not to execute anyone.' } : { type: 'execute', target: leaders[0] };
  else if (cfg.voteTie === 'revote') result = { type: 'revote', tied: leaders };
  else if (cfg.voteTie === 'random') result = { type: 'random', tied: leaders };
  else result = { type: 'none', reason: 'Tie — nobody is executed.' };
  return { totals, result, totalW, cast, eligible: eligible.map(p => p.id) };
}
function confirmVote(s) {
  const ds = s.dayState; const t = tally(s); let res = t.result;
  s.votes.push({ day: s.day, round: ds.round, votes: clone(ds.votes), totals: t.totals, result: res });
  if (res.type === 'revote') {
    ds.round++; ds.nominees = res.tied.filter(x => x !== 'skip'); ds.votes = {};
    log(s, 'vote', `Tie between ${res.tied.map(x => x === 'skip' ? 'no execution' : pname(s, x)).join(' and ')} — revote.`);
    if (!ds.nominees.length) { ds.open = false; ds.done = true; ds.result = { type: 'none', reason: 'Tie on no execution.' }; }
    return s;
  }
  if (res.type === 'random') { const c = pick(res.tied); res = c === 'skip' ? { type: 'none', reason: 'Random tie-break chose no execution.' } : { type: 'execute', target: c, random: true }; }
  ds.open = false; ds.done = true; ds.result = res;
  if (res.type === 'execute') {
    const voters = Object.keys(ds.votes).filter(v => ds.votes[v] === res.target);
    executePlayer(s, res.target, voters);
  } else log(s, 'vote', res.reason);
  afterChange(s); return s;
}
function executePlayer(s, target, voters) {
  const p = getP(s, target); s.executions++;
  for (const pol of s.players.filter(x => x.roleId === 'politician')) if (s.dayState && s.dayState.votes[pol.id] === target) pol.meta.polWith = (pol.meta.polWith || 0) + 1;
  if (p.roleId === 'prince' && !p.fx.princeSaved) {
    p.fx.princeSaved = true; p.fx.revealed = true;
    s.publicNotes.push({ ph: phaseTag(s), text: `${p.name} is the Prince — royal blood spares them this once.` });
    log(s, 'vote', `${p.name} was voted out but survived: they are the Prince.`); s.dayState.result.spared = true; return;
  }
  if (p.roleId === 'jester') {
    p.meta.won = true; log(s, 'win', `${p.name} the Jester was executed — the Jester wins!`);
    if (s.config.jesterHaunt) { const choices = voters.filter(v => v !== p.id); if (choices.length) s.pending.push({ id: uid('q'), type: 'haunt', actor: p.id, choices }); }
  }
  for (const e of s.players.filter(x => x.roleId === 'executioner' && x.meta.target === target && !x.meta.won)) { e.meta.won = true; log(s, 'win', `${e.name} the Executioner got their target executed.`, { secret: true }); }
  processDeaths(s, [{ id: target, cause: 'executed by the town', killers: voters, execution: true }], phaseTag(s));
  log(s, 'death', `${p.name} was executed by the town.`);
}
function skipVote(s) { const ds = s.dayState; ds.open = false; ds.done = true; ds.result = { type: 'none', reason: 'No vote was held.' }; log(s, 'vote', 'The day ended without a vote.'); afterChange(s); return s; }

/* ---------- win engine ---------- */
function factionKey(p) { return p.team === 'solo' ? 'solo:' + p.id : p.team; }
function factionName(s, key) {
  if (!key) return '';
  if (key === 'draw') return 'Nobody';
  if (key.startsWith('solo:')) { const p = getP(s, key.slice(5)); return p ? `${p.name} the ${getRole(s, p.roleId).name}` : 'A solo killer'; }
  return { town: 'The Town', mafia: 'The Mafia', cult: 'The Cult', vampire: 'The Vampires', neutral: 'Neutrals' }[key] || key;
}
function evaluateWin(s, opt = {}) {
  const alive = s.players.filter(p => p.alive);
  const realMafia = alive.some(p => p.team === 'mafia' && !isHidden(s, p));
  const keys = alive.map(p => (p.team === 'mafia' && isHidden(s, p) && !realMafia) ? 'neutral' : factionKey(p));
  const blockers = [...new Set(keys.filter(k => k !== 'neutral'))];
  let faction = null, reason = '';
  if (!blockers.length) { faction = 'draw'; reason = alive.length ? 'Only independent players remain.' : 'Everyone is dead.'; }
  else if (blockers.length === 1) { faction = blockers[0]; reason = `${factionName(s, faction)} ${faction === 'town' ? 'eliminated every threat' : 'is the last faction standing'}.`; }
  else if (s.config.parity) {
    const killing = blockers.filter(k => k !== 'town');
    if (killing.length === 1) { const F = killing[0]; const fc = keys.filter(k => k === F).length; if (fc >= alive.length - fc) { faction = F; reason = `${factionName(s, F)} reached parity and controls the vote.`; } }
  }
  if (!faction) return { status: 'ongoing', blockers };
  const pending = alive.filter(p => (p.roleId === 'jester' && !p.meta.won) || (p.roleId === 'executioner' && !p.meta.won && p.meta.target && getP(s, p.meta.target) && getP(s, p.meta.target).alive)).map(p => p.id);
  if (s.config.showdown && pending.length && !opt.ignoreShowdown && faction !== 'draw' && alive.length >= 3) return { status: 'showdown', faction, pending, reason };
  return { status: 'over', faction, reason, winners: computeWinners(s, faction) };
}
function computeWinners(s, faction) {
  const out = []; const ex = s.executions;
  for (const p of s.players) {
    const why = [];
    if (faction !== 'draw' && factionKey(p) === faction) why.push(factionName(s, faction));
    const r = p.roleId;
    if (r === 'jester' && p.meta.won) why.push('Executed as the Jester');
    if (r === 'executioner' && p.meta.won) why.push('Target executed');
    if (r === 'survivor' && p.alive) why.push('Survived');
    if (r === 'guardian' && p.meta.target && getP(s, p.meta.target) && getP(s, p.meta.target).alive) why.push('Ward survived');
    if (r === 'witch' && p.alive && faction !== 'town') why.push('Town lost');
    if (r === 'politician' && p.alive && (ex === 0 || (p.meta.polWith || 0) * 2 >= ex)) why.push('Backed the winning votes');
    if (r === 'pirate' && (p.meta.duelWins || 0) >= 2) why.push('Won two duels');
    const role = getRole(s, r); if (role && role.custom && role.win === 'survivor' && p.alive) why.push('Survived');
    if (why.length) out.push({ id: p.id, why: why.join(' · ') });
  }
  return out;
}
const winKey = w => w ? w.faction + '|' + (w.winners || []).length : '';
function afterChange(s) {
  if (['ended', 'setup', 'reveal'].includes(s.phase)) return;
  const w = evaluateWin(s); s.lastWin = w;
  if (w.status === 'ongoing') {
    if (s.showdown) { s.showdown = null; log(s, 'phase', 'Showdown cancelled — the game is open again.'); }
    s.winPrompt = null; return;
  }
  if (w.status === 'showdown') {
    if (!s.showdown) {
      const endsAfterDay = s.phase === 'day' && s.dayState && s.dayState.done ? s.day + 1 : s.phase === 'night' ? s.night : s.day;
      s.showdown = { faction: w.faction, endsAfterDay, pending: w.pending };
      log(s, 'phase', `Showdown: ${factionName(s, w.faction)} has secured the win, but ${w.pending.map(id => pname(s, id)).join(', ')} can still win. Play continues until the end of Day ${endsAfterDay}.`);
    } else s.showdown.pending = w.pending;
    s.winPrompt = null; return;
  }
  if (s.winDismissed !== winKey(w) + '|' + s.players.filter(p => p.alive).length) s.winPrompt = w;
}
function stalemate(s) {
  const k = s.config.stalemateCycles; if (!k || ['setup', 'reveal', 'ended'].includes(s.phase)) return null;
  if (evaluateWin(s).status !== 'ongoing') return null;
  const last = s.deaths.length ? parseInt(String(s.deaths[s.deaths.length - 1].ph).slice(1), 10) || 0 : 0;
  const since = Math.max(last, s.stalemateAck || 0);
  const quiet = s.night - since;
  return quiet >= k ? { quietNights: quiet, since: last } : null;
}
function ackStalemate(s) { s.stalemateAck = s.night; log(s, 'override', 'Game Master chose to play on through a stalemate.'); return s; }
function dismissWin(s) { const w = s.winPrompt; if (!w) return s; s.winDismissed = winKey(w) + '|' + s.players.filter(p => p.alive).length; s.winPrompt = null; log(s, 'override', `Game Master kept playing despite: ${factionName(s, w.faction)} wins.`); return s; }
function endGame(s, w) {
  w = w || evaluateWin(s, { ignoreShowdown: true });
  if (w.status !== 'over') { const f = 'draw'; w = { status: 'over', faction: f, reason: 'The Game Master ended the game.', winners: computeWinners(s, f) }; }
  s.phase = 'ended'; s.endedAt = Date.now(); s.winPrompt = null; s.showdown = null;
  s.result = { faction: w.faction, factionName: factionName(s, w.faction), reason: w.reason, winners: w.winners };
  log(s, 'win', `${s.result.factionName} ${w.faction === 'draw' ? 'wins — no faction prevailed' : 'win'}. ${w.reason}`);
  return s;
}

/* ---------- live answer preview (what the God signals at night) ---------- */
// Everything that can change an information result (jail, transport, control, roleblock, frame, disguise)
// wakes before the information roles, so a dry run with the actions recorded so far gives the real answer.
function previewResult(s0, act) {
  const s = clone(s0); setAction(s, act); const prev = _rng; _rng = seeded(97);
  try {
    const r = resolveNight(s); const rep = r.reports[s0.night] || { messages: [], cancelled: [] };
    const blocked = rep.cancelled.find(c => c.actor === act.actor);
    const res = rep.messages.filter(m => m.to === act.actor && m.tag === 'result');
    return { messages: res.map(m => m.text), about: res[0] ? res[0].about : null, pointed: res[0] ? res[0].pointed : null, blocked: blocked ? blocked.why : null };
  } finally { _rng = prev; }
}

/* ---------- restart ---------- */
// mode 'same': same players and dealt roles, back to Night 1 · 'reshuffle': same role list, new secret roles · 'setup': same players, roles cleared
function restartGame(old, mode) {
  const s = newGame();
  s.config = clone(old.config); s.customRoles = clone(old.customRoles || {});
  Object.assign(s.setup, { style: old.setup.style, pool: clone(old.setup.pool), poolTouched: !!old.setup.poolTouched, seed: old.setup.seed || 1, targetN: old.players.length, disabled: (old.setup.disabled || []).slice() });
  for (const p of old.players) s.players.push({ id: p.id, name: p.name, color: p.color, roleId: null, team: null, alive: true, fx: {}, uses: {}, meta: {}, lock: false });
  // the roles actually dealt are the source of truth for every restart
  if (old.initialRoles && old.initialRoles.length === old.players.length) { const pool = {}; for (const ir of old.initialRoles) pool[ir.roleId] = (pool[ir.roleId] || 0) + 1; s.setup.pool = pool; }
  if (mode === 'reshuffle' && poolList(s.setup.pool).length !== s.players.length) throw new Error('The role list no longer matches the players. Use Back to setup instead.');
  if (mode === 'same') {
    const init = old.players.length && old.initialRoles && old.initialRoles.length === old.players.length ? old.initialRoles : null;
    if (!init) throw new Error('This game has no dealt roles to replay.');
    for (const ir of init) { const p = getP(s, ir.id); p.roleId = ir.roleId; }
    for (const p of s.players) setRole(s, p, p.roleId);
    for (const ir of init) { const p = getP(s, ir.id); p.team = ir.team; if (ir.target && getP(s, ir.target)) p.meta.target = ir.target; if (ir.fake) p.meta.fake = ir.fake; }
    s.initialRoles = clone(init); s.setup.dealt = true; s.setup.revealed = true;
    log(s, 'phase', 'Game restarted with the same players and roles.');
    startGame(s);
  } else if (mode === 'reshuffle') {
    assignRoles(s); s.setup.dealt = true; s.setup.revealed = false;
    log(s, 'phase', 'Game restarted: roles reshuffled.');
  } else log(s, 'phase', 'Back to setup with the same players.');
  return s;
}

/* ---------- safe views ---------- */
function describeAbility(s, p, ab) {
  const k = kindOf(ab); const u = p && p.uses ? p.uses[ab.id] : undefined;
  let txt = k.verb || ab.kind; if (k.day) txt += ' (day)';
  if (ab.nights === 'first') txt += ' · Night 1 only'; if (ab.nights === 'even') txt += ' · full-moon nights'; if (ab.nights === 'notFirst' && !s.config.vigNight1) txt += ' · from Night 2';
  if (typeof u === 'number') txt += ` · ${u} left`;
  return txt;
}
// Everything a player may legitimately see on their own card. Nothing else.
function playerCard(s, pid) {
  const p = getP(s, pid); if (!p) return null;
  const fake = p.roleId === 'drunk' ? getRole(s, p.meta.fake) : null;
  const r = fake || getRole(s, p.roleId);
  const team = fake ? 'town' : p.team;
  const card = { name: p.name, color: p.color, roleName: r.name, icon: r.icon, team, teamName: TEAM_INFO[team] ? TEAM_INFO[team].name : 'Neutral', short: r.short, desc: r.desc, winText: r.winText,
    abilities: (r.abilities || []).filter(a => !a.viaFaction || true).map(a => describeAbility(s, fake ? { uses: initUses(s, r) } : p, a)), teammates: [], target: null, lover: null };
  const knows = r.hiddenMember ? null : r.knows || (['mafia', 'cult', 'vampire'].includes(team) ? team : null);
  if (!fake && knows) {
    const mates = knows === 'twin' ? s.players.filter(q => q.id !== p.id && q.roleId === 'twin') : s.players.filter(q => q.id !== p.id && q.team === team && !isHidden(s, q));
    card.teammates = mates.map(q => ({ name: q.name, role: knows === 'twin' ? 'Twin' : getRole(s, q.roleId).name, alive: q.alive }));
  }
  if (!fake && p.meta.target && ['executioner', 'guardian'].includes(p.roleId)) { const t = getP(s, p.meta.target); card.target = t ? t.name : null; }
  if (p.fx.lover) card.lover = pname(s, p.fx.lover);
  return card;
}
const PUBLIC_CAUSE = c => c ? c.replace(/ while guarding$/, '') : '';
function dawnAnnouncement(s, N) {
  const rep = s.reports[N]; if (!rep) return { deaths: [], notes: [] };
  return {
    deaths: rep.deaths.map(d => ({ name: pname(s, d.id), role: d.publicRole, cleaned: d.cleaned, cause: s.config.showCause ? PUBLIC_CAUSE(d.cause) : null })),
    notes: rep.publicNotes.slice(),
  };
}

/* ---------- statistics ---------- */
function stats(s) {
  const killsBy = {}, savesBy = {}, targeted = {}, infoBy = {};
  let saves = 0, investigations = 0;
  for (const rep of Object.values(s.reports)) {
    for (const sv of rep.saves) { saves++; if (sv.by) savesBy[sv.by] = (savesBy[sv.by] || 0) + 1; }
    for (const v of rep.visits) targeted[v.to] = (targeted[v.to] || 0) + 1;
    for (const m of rep.messages) if (m.tag === 'result') { investigations++; infoBy[m.to] = (infoBy[m.to] || 0) + 1; }
  }
  for (const d of s.deaths) for (const k of d.killers) if (!d.execution) killsBy[k] = (killsBy[k] || 0) + 1;
  const initTeam = id => ((s.initialRoles || []).find(x => x.id === id) || {}).team;
  const top = obj => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1])[0]; return e ? { id: e[0], name: pname(s, e[0]), n: e[1] } : null; };
  const winners = new Set(((s.result && s.result.winners) || []).map(w => w.id));
  const score = id => (killsBy[id] || 0) * 3 + (savesBy[id] || 0) * 3 + (infoBy[id] || 0) + (getP(s, id).alive ? 2 : 0);
  const pool = s.players.filter(p => winners.has(p.id)); const mvp = (pool.length ? pool : s.players).slice().sort((a, b) => score(b.id) - score(a.id))[0];
  return {
    nights: s.night, days: s.day, deaths: s.deaths.length, executions: s.executions,
    mafiaKills: s.deaths.filter(d => d.cause === 'killed by the Mafia').length,
    townKills: s.deaths.filter(d => !d.execution && d.killers.some(k => initTeam(k) === 'town')).length,
    saves, investigations, voteRounds: s.votes.length,
    mostTargeted: top(targeted), mostKills: top(killsBy), mvp: mvp ? { id: mvp.id, name: mvp.name, score: score(mvp.id) } : null,
    duration: s.startedAt ? ((s.endedAt || Date.now()) - s.startedAt) : 0,
  };
}

/* ---------- custom roles ---------- */
function makeCustomRole(d) {
  const id = 'c_' + String(d.name || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) + (d.idSuffix || '');
  const abilities = [];
  if (d.kind && d.kind !== 'none') {
    const ab = { id: 'act', kind: d.kind };
    if (d.uses > 0) ab.uses = d.uses | 0;
    if (d.kind === 'kill') ab.attack = Math.max(1, Math.min(3, d.attack | 0 || 1));
    if (d.nights && d.nights !== 'all') ab.nights = d.nights;
    abilities.push(ab);
  }
  const team = ['town', 'mafia', 'solo', 'neutral'].includes(d.team) ? d.team : 'town';
  const sideW = { town: 2, mafia: -6.5, solo: -7, neutral: 0 }[team];
  return R(id, String(d.name || 'Custom role').slice(0, 28), team, {
    custom: true, icon: d.icon || 'star', tags: d.tags || [], short: d.short || d.desc || '', desc: d.desc || '', def: Math.max(0, Math.min(3, d.def | 0)), rbImmune: !!d.rbImmune,
    sus: d.sus === undefined ? undefined : !!d.sus, clue: d.clue || 'common', gun: d.kind === 'kill', w: typeof d.w === 'number' ? d.w : sideW, wake: 80, abilities,
    knows: team === 'mafia' ? 'mafia' : null, win: d.win || team, winText: d.winText || WIN_TEXT[team] || (d.win === 'survivor' ? 'Be alive when the game ends.' : ''),
  });
}
function addCustomRole(s, def) { const r = def.id ? def : makeCustomRole(def); s.customRoles[r.id] = r; return r; }

/* ---------- export ---------- */
function historyText(s) {
  const lines = [`OMERTÀ — game log`, `Players: ${s.players.map(p => `${p.name} (${getRole(s, p.roleId) ? getRole(s, p.roleId).name : '?'})`).join(', ')}`, ''];
  let ph = '';
  for (const e of s.events) { if (e.ph !== ph) { ph = e.ph; lines.push('', ph === 'Setup' ? 'SETUP' : (ph[0] === 'N' ? 'NIGHT ' : 'DAY ') + ph.slice(1)); } const d = new Date(e.t); lines.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} — ${e.text}`); }
  if (s.result) lines.push('', `RESULT: ${s.result.factionName} — ${s.result.reason}`, 'Winners: ' + s.result.winners.map(w => pname(s, w.id)).join(', '));
  return lines.join('\n');
}

const Engine = {
  KINDS, CUSTOM_KINDS, TEAM_INFO, CLUE_NAMES, LIB, LIBMAP, DEFAULT_CONFIG, HYPNO_MSGS, STYLES, STYLE_NAMES, COLORS,
  clone, uid, shuffle, seeded, setRng, getRole, allRoles, kindOf, rolesInClue, newGame, addPlayer, getP, pname, setRole, poolList,
  assignRoles, finalizeAssignment, balanceOf, recommend, seats, nightSteps, nightAbilities, dayAbilities, abilityStatus, legalTargets,
  defaultCarrier, setAction, clearAction, resolveNight, processDeaths, manualKill, manualRevive, manualSetRole, startGame, startNight,
  startDay, endDay, isSilenced, isBlackmailed, promptChoices, resolvePrompt, mayorReveal, guessStatus, guess, voteWeight, canVote,
  openVote, castVote, tally, confirmVote, skipVote, evaluateWin, computeWinners, afterChange, dismissWin, endGame, factionKey,
  factionName, teamLabel, playerCard, dawnAnnouncement, stats, makeCustomRole, addCustomRole, historyText, describeAbility, effRole,
  phaseTag, log, isEvil, appearance, isHidden, setupWarnings, stalemate, ackStalemate, restartGame, describeAction, previewResult,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
