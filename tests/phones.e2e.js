// Optional browser test (needs: npm i puppeteer-core @sparticuz/chromium). Run from the project root: node tests/phones.e2e.js
// End-to-end: God phone + three player phones (separate browser contexts) against the local server.
const chromium = require('@sparticuz/chromium'); const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const PORT = 3456, BASE = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0; const fails = [];
const ok = (c, m) => c ? pass++ : fails.push(m);

(async () => {
  const server = spawn('node', [require('path').join(__dirname, '..', 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  await sleep(700);
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process', '--no-zygote'].includes(a)), headless: true });
  const phone = async (w = 375) => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: w, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs; return p; };
  const text = p => p.evaluate(() => (document.querySelector('#app') || document.body).innerText.replace(/\s+/g, ' '));
  const waitText = async (p, needle, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await text(p)).includes(needle)) return true; await sleep(250); } return false; };
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const hold = async (p, which) => { await p.evaluate(w => { const el = document.querySelector(`[data-hold="${w}"]`); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, which); await sleep(700); };
  try {
    // ---- God sets up a 6-player game and hosts a room
    const god = await phone();
    await god.goto(BASE + '/', { waitUntil: 'load' });
    await god.evaluate(() => { localStorage.clear(); });
    await god.reload({ waitUntil: 'load' }); await sleep(400);
    await god.evaluate(() => {
      const s = Engine.newGame(); const roles = { Priya: 'police', Rahul: 'godfather', Aman: 'villager', Neha: 'doctor', Kabir: 'mafia', Isha: 'jester' };
      for (const [n, r] of Object.entries(roles)) Engine.addPlayer(s, n).roleId = r;
      Engine.finalizeAssignment(s); s.setup.dealt = true; A.s = s; A.hist = []; Object.assign(A.ui, { view: 'command', setupStep: 4 }); save(); render();
    });
    ok(await god.evaluate(() => Online.avail === true), 'God page detects the online server');
    await god.evaluate(() => H['online-host']());
    await sleep(1200);
    const code = await god.evaluate(() => Online.room && Online.room.code);
    ok(/^[A-Z]{5}$/.test(code || ''), 'room created with a 5-letter code');
    ok(await god.evaluate(() => !!document.querySelector('.qr svg')), 'QR code shown to the God');
    const ids = await god.evaluate(() => Object.fromEntries(A.s.players.map(p => [p.name, p.id])));

    // ---- three players join on their own phones
    const ph = {};
    for (const name of ['Priya', 'Rahul', 'Aman']) {
      const p = await phone(name === 'Aman' ? 320 : 375); ph[name] = p;
      await p.goto(`${BASE}/play?room=${code}`, { waitUntil: 'load' });
      ok(await waitText(p, 'Who are you?'), `${name}: sees the name list from the QR link`);
      await p.evaluate(id => document.querySelector(`[data-a="pick"][data-v="${id}"]`).click(), ids[name]);
      ok(await waitText(p, `Are you ${name}?`), `${name}: confirm step`);
      await p.evaluate(() => document.querySelector('[data-a="claim"]').click());
      ok(await waitText(p, 'Your role is ready'), `${name}: joined, role ready`);
      ok(!(await overflow(p)), `${name}: no sideways scroll`);
    }
    const intruder = await phone();
    await intruder.goto(`${BASE}/play?room=${code}`, { waitUntil: 'load' }); await waitText(intruder, 'Who are you?');
    ok(await intruder.evaluate(id => document.querySelector(`[data-a="pick"][data-v="${id}"]`).disabled, ids.Priya), 'a claimed name cannot be picked on another phone');

    // ---- private role cards: each phone sees only its own
    for (const [name, role] of [['Priya', 'Police'], ['Rahul', 'Godfather'], ['Aman', 'Villager']]) {
      ok(!(await text(ph[name])).includes(role), `${name}: role hidden until held`);
      await hold(ph[name], 'card');
      ok(await waitText(ph[name], `you are the ${role}`), `${name}: sees own role (${role}) after holding`);
    }
    ok((await text(ph.Rahul)).includes('Kabir'), 'Godfather sees Mafia teammate');
    ok(!(await text(ph.Aman)).includes('Your allies'), 'Villager sees no allies');
    const leak = await ph.Priya.evaluate(async () => { const me = JSON.parse(localStorage.getItem('omerta.player.v1')); const r = await fetch(`/api/room?action=view&code=${me.code}&seat=${me.seat}&token=${me.token}`); return await r.text(); });
    const lj = JSON.parse(leak); const roleNames = [...leak.matchAll(/"roleName":"([^"]+)"/g)].map(m => m[1]);
    ok(roleNames.join() === 'Police' && lj.publicView.players.every(p => p.role === null) && !/Jester|Doctor|Villager|"team":"mafia"/.test(leak), "Priya's raw server response contains only her own role");
    const steal = await ph.Priya.evaluate(async rid => { const me = JSON.parse(localStorage.getItem('omerta.player.v1')); const r = await fetch(`/api/room?action=view&code=${me.code}&seat=${rid}&token=${me.token}`); return r.status; }, ids.Rahul);
    ok(steal === 403, "Priya's token cannot read Rahul's slice (403)");
    await god.evaluate(() => Online.refresh()); await sleep(300);
    ok(await god.evaluate(() => (Online.status.seats || []).filter(s => s.claimed).length) === 3, 'God sees 3 joined');
    ok(await god.evaluate(() => (Online.status.seats || []).filter(s => s.seen).length) === 3, 'God sees 3 have seen their roles');
    ok((await text(god)).includes('3 of 6 have seen their role'), 'reveal step shows phone progress');

    // ---- Night 1: God records actions; Mafia kills Aman; Priya (Police) checks Rahul
    await god.evaluate(() => { H['start-game'](); dispatch('ov-close'); });
    ok(await waitText(ph.Priya, 'Night 1'), 'phones switch to Night 1');
    await god.evaluate(ids => {
      Engine.setAction(A.s, { key: 'mafia', actor: ids.Kabir, ab: 'factionKill', targets: [ids.Aman] });
      Engine.setAction(A.s, { key: ids.Priya, actor: ids.Priya, ab: 'inv', targets: [ids.Rahul] });
      save(); H['resolve-ask'](); H['confirm-ok']();
    }, ids);
    ok(await god.evaluate(() => A.s.phase) === 'dawn', 'God at dawn');
    await sleep(3500);
    ok((await text(ph.Aman)).includes('Night 1') && !(await text(ph.Aman)).includes("You're out"), 'at dawn, phones do not yet know who died');
    ok(!(await text(ph.Priya)).includes('Your private results'), 'at dawn, results not yet delivered');

    // ---- Day 1: announcement, results, out-screen
    await god.evaluate(() => { H['ann-format']('full'); H['start-day'](); dispatch('ov-close'); });
    ok(await waitText(ph.Priya, 'Day 1'), 'phones switch to Day 1');
    ok(await waitText(ph.Priya, 'Aman') && (await text(ph.Priya)).includes('was the Villager'), 'announcement with role on phones');
    ok(await waitText(ph.Aman, "You're out"), 'dead player told to stay silent');
    ok((await text(ph.Priya)).includes('Your private results'), 'result arrives at day start');
    await hold(ph.Priya, 'results');
    ok(await waitText(ph.Priya, 'Rahul is NOT suspicious'), 'Police reads private result (Godfather looks innocent)');
    ok(!(await text(ph.Rahul)).includes('NOT suspicious'), "Rahul's phone never sees Priya's result");

    // ---- voting from phones
    await god.evaluate(ids => { H['nom-toggle'](ids.Kabir); H['nom-toggle'](ids.Isha); H['vote-open'](); }, ids);
    ok(await waitText(ph.Priya, 'Vote'), 'vote appears on phones');
    ok(await waitText(ph.Rahul, 'Vote'), 'vote appears on the second phone');
    ok(await waitText(ph.Aman, 'You are out, so you cannot vote'), 'dead player cannot vote');
    await ph.Priya.evaluate(id => document.querySelector(`[data-a="vote"][data-v="${id}"]`).click(), ids.Kabir);
    await ph.Rahul.evaluate(id => document.querySelector(`[data-a="vote"][data-v="${id}"]`).click(), ids.Isha);
    await sleep(3800);
    const votes = await god.evaluate(() => A.s.dayState.votes);
    ok(votes[ids.Priya] === ids.Kabir && votes[ids.Rahul] === ids.Isha, 'phone votes land in the God tally');
    await ph.Rahul.evaluate(id => document.querySelector(`[data-a="vote"][data-v="${id}"]`).click(), ids.Kabir); // change of mind
    await sleep(3800);
    ok(await god.evaluate(id => A.s.dayState.votes[id], ids.Rahul) === ids.Kabir, 'changed phone vote updates the God tally');
    await god.evaluate(ids => { H['vote-nominee'](ids.Kabir); for (const n of ['Neha', 'Isha']) H['vote-cast'](ids[n]); H['vote-confirm'](); H['confirm-ok'](); }, ids);
    ok(await god.evaluate(id => !Engine.getP(A.s, id).alive, ids.Kabir), 'Kabir executed with mixed phone + hand votes');
    ok(await waitText(ph.Priya, 'Kabir was executed'), 'vote result shown on phones');
    ok(!(await overflow(ph.Priya)) && !(await overflow(ph.Aman)), 'day screens fit 375px and 320px');
    

    // ---- seat reset + game over
    await god.evaluate(id => Online.resetSeat(id), ids.Aman);
    ok(await waitText(ph.Aman, 'reset your seat', 9000), 'reset seat kicks that phone back to join');
    await god.evaluate(() => { Engine.endGame(A.s); save(); render(); });
    ok(await waitText(ph.Priya, 'The game is over') && (await text(ph.Priya)).includes('Godfather'), 'game over reveals every role on phones');
    await god.evaluate(() => { A.ui.view = 'command'; A.s.phase = 'setup'; A.ui.setupStep = 0; render(); });
    for (const [n, p] of Object.entries(Object.assign({ God: god }, ph))) ok(!p.errs.length, `${n}: no page errors ${p.errs.join(' | ')}`);
  } catch (e) { fails.push('THREW: ' + e.stack); }
  await browser.close(); server.kill();
  console.log(`${pass} passed, ${fails.length} failed`); if (fails.length) { console.log(' - ' + fails.join('\n - ')); process.exit(1); }
})();
