// Token Radar v2 ("radar-3"): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot records, strongest first:
// every protocol at or above the $50M floor that records no token and is not an
// exchange or a versioned pool, plus every rankable pre-token protocol below the
// floor. Live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x 0.30
//   growth     = 1 + clamp(change_7d, -50, 150) / 100 x 0.6
//   maturity   = 0.65 + 0.55 x exp(-((age_days - 730) / 1000)^2)   (age unknown: 365d)
//   category   = the table below (lending, dexes, launchpads and derivatives score
//                highest; bridges and staking wrappers score lowest — and the table
//                is the second half of the already-traded discount: a x0.15 readiness
//                factor alone cannot move a $7.9B bridge below a $500M genuine
//                protocol, so bridge, staking-wrapper and CEX categories sit at
//                0.12-0.15, which together with readiness puts every already-traded
//                product below the genuine top ranks)
//   chains     = 1 + 0.02 x min(chains - 1, 5)
//   readiness  = 0.15 when the row is an already-traded product (an exchange, a
//                bridge, a liquid-staking or restaking wrapper, a versioned pool,
//                a wrapped/staked product, or an exchange-named product), else 1
//   implied    = max(1, round(base x growth x maturity x category x chains x readiness))
//
// No protocol name is ever special-cased: the same function scores every row.
// The readiness discount is what keeps already-traded products at the bottom of
// the board instead of at its top, where their raw TVL would otherwise put them.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_peak_days: number;
  maturity_width_days: number;
  unknown_age_days: number;
  readiness_discount: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.55,
  maturity_peak_days: 730,
  maturity_width_days: 1000,
  unknown_age_days: 365,
  readiness_discount: 0.15,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 40;

/** The per-category multiplier table. Unknown and unlisted categories score 1.00. */
export const CATEGORY_MULT: Record<string, number> = {
  'Launchpad': 1.2,
  'Lending': 1.15,
  'Dexs': 1.15,
  'Derivatives': 1.15,
  'Uncollateralized Lending': 1.1,
  'CDP': 1.1,
  'Risk Curators': 1.1,
  'RWA': 1.1,
  'Prediction Market': 1.1,
  'Interest Rate Derivatives': 1.1,
  'Options': 1.1,
  'AI Agents': 1.1,
  'Decentralized AI': 1.1,
  'Yield': 1.05,
  'Basis Trading': 1.05,
  'Leveraged Farming': 1.05,
  'Yield Aggregator': 1.05,
  'Onchain Capital Allocator': 1.05,
  'Insurance': 1.05,
  'Synthetics': 1.05,
  'Options Vault': 1.05,
  'Collateral Management': 1.05,
  'CDP Manager': 1.05,
  'Liquidity Manager': 1.0,
  'Restaking': 1.0,
  'Farm': 1.0,
  'Decentralized BTC': 1.0,
  'Indexes': 1.0,
  'Privacy': 1.0,
  'Payments': 1.0,
  'Governance Incentives': 1.0,
  'Stablecoin Issuer': 1.0,
  'DOR': 1.0,
  'Anchor BTC': 0.95,
  'CeDeFi': 0.95,
  'OTC Marketplace': 0.95,
  'Token Locker': 0.95,
  'Crypto Card Issuer': 0.95,
  'NFT Marketplace': 0.95,
  'Reserve Currency': 0.95,
  'Algo-Stables': 0.9,
  'Dual-Token Stablecoin': 0.95,
  'Stablecoin Wrapper': 0.9,
  'Chain': 0.9,
  'Staking Pool': 0.85,
  'Liquid Staking': 0.12,
  'Liquid Restaking': 0.12,
  'Restaked BTC': 0.12,
  'Cross Chain Bridge': 0.15,
  'Bridge': 0.12,
  'Canonical Bridge': 0.12,
  'CEX': 0.15,
};

/** Categories whose rows are already-traded products, not pre-token launches. */
const TRADED_CATEGORIES = new Set([
  'CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
  'Liquid Staking', 'Liquid Restaking', 'Restaked BTC',
]);

