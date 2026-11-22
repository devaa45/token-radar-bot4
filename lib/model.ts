// Token Radar, fourth build: the model library.
//
// One snapshot in, one ranked board out. The board ranks every protocol that
// records no token (market cap, CoinGecko id and symbol all null: 342 of the
// 758), never a subset, and the 416 that record a token are set aside and
// accounted for, never ranked as if still to come.
//
// The value model is chosen at run time, not by hand: fourteen families are
// fitted on the 128 protocols whose token already trades at a recorded cap,
// each scored held-out twice — five-fold cross-validation with folds assigned
// by an FNV-1a hash of the slug (the same folds and the same median
// multiplicative error the third build's harness used, so the numbers compare)
// and a walk-forward split (earliest-tracked 70% trains, latest 30% tests).
// The winner on cross-validation, refitted on all 128, prices the board. Its
// cross-validation signed errors' interquartile range is the band on every row.
//
// Peer token odds: for each row, of the same-category protocols tracked at
// least as long, the share that already record a token, shrunk toward the
// snapshot's global rate (128 of 758 carry a positive cap) with prior
// strength 8. Farm plans are seven costed, timed steps from templates driven
// by the row's own category, TVL and age, with a totals line and a verdict.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Strictly pre-token: no cap, no CoinGecko id, no symbol recorded. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------------------
// Small statistics helpers. Everything is a plain function of its inputs, so
// two runs over the same snapshot write the same bytes.

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

