// Token Launch Radar page: renders window.RADAR (data.js, written by main.ts
// inside this directory) with no network and no framework. The farm-plan
// templates below mirror lib/model.ts word for word, so the plan a reader
// sees is the plan board.json carries, totals included.
'use strict';
const R = window.RADAR;
const M = R.meta;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct1 = (n) => (n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const ageFmt = (d) => (d < 0 ? '—' : d >= 730 ? (d / 365.25).toFixed(1) + ' yr' : d >= 30 ? Math.round(d / 30.44) + ' mo' : d + ' d');
const catName = (i) => (R.cats[i] === null ? 'No category named' : R.cats[i]);

// Row fields: [slug, name, cat, chain, nChains, tvlK, chg, age, impliedK, oddsK, oddsN, flags, reason, deposit]
const rows = R.rows.map((r, i) => ({
  rank: i + 1, slug: r[0], name: r[1], cat: r[2], chain: r[3], nch: r[4], tvl: r[5] * 1000,
  chg: r[6], age: r[7], implied: r[8] * 1000, ok: r[9], on: r[10],
  wl: (r[11] & 1) === 1, flagged: (r[11] & 2) === 2, reason: r[12], deposit: r[13],
}));
const oddsPct = (r) => Math.round(100 * ((r.ok + 8 * (M.priced / M.scanned)) / (r.on + 8)));

// ---- farm plans, mirrored from lib/model.ts ----
function gasFor(n) { return n >= 5 ? 6 : n >= 2 ? 4 : 3; }
function weeksFor(age) { if (age < 0) return 6; if (age < 180) return 8; if (age < 365) return 6; return 4; }
function actionsFor(cat, name, chain) {
  const c = (cat || '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [`Supply USDC to ${name} on ${chain} and leave the position open`, `Borrow a small amount against the position on ${name}, then repay it inside the same week`];
  if (c.includes('dex')) return [`Provide USDC liquidity to ${name}'s main pool on ${chain}`, `Swap a small amount through ${name} on ${chain} so the wallet trades as well as provides`];
  if (c.includes('bridge')) return [`Bridge USDC to ${chain} through ${name}`, `Use the bridged USDC in one app on ${chain}, then bridge a small amount back`];
  if (c.includes('staking') || c.includes('restak')) return [`Stake the chain's staking asset through ${name} on ${chain} and keep the receipt token`, `Claim the staking rewards on ${name} once they accrue`];
  if (c.includes('derivative') || c.includes('option') || c.includes('perpetual')) return [`Deposit USDC as margin on ${name} and open one small hedged position`, `Close and reopen the hedge on ${name} once, so the wallet shows two-sided activity`];
  if (c.includes('launchpad')) return [`Register the wallet for ${name}'s next sale round on ${chain}`, `Take a small allocation in one ${name} sale and hold what it issues`];
  if (c.includes('prediction')) return [`Fund the wallet and place one market position on ${name}`, `Settle or roll the position on ${name} when its market closes`];
  if (c.includes('insurance')) return [`Buy cover from ${name} on ${chain} for the farmed position`, `Renew the ${name} cover once before it lapses`];
  if (c.includes('rwa')) return [`Mint ${name}'s yield asset on ${chain} and hold it in the wallet`, `Redeem a small part of the ${name} position once, then mint it back`];
  return [`Deposit USDC into ${name} on ${chain} and keep the position open`, `Make one more deposit into ${name} of a tenth the size, a week after the first`];
}
function farmPlan(r) {
  const chain = r.chain || 'its main chain';
  const deposit = r.deposit, gas = gasFor(r.nch), weeks = weeksFor(r.age), hold = weeks * 7;
  const [first, second] = actionsFor(catName(r.cat) === 'No category named' ? null : catName(r.cat), r.name, chain);
  const cash = 3 + gas + 2 + weeks * 2 + gas;
  const minutes = 80 + weeks * 10;
  const verdict = cash <= 25 ? 'Lean' : cash <= 60 ? 'Fair' : 'Heavy';
  const steps = [
    `Set up a fresh wallet for ${r.name} and fund it with the deposit plus gas money, keeping the seed phrase offline. Cost: about $3 of gas to fund. Time: 10 minutes.`,
    `${first}. Cost: $${deposit} of capital and about $${gas} of gas. Time: 20 minutes to set up.`,
    `${second}. Cost: about $2 of gas. Time: 15 minutes.`,
    `Repeat one qualifying action on ${r.name} every week for ${weeks} weeks, so the wallet appears in more than one weekly snapshot. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without withdrawing, so the activity spans the full qualifying window. Cost: the $${deposit} stays in the position. Time: ${hold} days.`,
    `Check ${r.name}'s own points or rewards page and claim only from the link the protocol itself publishes. Cost: nothing to check, and never pay anyone to claim. Time: 10 minutes.`,
    `Write the wallet, dates and transactions in a farm log, then decide from the log whether to unwind or roll the position. Cost: about $${gas} of gas to exit. Time: 15 minutes.`,
  ];
  return { steps, totals: { deposit, cash, minutes, weeks, hold, verdict } };
}

// ---- header ----
$('asof').textContent = R.as_of;
$('kpis').innerHTML = [
  [M.scanned, 'protocols scanned'], [M.ranked, 'ranked: records no token'], [M.trading, 'already trading, set aside'],
  [M.watchlist + '/' + M.watchlist, 'watchlist covered'], [M.winner, 'tournament winner'],
  ['×' + M.winner_cv_x + ' / ×' + M.winner_wf_x, 'held-out error, CV / walk-forward'],
].map(([b, s], i) => `<div class="kpi${i >= 4 ? ' hot' : ''}"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');

// ---- board ----
const catSel = $('cat');
catSel.innerHTML = '<option value="all">All categories</option>' + R.cats.map((c, i) => `<option value="${i}">${esc(c === null ? 'No category named' : c)}</option>`).join('');
let sortKey = 'rank', sortDir = 1;
function shown() {
  const q = $('q').value.trim().toLowerCase();
  const cat = catSel.value, scr = $('screen').value, wl = $('watchonly').checked;
  let list = rows.filter((r) =>
    (cat === 'all' || r.cat === Number(cat)) &&
    (scr === 'all' || (scr === 'pass') !== r.flagged) &&
    (!wl || r.wl) &&
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)));
  const key = { rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), cat: (r) => catName(r.cat), tvl: (r) => r.tvl, chg: (r) => (r.chg === null ? -1e9 : r.chg), age: (r) => r.age, implied: (r) => r.implied, odds: (r) => oddsPct(r) }[sortKey];
  list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.rank - b.rank) * sortDir);
  return list;
}
function renderBoard() {
  const list = shown();
  $('count').textContent = list.length + ' of ' + rows.length + ' rows';
  $('rows').innerHTML = list.map((r) => `<tr data-slug="${esc(r.slug)}">
    <td class="num">${r.rank}</td>
    <td><span class="name">${esc(r.name)}</span> ${r.wl ? '<span class="chip wl">watchlist</span>' : ''}<br><span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(catName(r.cat))}</td>
    <td class="num">${money(r.tvl)}</td>
    <td class="num ${r.chg === null ? '' : r.chg >= 0 ? 'up' : 'down'}">${pct1(r.chg)}</td>
    <td class="num">${ageFmt(r.age)}</td>
    <td class="num"><b>${money(r.implied)}</b></td>
    <td class="num">${oddsPct(r)}%</td>
    <td>${r.flagged ? '<span class="chip flag">flagged</span>' : '<span class="chip ok">passes</span>'}</td></tr>`).join('');
  for (const tr of $('rows').children) tr.addEventListener('click', () => openDetail(tr.dataset.slug));
}
document.querySelectorAll('#board th').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.k; if (!k) return;
  if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' || k === 'cat' ? 1 : -1; }
  renderBoard();
}));
['q', 'cat', 'screen', 'watchonly'].forEach((id) => $(id).addEventListener('input', renderBoard));

// ---- detail ----
function components(r) {
  const lt = Math.log10(Math.max(1, r.tvl));
  const lin = (ab) => Math.pow(10, ab[0] + ab[1] * lt);
  const C = M.components;
  let b = 0; while (b < C.bucket_edges.length && lt > C.bucket_edges[b]) b++;
  const n = C.bucket_counts[b] || 0, w = n / (n + 6);
  const bucket = Math.pow(10, lt + (w * C.bucket_ratios[b] + (1 - w) * C.bucket_global));
  const vals = [lin(C.power), lin(C.winsor), bucket].sort((a, c) => a - c);
  return { power: lin(C.power), winsor: lin(C.winsor), bucket, median: vals[1] };
}
function show(view) {
  for (const v of ['board', 'detail', 'method', 'trading', 'accounted']) $('view-' + v).hidden = v !== view;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo(0, 0);
}
function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  const lo = Math.max(1, Math.round(r.implied * M.band[0])), hi = Math.round(r.implied * M.band[1]);
  const comp = components(r);
  const plan = farmPlan(r);
  const bMin = Math.log10(lo * 0.4), bMax = Math.log10(hi * 2.5);
  const pos = (v) => ((Math.log10(v) - bMin) / (bMax - bMin) * 100).toFixed(1) + '%';
  const screenTxt = r.wl ? 'On the snapshot watchlist: it passed the house rule in full, TVL floor included.' :
    r.flagged ? 'Flagged by the house product screen: ' + esc(R.reasons[r.reason - 1]) + '. The row stays on the board; the flag is information, not a deletion.' :
    'Passes the house product screen (the field guide’s clauses), though its TVL sits below the watchlist floor or the list otherwise left it out.';
  $('detail').innerHTML = `
    <div class="dhead"><h2>${esc(r.name)}</h2><span class="chip">rank ${r.rank} of ${rows.length}</span>
    ${r.wl ? '<span class="chip wl">watchlist</span>' : ''}<span class="chip">${esc(catName(r.cat))}</span></div>
    <p>${esc(r.slug)} · first chain ${esc(r.chain || '—')}${r.nch > 1 ? ' · ' + r.nch + ' chains' : ''} · records no token on DefiLlama's record as of ${R.as_of}.</p>
    <div class="stats">
      <div class="stat"><b>${money(r.implied)}</b><span>implied value</span></div>
      <div class="stat"><b>${money(r.tvl)}</b><span>TVL</span></div>
      <div class="stat"><b>${pct1(r.chg)}</b><span>TVL change, 7d</span></div>
      <div class="stat"><b>${ageFmt(r.age)}</b><span>tracked for</span></div>
      <div class="stat"><b>${oddsPct(r)}%</b><span>peer token odds</span></div>
      <div class="stat"><b>${money(lo)} – ${money(hi)}</b><span>model band</span></div>
    </div>
    <div class="panel"><h3>The band, on a log scale</h3>
      <div class="bandbar"><div class="bandfill" style="left:${pos(lo)};width:${(parseFloat(pos(hi)) - parseFloat(pos(lo))).toFixed(1)}%"></div><div class="bandmark" style="left:${pos(r.implied)}"></div></div>
      <div class="bandlab"><span>${money(lo)}</span><span>implied ${money(r.implied)}</span><span>${money(hi)}</span></div>
      <p>The band is the winning model's own cross-validation middle half (×${M.band[0]} to ×${M.band[1]}): half of its held-out predictions on protocols that already trade landed inside a band this wide. Treat the point value as the middle of a range, never as a price.</p>
    </div>
    <div class="panel"><h3>How the number is worked out</h3>
      <p>The board's value comes from the tournament winner, <b>${esc(M.winner)}</b> (held-out ×${M.winner_cv_x} cross-validation, ×${M.winner_wf_x} walk-forward). As a cross-check, the ensemble's three components priced from this row's TVL alone:</p>
      <table class="mini"><tbody>
        <tr><td>Power law in TVL</td><td class="num">${money(comp.power)}</td></tr>
        <tr><td>Winsorized-ratio power law</td><td class="num">${money(comp.winsor)}</td></tr>
        <tr><td>TVL-bucket median ratio</td><td class="num">${money(comp.bucket)}</td></tr>
        <tr><td><b>Median of the three</b></td><td class="num"><b>${money(comp.median)}</b></td></tr>
      </tbody></table>
      <p>Peer odds: ${r.ok} of ${r.on} ${esc(catName(r.cat))} protocols tracked at least as long already record a token — ${oddsPct(r)}% after shrinking toward the snapshot's global rate of ${M.global_odds_pct}%.</p>
      <p>${screenTxt}</p>
    </div>
    <div class="panel"><h3>Farm plan</h3>
      <ol class="plan">${plan.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="totals">Totals: deposit ${money(plan.totals.deposit)} · cash besides deposit ${money(plan.totals.cash)} · hands-on ${plan.totals.minutes} minutes over ${plan.totals.weeks} weeks · hold ${plan.totals.hold} days · verdict <span class="verdict">${plan.totals.verdict}</span> on cash cost.</p>
    </div>`;
  show('detail');
}
$('back').addEventListener('click', () => show('board'));

// ---- method ----
$('m-priced').textContent = M.priced;
$('methodrows').innerHTML = R.method.map(([n, cv, wf]) => `<tr class="static"><td>${esc(n)}${n === M.winner ? ' <span class="chip wl">winner — prices the board</span>' : ''}</td><td class="num">×${cv}</td><td class="num">${wf === null ? '—' : '×' + wf}</td><td>${n === M.winner ? 'lowest cross-validation error' : ''}</td></tr>`).join('');

// ---- trading ----
$('trading-note').textContent = `${M.trading} protocols record a token and are set aside from the board — a radar that ranks them as still to come would be wrong on its first criterion. ${M.priced} of them carry a positive market cap; those are the ground truth the model tournament is fitted and tested on. The 48 largest by market cap:`;
$('tradingrows').innerHTML = R.trading_top.map((t, i) => `<tr class="static"><td class="num">${i + 1}</td><td><span class="name">${esc(t[1])}</span><br><span class="slug">${esc(t[0])}</span></td><td>${esc(catName(t[2]))}</td><td class="num">${money(t[3] * 1000)}</td><td class="num">${money(t[4] * 1000)}</td><td class="num ${t[5] === null ? '' : t[5] >= 0 ? 'up' : 'down'}">${pct1(t[5])}</td></tr>`).join('');

// ---- accounted ----
const totR = R.accounted.reduce((s, a) => s + a[1], 0), totT = R.accounted.reduce((s, a) => s + a[2], 0);
$('accounted-note').textContent = `Every one of the snapshot's ${M.scanned} protocols lands in exactly one column: ${totR} record no token and are ranked on the board; ${totT} record a token and are set aside. Nothing is dropped quietly — the two columns sum to the whole snapshot, category by category.`;
$('accountedrows').innerHTML = R.accounted.map((a) => `<tr class="static"><td>${esc(a[0])}</td><td class="num">${a[1]}</td><td class="num">${a[2]}</td><td class="num">${a[1] + a[2]}</td></tr>`).join('') +
  `<tr class="static"><td><b>All categories</b></td><td class="num"><b>${totR}</b></td><td class="num"><b>${totT}</b></td><td class="num"><b>${totR + totT}</b></td></tr>`;

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
renderBoard();