/** Exchange names: a protocol beginning with one is that exchange's product. */
const EXCHANGE_NAMES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name ending in a release marker is a pool of another protocol, not a launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped, staked or bridged product of another protocol. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    chains_multiplier: number;
    readiness_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  r: number;
  s: string;
  n: string;
  c: string | null;
  ch: string[];
  t: number;
  g: number | null;
  a: number | null;
  v: number;
  f: [number, number, number, number, number];
  steps: string[];
  /** 1 when the slug is on the house watchlist. */
  w?: 1;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  s: string;
  n: string;
  c: string | null;
  ch: string[];
  t: number;
  m: number | null;
  g: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model, the signals. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  category_mult: Record<string, number>;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  floor_size: number;
  early_size: number;
  live_size: number;
  concentration: { total_implied_usd: number; top5_share_pct: number; top10_share_pct: number };
  top_value: string[];
  top_growth: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a row is an already-traded product: exchange, bridge, staking wrapper, versioned pool, wrapped/staked product, or exchange-named. */
export function isTradedProduct(p: SnapshotProtocol): boolean {
  return (
    TRADED_CATEGORIES.has(p.category ?? '') ||
    VERSIONED.test(p.name) ||
    WRAPPED_WORD.test(p.name) ||
    EXCHANGE_NAMES.test(p.name)
  );
}

/** The launch-readiness factor: already-traded products are discounted hard. */
export function readinessFactor(p: SnapshotProtocol, model: ModelConstants): number {
  return isTradedProduct(p) ? model.readiness_discount : 1;
}

/** The category multiplier, 1.00 when the snapshot names no category or an unlisted one. */
export function categoryFactor(p: SnapshotProtocol): number {
  return CATEGORY_MULT[p.category ?? ''] ?? 1;
}

/** The chains multiplier: a little more for every extra chain, capped at five extra. */
export function chainsFactor(p: SnapshotProtocol): number {
  return 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
}

/** The maturity multiplier: a hump peaking at two years of track record. */
export function maturityFactor(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  const d = (a - model.maturity_peak_days) / model.maturity_width_days;
  return model.maturity_floor + model.maturity_range * Math.exp(-(d * d));
}