/** Solve a small dense linear system by Gaussian elimination; null if singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Ordinary least squares of target on feats, through the normal equations. */
function ols(rows: SnapshotProtocol[], feats: ((p: SnapshotProtocol) => number)[], target: (p: SnapshotProtocol) => number): (p: SnapshotProtocol) => number {
  const k = feats.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty: number[] = new Array(k).fill(0);
  for (const p of rows) {
    const x = feats.map((f) => f(p));
    const y = target(p);
    for (let i = 0; i < k; i++) {
      xty[i]! += x[i]! * y;
      for (let j = 0; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 0; i < k; i++) xtx[i]![i]! += 1e-9;
  const beta = solveLinear(xtx, xty) ?? new Array(k).fill(0);
  return (p) => feats.reduce((s, f, i) => s + beta[i]! * f(p), 0);
}

/** Iteratively reweighted least squares; the weight rule picks the flavour. */
function irls(rows: SnapshotProtocol[], feats: ((p: SnapshotProtocol) => number)[], target: (p: SnapshotProtocol) => number, weight: (r: number) => number, rounds: number): (p: SnapshotProtocol) => number {
  let pred = ols(rows, feats, target);
  const k = feats.length;
  for (let round = 0; round < rounds; round++) {
    const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const xty: number[] = new Array(k).fill(0);
    for (const p of rows) {
      const w = weight(target(p) - pred(p));
      const x = feats.map((f) => f(p));
      const y = target(p);
      for (let i = 0; i < k; i++) {
        xty[i]! += w * x[i]! * y;
        for (let j = 0; j < k; j++) xtx[i]![j]! += w * x[i]! * x[j]!;
      }
    }
    for (let i = 0; i < k; i++) xtx[i]![i]! += 1e-9;
    const beta = solveLinear(xtx, xty);
    if (beta === null) break;
    pred = (p) => feats.reduce((s, f, i) => s + beta[i]! * f(p), 0);
  }
  return pred;
}

// ---------------------------------------------------------------------------
// Features: functions of the snapshot's own fields only.

const logTvl = (p: SnapshotProtocol) => Math.log10(Math.max(1, p.tvl_usd));
const logMcap = (p: SnapshotProtocol) => Math.log10(p.mcap_usd!);
const growthFeat = (p: SnapshotProtocol) => (p.change_7d === null ? 0 : Math.max(-0.9, Math.min(3, p.change_7d / 100)));
const chainFeat = (p: SnapshotProtocol) => Math.log10(Math.max(1, p.chains.length));

function makeAgeFeature(priced: SnapshotProtocol[], asOf: string): (p: SnapshotProtocol) => number {
  const known = priced.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const mid = median(known.map((a) => Math.log10(a + 30)));
  return (p: SnapshotProtocol) => {
    const a = ageDays(asOf, p.listed_at);
    return a === null ? mid : Math.log10(a + 30);
  };
}

// ---------------------------------------------------------------------------
// The tournament: fourteen families, each a fit from a training set of priced
// protocols to a predictor of log10 market cap.

interface Family {
  name: string;
  fit: (train: SnapshotProtocol[], asOf: string) => (p: SnapshotProtocol) => number;
}

const powerFit = (train: SnapshotProtocol[]) => ols(train, [() => 1, logTvl], logMcap);

function winsorFit(train: SnapshotProtocol[]): (p: SnapshotProtocol) => number {
  const ratios = train.map((p) => logMcap(p) - logTvl(p)).sort((a, b) => a - b);
  const lo = quantile(ratios, 0.05);
  const hi = quantile(ratios, 0.95);
  const clipped = train.map((p) => ({ ...p, mcap_usd: Math.pow(10, logTvl(p) + Math.max(lo, Math.min(hi, logMcap(p) - logTvl(p)))) }));
  return ols(clipped, [() => 1, logTvl], logMcap);
}

function bucketFit(train: SnapshotProtocol[]): (p: SnapshotProtocol) => number {
  const xs = train.map(logTvl).sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < 6; i++) edges.push(quantile(xs, i / 6));
  const globalRatio = median(train.map((p) => logMcap(p) - logTvl(p)));
  const bucketOf = (p: SnapshotProtocol) => {
    let b = 0;
    while (b < edges.length && logTvl(p) > edges[b]!) b++;
    return b;
  };
  const buckets = new Map<number, number[]>();
  for (const p of train) {
    const b = bucketOf(p);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(logMcap(p) - logTvl(p));
  }
  const med = new Map<number, number>();
  for (const [b, rs] of buckets) med.set(b, median(rs));
  return (p) => {
    const b = bucketOf(p);
    const rs = buckets.get(b) ?? [];
    const w = rs.length / (rs.length + 6);
    return logTvl(p) + (w * (med.get(b) ?? globalRatio) + (1 - w) * globalRatio);
  };
}

const FAMILIES: Family[] = [
  { name: 'Power law in TVL', fit: (train) => powerFit(train) },
  { name: 'Winsorized-ratio power law', fit: (train) => winsorFit(train) },
  { name: 'Huber power law (delta 0.3)', fit: (train) => irls(train, [() => 1, logTvl], logMcap, (r) => (Math.abs(r) <= 0.3 ? 1 : 0.3 / Math.abs(r)), 12) },
  {
    name: 'Theil-Sen power law',
    fit: (train) => {
      const slopes: number[] = [];
      for (let i = 0; i < train.length; i++) {
        for (let j = i + 1; j < train.length; j++) {
          const dx = logTvl(train[j]!) - logTvl(train[i]!);
          if (Math.abs(dx) > 0.05) slopes.push((logMcap(train[j]!) - logMcap(train[i]!)) / dx);
        }
      }
      const b = median(slopes);
      const a = median(train.map((p) => logMcap(p) - b * logTvl(p)));
      return (p) => a + b * logTvl(p);
    },
  },
  { name: 'Median regression (L1) power law', fit: (train) => irls(train, [() => 1, logTvl], logMcap, (r) => 1 / Math.max(0.02, Math.abs(r)), 25) },
  { name: 'Quadratic in log TVL', fit: (train) => ols(train, [() => 1, logTvl, (p) => logTvl(p) * logTvl(p)], logMcap) },
  {
    name: 'Two-segment power law',
    fit: (train) => {
      const xs = train.map(logTvl).sort((a, b) => a - b);
      const cut = median(xs);
      const lo = train.filter((p) => logTvl(p) <= cut);
      const hi = train.filter((p) => logTvl(p) > cut);
      if (lo.length < 8 || hi.length < 8) return powerFit(train);
      const flo = powerFit(lo);
      const fhi = powerFit(hi);
      return (p) => (logTvl(p) <= cut ? flo(p) : fhi(p));
    },
  },
  { name: 'Full linear (TVL, growth, age, chains)', fit: (train, asOf) => ols(train, [() => 1, logTvl, growthFeat, makeAgeFeature(train, asOf), chainFeat], logMcap) },
  {
    name: 'Power law + growth, half tilt',
    fit: (train) => {
      const feats = [() => 1, logTvl, growthFeat];
      const full = ols(train, feats, logMcap);
      // Refit with the growth coefficient recovered, then halve its tilt.
      const k = feats.length;
      const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
      const xty: number[] = new Array(k).fill(0);
      for (const p of train) {
        const x = feats.map((f) => f(p));
        const y = logMcap(p);
        for (let i = 0; i < k; i++) {
          xty[i]! += x[i]! * y;
          for (let j = 0; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
        }
      }
      for (let i = 0; i < k; i++) xtx[i]![i]! += 1e-9;
      const beta = solveLinear(xtx, xty);
      if (beta === null) return full;
      return (p) => full(p) - 0.5 * beta[2]! * growthFeat(p);
    },
  },
  { name: 'Power law + age', fit: (train, asOf) => ols(train, [() => 1, logTvl, makeAgeFeature(train, asOf)], logMcap) },
  {
    name: 'Category intercepts, shrunk (k=4)',
    fit: (train) => {
      const base = powerFit(train);
      const byCat = new Map<string, number[]>();
      for (const p of train) {
        const c = p.category ?? '(none)';
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c)!.push(logMcap(p) - base(p));
      }
      const adj = new Map<string, number>();
      for (const [c, rs] of byCat) adj.set(c, median(rs) * (rs.length / (rs.length + 4)));
      return (p) => base(p) + (adj.get(p.category ?? '(none)') ?? 0);
    },
  },
  { name: 'TVL-bucket median ratio (6 buckets)', fit: (train) => bucketFit(train) },
  {
    name: 'k-nearest neighbours (k=8)',
    fit: (train) => (p) => {
      const near = train
        .map((q) => ({ d: Math.abs(logTvl(q) - logTvl(p)) + 0.35 * Math.abs(chainFeat(q) - chainFeat(p)), y: logMcap(q) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 8);
      return median(near.map((o) => o.y));
    },
  },
  {
    name: 'Median-of-3 ensemble',
    fit: (train) => {
      const a = powerFit(train);
      const b = winsorFit(train);
      const c = bucketFit(train);
      return (p) => median([a(p), b(p), c(p)]);
    },
  },
];

/** Deterministic fold: FNV-1a hash of the slug, mod 5. Same on every machine and run. */
export function foldOf(slug: string): number {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 5;
}

export interface FamilyScore {
  name: string;
  cv_median_x: number;
  walk_forward_median_x: number | null;
}

export interface ModelReport {
  winner: string;
  priced_n: number;
  scores: FamilyScore[];
  band_lo_x: number;
  band_hi_x: number;
  winner_cv_median_x: number;
  winner_walk_forward_median_x: number | null;
  /** The three ensemble components refitted on all priced protocols, for the detail view's cross-check. */
  components: { power: (p: SnapshotProtocol) => number; winsor: (p: SnapshotProtocol) => number; bucket: (p: SnapshotProtocol) => number };
}

const mult = (logErr: number) => Math.pow(10, logErr);
const medMultErr = (errs: number[]) => mult(median(errs.map(Math.abs)));

/** Run the tournament on the priced set; returns the refitted winner and its report. */
export function fitTournament(snapshot: Snapshot): { predict: (p: SnapshotProtocol) => number; report: ModelReport; priced: SnapshotProtocol[] } {
  const priced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  // Walk-forward split, shared by every family: earliest-tracked 70% trains.
  const byAge = [...priced].sort((a, b) => ((a.listed_at ?? '0000') < (b.listed_at ?? '0000') ? -1 : (a.listed_at ?? '0000') > (b.listed_at ?? '0000') ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(byAge.length * 0.7);
  const wfTrain = byAge.slice(0, cut);
  const wfTest = byAge.slice(cut);

  const scores: FamilyScore[] = [];
  let winner: Family = FAMILIES[0]!;
  let winnerErrs: number[] = [];
  let bestMed = Number.POSITIVE_INFINITY;
  for (const fam of FAMILIES) {
    const errs: number[] = [];
    for (let f = 0; f < 5; f++) {
      const train = priced.filter((p) => foldOf(p.slug) !== f);
      const test = priced.filter((p) => foldOf(p.slug) === f);
      const pred = fam.fit(train, snapshot.as_of);
      for (const p of test) errs.push(pred(p) - logMcap(p));
    }
    const cv = medMultErr(errs);
    const wfPred = fam.fit(wfTrain, snapshot.as_of);
    const wfErrs = wfTest.map((p) => wfPred(p) - logMcap(p));
    scores.push({ name: fam.name, cv_median_x: cv, walk_forward_median_x: wfErrs.length > 0 ? medMultErr(wfErrs) : null });
    if (cv < bestMed) {
      bestMed = cv;
      winner = fam;
      winnerErrs = errs;
    }
  }
  const predict = winner.fit(priced, snapshot.as_of);
  const sortedErrs = [...winnerErrs].sort((a, b) => a - b);
  const wScore = scores.find((s) => s.name === winner.name)!;
  return {
    predict,
    priced,
    report: {
      winner: winner.name,
      priced_n: priced.length,
      scores,
      band_lo_x: mult(quantile(sortedErrs, 0.25)),
      band_hi_x: mult(quantile(sortedErrs, 0.75)),
      winner_cv_median_x: wScore.cv_median_x,
      winner_walk_forward_median_x: wScore.walk_forward_median_x,
      components: { power: powerFit(priced), winsor: winsorFit(priced), bucket: bucketFit(priced) },
    },
  };
}

// ---------------------------------------------------------------------------
// The house's product screen, as the field guide states it: the clauses a
// watchlist row passed beyond recording no token and clearing the TVL floor.
// On the board the screen is a flag with a reason, never a silent deletion.

const SCREEN_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function houseScreen(p: SnapshotProtocol): { pass: boolean; reason: string } {
  if (p.category !== null && SCREEN_CATEGORIES.has(p.category)) return { pass: false, reason: `category ${p.category}: a wrapped, staked or bridged product class` };
  if (VERSIONED.test(p.name)) return { pass: false, reason: 'name ends in a version marker: a pool of another protocol' };
  if (WRAPPED_WORD.test(p.name)) return { pass: false, reason: 'name carries a wrapped or staked word' };
  for (const head of EXCHANGE_HEADS) if (p.name.startsWith(head)) return { pass: false, reason: `name begins with the exchange ${head}` };
  return { pass: true, reason: 'passes the house product screen' };
}

// ---------------------------------------------------------------------------
// Peer token odds: of the same-category protocols tracked at least as long,
// the share that already record a token, shrunk toward the global rate.

export interface PeerOdds {
  trading: number;
  peers: number;
  pct: number;
}

export function peerOdds(snapshot: Snapshot): Map<string, PeerOdds> {
  const globalRate = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length / snapshot.protocols.length;
  const out = new Map<string, PeerOdds>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const peers = snapshot.protocols.filter(
      (q) => q.slug !== p.slug && (q.category ?? null) === (p.category ?? null) && (p.listed_at === null || (q.listed_at !== null && q.listed_at <= p.listed_at)),
    );
    const trading = peers.filter((q) => !isPreToken(q)).length;
    const pct = Math.round(100 * ((trading + 8 * globalRate) / (peers.length + 8)));
    out.set(p.slug, { trading, peers: peers.length, pct });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Farm plans: seven steps from templates the row's own record drives — its
// category picks the actions, its TVL the deposit size, its chains the gas,
// its age the timetable. Every step is costed and timed; the plan closes with
// a totals line and a verdict on its cash cost.

export interface FarmTotals {
  deposit_usd: number;
  cash_usd: number;
  hands_on_minutes: number;
  weeks: number;
  hold_days: number;
  verdict: 'Lean' | 'Fair' | 'Heavy';
}

function depositFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

function gasFor(chains: number): number {
  return chains >= 5 ? 6 : chains >= 2 ? 4 : 3;
}

function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  return 4;
}

function actionsFor(p: SnapshotProtocol, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [`Supply USDC to ${n} on ${chain} and leave the position open`, `Borrow a small amount against the position on ${n}, then repay it inside the same week`];
  if (c.includes('dex')) return [`Provide USDC liquidity to ${n}'s main pool on ${chain}`, `Swap a small amount through ${n} on ${chain} so the wallet trades as well as provides`];
  if (c.includes('bridge')) return [`Bridge USDC to ${chain} through ${n}`, `Use the bridged USDC in one app on ${chain}, then bridge a small amount back`];
  if (c.includes('staking') || c.includes('restak')) return [`Stake the chain's staking asset through ${n} on ${chain} and keep the receipt token`, `Claim the staking rewards on ${n} once they accrue`];
  if (c.includes('derivative') || c.includes('option') || c.includes('perpetual')) return [`Deposit USDC as margin on ${n} and open one small hedged position`, `Close and reopen the hedge on ${n} once, so the wallet shows two-sided activity`];
  if (c.includes('launchpad')) return [`Register the wallet for ${n}'s next sale round on ${chain}`, `Take a small allocation in one ${n} sale and hold what it issues`];
  if (c.includes('prediction')) return [`Fund the wallet and place one market position on ${n}`, `Settle or roll the position on ${n} when its market closes`];
  if (c.includes('insurance')) return [`Buy cover from ${n} on ${chain} for the farmed position`, `Renew the ${n} cover once before it lapses`];
  if (c.includes('rwa')) return [`Mint ${n}'s yield asset on ${chain} and hold it in the wallet`, `Redeem a small part of the ${n} position once, then mint it back`];
  return [`Deposit USDC into ${n} on ${chain} and keep the position open`, `Make one more deposit into ${n} of a tenth the size, a week after the first`];
}

export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; totals: FarmTotals } {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const deposit = depositFor(p.tvl_usd);
  const gas = gasFor(p.chains.length);
  const weeks = weeksFor(age);
  const hold = weeks * 7;
  const [first, second] = actionsFor(p, chain);
  const weeklyGas = 2;
  const cash = 3 + gas + 2 + weeks * weeklyGas + 0 + gas;
  const minutes = 10 + 20 + 15 + weeks * 10 + 10 + 10 + 15;
  const verdict: FarmTotals['verdict'] = cash <= 25 ? 'Lean' : cash <= 60 ? 'Fair' : 'Heavy';
  const steps = [
    `Set up a fresh wallet for ${p.name} and fund it with the deposit plus gas money, keeping the seed phrase offline. Cost: about $3 of gas to fund. Time: 10 minutes.`,
    `${first}. Cost: $${deposit} of capital and about $${gas} of gas. Time: 20 minutes to set up.`,
    `${second}. Cost: about $2 of gas. Time: 15 minutes.`,
    `Repeat one qualifying action on ${p.name} every week for ${weeks} weeks, so the wallet appears in more than one weekly snapshot. Cost: about $${weeklyGas} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without withdrawing, so the activity spans the full qualifying window. Cost: the $${deposit} stays in the position. Time: ${hold} days.`,
    `Check ${p.name}'s own points or rewards page and claim only from the link the protocol itself publishes. Cost: nothing to check, and never pay anyone to claim. Time: 10 minutes.`,
    `Write the wallet, dates and transactions in a farm log, then decide from the log whether to unwind or roll the position. Cost: about $${gas} of gas to exit. Time: 15 minutes.`,
  ];
  return { steps, totals: { deposit_usd: deposit, cash_usd: cash, hands_on_minutes: minutes, weeks, hold_days: hold, verdict } };
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  band_lo_usd: number;
  band_hi_usd: number;
  watchlist: boolean;
  house_screen: { pass: boolean; reason: string };
  peer_odds: PeerOdds;
  farm_steps: string[];
  farm_totals: FarmTotals;
}

/** Compact row for data.js: [slug, name, category index, first chain, chain count, TVL $K, 7d %, age days (-1 unknown), implied $K, peers trading, peers total, flags, screen reason index, farm deposit $]. */
export type CompactRow = [string, string, number, string, number, number, number | null, number, number, number, number, number, number, number];

export interface RadarData {
  as_of: string;
  floor_usd: number;
  cats: (string | null)[];
  reasons: string[];
  meta: {
    scanned: number;
    ranked: number;
    trading: number;
    priced: number;
    watchlist: number;
    winner: string;
    winner_cv_x: number;
    winner_wf_x: number | null;
    band: [number, number];
    global_odds_pct: number;
    components: { power: [number, number]; winsor: [number, number]; bucket_edges: number[]; bucket_ratios: number[]; bucket_counts: number[]; bucket_global: number };
  };
  rows: CompactRow[];
  trading_top: [string, string, number, number, number, number | null][];
  accounted: [string, number, number][];
  /** The tournament table: [family, cross-validation median x, walk-forward median x] for all fourteen. */
  method: [string, number, number | null][];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round5 = (n: number) => Math.round(n * 100000) / 100000;

/** Linear coefficients of a fitted power-law-style predictor, for the page's cross-check. */
function linearOf(fit: (p: SnapshotProtocol) => number, priced: SnapshotProtocol[]): [number, number] {
  const lo = { ...priced[0]!, tvl_usd: 1_000_000 };
  const hi = { ...priced[0]!, tvl_usd: 1_000_000_000 };
  const yLo = fit(lo);
  const yHi = fit(hi);
  const b = (yHi - yLo) / 3;
  // Five decimals: at log TVL near 10, three would move the page's
  // cross-check off the board's own figure by about a percent.
  return [round5(yLo - b * 6), round5(b)];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { predict, report } = fitTournament(snapshot);
  const odds = peerOdds(snapshot);
  const watch = new Set(snapshot.watchlist);
  const pre = snapshot.protocols.filter(isPreToken);

  const cats: (string | null)[] = [];
  const catIdx = new Map<string, number>();
  const catKey = (c: string | null) => {
    const key = c ?? '(none)';
    if (!catIdx.has(key)) {
      catIdx.set(key, cats.length);
      cats.push(c);
    }
    return catIdx.get(key)!;
  };
  const reasons: string[] = [];
  const reasonIdx = new Map<string, number>();

  const scored = pre.map((p) => {
    const implied = Math.max(1, Math.round(Math.pow(10, predict(p))));
    return { p, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    const screen = watch.has(s.p.slug) ? { pass: true, reason: 'on the watchlist: passed the full house rule' } : houseScreen(s.p);
    const plan = farmPlan(s.p, age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: null,
      listed_at: s.p.listed_at,
      age_days: age,
      implied_value_usd: s.implied,
      band_lo_usd: Math.max(1, Math.round(s.implied * report.band_lo_x)),
      band_hi_usd: Math.round(s.implied * report.band_hi_x),
      watchlist: watch.has(s.p.slug),
      house_screen: screen,
      peer_odds: odds.get(s.p.slug)!,
      farm_steps: plan.steps,
      farm_totals: plan.totals,
    };
  });

  const rows: CompactRow[] = board.map((r) => {
    let ri = 0;
    if (!r.house_screen.pass) {
      if (!reasonIdx.has(r.house_screen.reason)) {
        reasonIdx.set(r.house_screen.reason, reasons.length + 1);
        reasons.push(r.house_screen.reason);
      }
      ri = reasonIdx.get(r.house_screen.reason)!;
    }
    const flags = (r.watchlist ? 1 : 0) + (r.house_screen.pass ? 0 : 2);
    return [
      r.slug,
      r.name,
      catKey(r.category),
      r.chains.length > 0 ? r.chains[0]! : '',
      r.chains.length,
      Math.round(r.tvl_usd / 1000),
      r.change_7d === null ? null : Math.round(r.change_7d * 10) / 10,
      r.age_days ?? -1,
      Math.max(1, Math.round(r.implied_value_usd / 1000)),
      r.peer_odds.trading,
      r.peer_odds.peers,
      flags,
      ri,
      r.farm_totals.deposit_usd,
    ];
  });

  const trading = snapshot.protocols.filter((p) => !isPreToken(p));
  const tradingTop = [...trading]
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 48)
    .map((p): RadarData['trading_top'][number] => [p.slug, p.name, catKey(p.category), Math.round(p.tvl_usd / 1000), Math.round((p.mcap_usd ?? 0) / 1000), p.change_7d === null ? null : Math.round(p.change_7d * 10) / 10]);

  const accountedMap = new Map<string, [string, number, number]>();
  const bump = (c: string | null, ranked: boolean) => {
    const key = c ?? '(none named)';
    if (!accountedMap.has(key)) accountedMap.set(key, [key, 0, 0]);
    accountedMap.get(key)![ranked ? 1 : 2]!++;
  };
  for (const p of snapshot.protocols) bump(p.category, isPreToken(p));
  const accounted = [...accountedMap.values()].sort((a, b) => b[1] + b[2] - (a[1] + a[2]) || (a[0] < b[0] ? -1 : 1));

  // The bucket component's shape, carried so the page can price its cross-check.
  const priced = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = priced.map(logTvl).sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < 6; i++) edges.push(quantile(xs, i / 6));
  const bucketOf = (p: SnapshotProtocol) => {
    let b = 0;
    while (b < edges.length && logTvl(p) > edges[b]!) b++;
    return b;
  };
  const buckets = new Map<number, number[]>();
  for (const p of priced) {
    const b = bucketOf(p);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(logMcap(p) - logTvl(p));
  }
  const globalRatio = median(priced.map((p) => logMcap(p) - logTvl(p)));
  const bucketRatios: number[] = [];
  for (let b = 0; b < 6; b++) bucketRatios.push(round3(median(buckets.get(b) ?? [globalRatio])));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    cats,
    reasons,
    meta: {
      scanned: snapshot.protocols.length,
      ranked: board.length,
      trading: trading.length,
      priced: report.priced_n,
      watchlist: snapshot.watchlist.length,
      winner: report.winner,
      winner_cv_x: round3(report.winner_cv_median_x),
      winner_wf_x: report.winner_walk_forward_median_x === null ? null : round3(report.winner_walk_forward_median_x),
      band: [round3(report.band_lo_x), round3(report.band_hi_x)],
      global_odds_pct: Math.round(100 * (priced.length / snapshot.protocols.length)),
      components: {
        power: linearOf(report.components.power, priced),
        winsor: linearOf(report.components.winsor, priced),
        bucket_edges: edges.map(round5),
        bucket_ratios: bucketRatios.map(round5),
        bucket_counts: [0, 1, 2, 3, 4, 5].map((b) => (buckets.get(b) ?? []).length),
        bucket_global: round5(globalRatio),
      },
    },
    rows,
    trading_top: tradingTop,
    accounted,
    method: report.scores.map((s): RadarData['method'][number] => [s.name, round3(s.cv_median_x), s.walk_forward_median_x === null ? null : round3(s.walk_forward_median_x)]),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script, written inside dashboard/ so the dossier carries it. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