/** The growth multiplier: the 7-day change, clamped, weighted. */
export function growthFactor(p: SnapshotProtocol, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/** The six factors and the implied value one protocol gets under `model`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants): {
  implied: number; base: number; growthPct: number; growthMult: number;
  maturityMult: number; categoryMult: number; chainsMult: number; readiness: number; age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const { pct, mult: growthMult } = growthFactor(p, model);
  const maturityMult = maturityFactor(age, model);
  const categoryMult = categoryFactor(p);
  const chainsMult = chainsFactor(p);
  const readiness = readinessFactor(p, model);
  const base = p.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * categoryMult * chainsMult * readiness));
  return { implied, base: Math.round(base), growthPct: pct, growthMult, maturityMult, categoryMult, chainsMult, readiness, age };
}

/** Whether a protocol may be ranked: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const bySlugAsc = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
  a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The floor above the watchlist: every other rankable pre-token protocol at or
  // above the floor, not just the watchlist's forty.
  for (const p of snapshot.protocols) {
    if (p.tvl_usd >= snapshot.floor_usd && isRankable(p)) chosen.set(p.slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor. All of
  // them, not a top-N slice by TVL: coverage is the point of the board.
  for (const p of snapshot.protocols) {
    if (p.tvl_usd < snapshot.floor_usd && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || bySlugAsc(a.p, b.p));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_usd: s.base,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      category_multiplier: round4(s.categoryMult),
      chains_multiplier: round4(s.chainsMult),
      readiness_factor: s.readiness,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.readiness).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category's farm actions. `match` is a lowercased substring of the category;
 * the first match wins, so specific entries come before generic ones. `{n}` is the
 * protocol name, `{c}` its capital in dollars, `{h}` its main chain. Every category
 * the snapshot carries is covered here or by the generic fallback.
 */
const CATEGORY_ACTIONS: { match: string; action: string; weekly: string }[] = [
  { match: 'liquid staking', action: 'Stake ${c} of the chain staking asset through {n} on {h} and keep the receipt token.', weekly: 'Check the staking yield and restake the rewards once a week.' },
  { match: 'liquid restaking', action: 'Restake ${c} of the liquid staking token through {n} on {h} and keep the receipt.', weekly: 'Check the restaking points and top up the position once a week.' },
  { match: 'restaking', action: 'Restake ${c} through {n} on {h} and keep the receipt token for the position.', weekly: 'Check the restaking points balance once a week.' },
  { match: 'staking pool', action: 'Stake ${c} of the chain staking asset in the {n} pool on {h}.', weekly: 'Check the pool yield and compound the rewards once a week.' },
  { match: 'cross chain bridge', action: 'Bridge ${c} of USDC through {n} to {h} and use the bridged funds in the destination app.', weekly: 'Bridge a small amount through {n} once a week to keep the route active.' },
  { match: 'canonical bridge', action: 'Bridge ${c} of the chain asset through {n} to {h} and use it in the destination app.', weekly: 'Use the bridge route once a week with a small transfer.' },
  { match: 'bridge', action: 'Bridge ${c} of USDC through {n} to {h} and use the bridged funds in the destination app.', weekly: 'Bridge a small amount through {n} once a week to keep the route active.' },
  { match: 'cex', action: 'Open a {n} account, deposit ${c} and trade one small spot pair, keeping the trade history.', weekly: 'Place one small spot trade on {n} each week.' },
  { match: 'leveraged farm', action: 'Open a leveraged farm of ${c} on {n} on {h} at low leverage and keep the health factor above 2.', weekly: 'Check the farm health factor and rebalance once a week.' },
  { match: 'uncol', action: 'Borrow ${c} of USDC from {n} on {h} against a whitelisted credit line and repay part weekly.', weekly: 'Repay a slice of the loan and re-borrow once a week.' },
  { match: 'cdp manager', action: 'Open a vault on {n} on {h}, deposit ${c} of collateral and mint a small stablecoin amount.', weekly: 'Check the vault ratio and adjust the collateral once a week.' },
  { match: 'cdp', action: 'Open a vault on {n} on {h}, deposit ${c} of collateral and mint a small stablecoin amount.', weekly: 'Check the vault ratio and adjust the collateral once a week.' },
  { match: 'collateral', action: 'Deposit ${c} of collateral into {n} on {h} and open a small borrow against it.', weekly: 'Check the collateral ratio and top it up once a week.' },
  { match: 'lending', action: 'Supply ${c} of USDC to {n} on {h} and borrow a small amount against it to show both sides.', weekly: 'Repay and re-borrow a small amount on {n} once a week.' },
  { match: 'launchpad', action: 'Stake ${c} of the launchpad asset on {n} on {h} and join one sale allocation.', weekly: 'Check new sales on {n} and join one allocation each week.' },
  { match: 'perpetual', action: 'Deposit ${c} of USDC as margin on {n} on {h} and open one small hedged position.', weekly: 'Open and close one small hedge on {n} each week.' },
  { match: 'derivative', action: 'Deposit ${c} of USDC as margin on {n} on {h} and open one small hedged position.', weekly: 'Open and close one small hedge on {n} each week.' },
  { match: 'interest rate', action: 'Open a ${c} fixed-rate position on {n} on {h} and hold it to maturity.', weekly: 'Check the rate curve and roll one position each week.' },
  { match: 'option', action: 'Buy one ${c} option spread on {n} on {h} and hold it through one expiry.', weekly: 'Open one small option position on {n} each week.' },
  { match: 'prediction', action: 'Fund ${c} and place one market position on {n} on {h}, then settle it after the outcome.', weekly: 'Place one new market position on {n} each week.' },
  { match: 'curator', action: 'Deposit ${c} into a {n} curated vault on {h} and keep the shares for the full term.', weekly: 'Check the vault allocation and add a small top-up once a week.' },
  { match: 'allocator', action: 'Deposit ${c} into a {n} allocation vault on {h} and keep the shares for the full term.', weekly: 'Check the vault allocation and add a small top-up once a week.' },
  { match: 'rwa', action: 'Mint ${c} of the yield-bearing real-world asset on {n} on {h} and hold it.', weekly: 'Check the asset yield and reinvest the payout once a week.' },
  { match: 'insurance', action: 'Buy ${c} of cover from {n} on {h} and keep the policy active for the full term.', weekly: 'Check open cover on {n} and renew or extend once a week.' },
  { match: 'stablecoin wrapper', action: 'Wrap ${c} of the stablecoin through {n} on {h} and hold the wrapped receipt.', weekly: 'Check the wrapper yield and top up once a week.' },
  { match: 'algo-stables', action: 'Mint ${c} of the algorithmic stablecoin on {n} on {h} and hold it through one peg cycle.', weekly: 'Check the peg and rebalance the position once a week.' },
  { match: 'dual-token', action: 'Mint ${c} of the stable pair on {n} on {h} and hold both sides of the position.', weekly: 'Check the pair ratio and rebalance once a week.' },
  { match: 'stablecoin', action: 'Mint or deposit ${c} of the stable asset through {n} on {h} and hold it.', weekly: 'Check the stablecoin yield and top up once a week.' },
  { match: 'yield aggregator', action: 'Deposit ${c} into the highest-yield {n} vault on {h} and keep the shares.', weekly: 'Check the vault APY and move to the best vault once a week.' },
  { match: 'yield', action: 'Deposit ${c} into a {n} yield vault on {h} and keep the shares for the full term.', weekly: 'Harvest the yield and redeposit it once a week.' },
  { match: 'liquidity manager', action: 'Deposit ${c} into a {n} managed liquidity range on {h} and keep the position open.', weekly: 'Check the range and rebalance it once a week.' },
  { match: 'dex', action: 'Provide ${c} of liquidity to {n} main pool on {h} and keep the position open.', weekly: 'Swap a small amount through {n} once a week to keep the position active.' },
  { match: 'farm', action: 'Deposit ${c} into the {n} farm on {h} and stake the receipt token for rewards.', weekly: 'Harvest the farm rewards and restake them once a week.' },
  { match: 'basis', action: 'Open a ${c} basis position on {n} on {h} and hold both legs until the funding settles.', weekly: 'Check the funding rate and roll the position once a week.' },
  { match: 'synthetic', action: 'Mint ${c} of the synthetic asset on {n} on {h} against collateral and hold it.', weekly: 'Check the collateral ratio and top it up once a week.' },
  { match: 'nft marketplace', action: 'List one item and buy one small item on {n} on {h} to build marketplace activity.', weekly: 'Place one bid or listing on {n} each week.' },
  { match: 'privacy', action: 'Deposit ${c} into the {n} private pool on {h} and withdraw to a fresh address.', weekly: 'Use the private pool once a week with a small amount.' },
  { match: 'payment', action: 'Route ${c} of payments through {n} on {h} and keep the receipts.', weekly: 'Send one payment through {n} each week.' },
  { match: 'governance', action: 'Delegate ${c} of voting power on {n} on {h} and vote on one live proposal.', weekly: 'Vote on one new {n} proposal each week.' },
  { match: 'locker', action: 'Lock ${c} of tokens in {n} on {h} for the shortest term and keep the lock receipt.', weekly: 'Check the lock schedule and extend it once a week.' },
  { match: 'card', action: 'Load ${c} onto the {n} card on {h} and spend a small amount to build card history.', weekly: 'Make one card purchase through {n} each week.' },
  { match: 'otc', action: 'Request one ${c} OTC quote on {n} on {h} and settle one small trade.', weekly: 'Request one fresh OTC quote on {n} each week.' },
  { match: 'index', action: 'Buy ${c} of the {n} index on {h} and hold the basket.', weekly: 'Check the index rebalance and top up once a week.' },
  { match: 'chain', action: 'Bridge ${c} to {h} and use two of its native apps through {n} to build chain activity.', weekly: 'Use one native app on {h} through {n} each week.' },
  { match: 'ai agent', action: 'Run one ${c} agent task on {n} on {h} and keep the task receipt.', weekly: 'Run one new agent task on {n} each week.' },
  { match: 'decentralized ai', action: 'Run one ${c} inference job on {n} on {h} and keep the job receipt.', weekly: 'Run one new inference job on {n} each week.' },
  { match: 'anchor', action: 'Hold ${c} of the BTC-pegged asset on {n} on {h} and keep it staked for yield.', weekly: 'Check the peg and the yield once a week.' },
  { match: 'btc', action: 'Hold ${c} of the BTC-pegged asset on {n} on {h} and keep it in the yield vault.', weekly: 'Check the peg and the vault yield once a week.' },
  { match: 'reserve', action: 'Hold ${c} of the reserve asset on {n} on {h} and keep it staked.', weekly: 'Check the reserve backing and yield once a week.' },
  { match: 'dor', action: 'Deposit ${c} into {n} on {h} and use its core feature once to register activity.', weekly: 'Use {n} core feature once a week with a small amount.' },
];

/** Fill the {n} {c} {h} placeholders of a category action. */
function fill(template: string, p: SnapshotProtocol, capital: number, chain: string): string {
  return template.replaceAll('{n}', p.name).replaceAll('{c}', `$${capital}`).replaceAll('{h}', chain);
}

/** The category's action pair, or the generic deposit pair when nothing matches. */
function actionPair(p: SnapshotProtocol, capital: number, chain: string): { action: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  for (const e of CATEGORY_ACTIONS) {
    if (c.includes(e.match)) return { action: fill(e.action, p, capital, chain), weekly: fill(e.weekly, p, capital, chain) };
  }
  return {
    action: `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`,
    weekly: `Make one qualifying action on ${p.name} each week, such as a deposit, a swap or a vote.`,
  };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age) and its readiness.
 * Already-traded products say so honestly: the steps farm the product's own yield,
 * because there is no token launch left to farm.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, readiness = 1): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const pair = actionPair(p, capital, chain);
  const main = readiness < 1
    ? `This is an already-traded product, not a pre-token farm: use it for its own yield by putting $${capital} to work through ${p.name} on ${chain} and keeping the position open.`
    : pair.action;
  const weekly = readiness < 1
    ? `Check the product's own yield once a week and rebalance the $${capital} position when it moves.`
    : pair.weekly;
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: main, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ s: p.slug, n: p.name, c: p.category, ch: p.chains, t: p.tvl_usd, m: p.mcap_usd, g: p.change_7d }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    r: row.rank, s: row.slug, n: row.name, c: row.category, ch: row.chains,
    t: row.tvl_usd, g: row.change_7d, a: row.age_days, v: row.implied_value_usd,
    f: [row.model.growth_multiplier, row.model.maturity_multiplier, row.model.category_multiplier, row.model.chains_multiplier, row.model.readiness_factor],
    steps: row.farm_steps,
    ...(watchlist.has(row.slug) ? { w: 1 as const } : {}),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const floorSize = board.filter((r) => r.tvl_usd >= snapshot.floor_usd).length;
  const total = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const top5 = board.slice(0, 5).reduce((n, r) => n + r.implied_value_usd, 0);
  const top10 = board.slice(0, 10).reduce((n, r) => n + r.implied_value_usd, 0);
  const byGrowth = [...board]
    .sort((a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9) || a.slug.localeCompare(b.slug))
    .slice(0, 5)
    .map((r) => r.slug);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    category_mult: CATEGORY_MULT,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    floor_size: floorSize,
    early_size: board.length - floorSize,
    live_size: live.length,
    concentration: {
      total_implied_usd: total,
      top5_share_pct: round4((top5 / total) * 100),
      top10_share_pct: round4((top10 / total) * 100),
    },
    top_value: board.slice(0, 5).map((r) => r.slug),
    top_growth: byGrowth,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
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
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    if (seen.has(p.slug)) throw new SnapshotError(`snapshot.json repeats slug ${p.slug}`);
    seen.add(p.slug);
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const index = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!index.has(r.slug)) return `${r.slug} is not a protocol in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice on the board`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') return `${r.slug} has no name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (typeof s !== 'string' || s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${typeof s === 'string' ? s.length : '?' } characters`;
      if (s !== s.trim()) return `${r.slug} has an untrimmed farm step`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
