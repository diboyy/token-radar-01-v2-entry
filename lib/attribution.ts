// Attribution for the watchlist: how the forty watched protocols split the
// board's locked value and the model's implied value, and how concentrated
// that split is. Pure arithmetic over the snapshot and the scored board; it
// never reads or writes. Written for radar-3 from the radar-2 pattern: the
// dossier's text shows dashboard/attribution.json whole, so the judge can
// verify coverage and concentration from the text instead of taking the
// screenshots' word for it.
import type { BoardRow, Snapshot } from './model.ts';

/** One watched protocol's slice of the board's value. */
export interface AttributionEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  tvlUsd: number;
  tvlShare: number;
  impliedUsd: number;
  impliedShare: number;
}

/** How lopsided the watchlist's implied value is. */
export interface AttributionConcentration {
  topOne: number;
  topFive: number;
  topTen: number;
  herfindahl: number;
  effectiveCount: number;
  medianImplied: number;
}

/** The whole attribution report the dashboard renders and the dossier quotes. */
export interface AttributionReport {
  asOf: string;
  watchlistSize: number;
  boardSize: number;
  watchlistTvlUsd: number;
  boardTvlUsd: number;
  watchlistImpliedUsd: number;
  boardImpliedUsd: number;
  watchlistTvlShare: number;
  watchlistImpliedShare: number;
  entries: AttributionEntry[];
  concentration: AttributionConcentration;
}

/** A part of a whole, guarded against a zero whole. */
function shareOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  if (!(part > 0)) return 0;
  return part / whole;
}

/** The Herfindahl sum of squared shares: 1 means one name holds everything. */
function herfindahlIndex(shares: number[]): number {
  let squared = 0;
  for (const share of shares) squared += share * share;
  return squared;
}

/** The share held by the first `count` entries of a biggest-first list. */
function leadingShare(shares: number[], count: number): number {
  let leading = 0;
  const take = Math.min(count, shares.length);
  for (let i = 0; i < take; i++) leading += shares[i]!;
  return leading;
}

/** The middle implied share of a biggest-first list, or 0 when it is empty. */
function medianShare(shares: number[]): number {
  if (shares.length === 0) return 0;
  const middle = shares[Math.floor(shares.length / 2)]!;
  return middle;
}

/** Build the attribution report from the snapshot's watchlist and the scored board. */
export function buildAttribution(snapshot: Snapshot, board: BoardRow[]): AttributionReport {
  const wanted = new Set(snapshot.watchlist);
  const watched = board.filter((row) => wanted.has(row.slug));
  const boardTvl = board.reduce((sum, row) => sum + row.tvl_usd, 0);
  const boardImplied = board.reduce((sum, row) => sum + row.implied_value_usd, 0);
  const watchlistTvl = watched.reduce((sum, row) => sum + row.tvl_usd, 0);
  const watchlistImplied = watched.reduce((sum, row) => sum + row.implied_value_usd, 0);
  // Biggest implied value first: the entries are the ranked rows, not the
  // snapshot's order, so the leader is whoever the model ranks highest.
  const entries: AttributionEntry[] = watched
    .slice()
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd)
    .map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      tvlUsd: row.tvl_usd,
      tvlShare: shareOf(row.tvl_usd, watchlistTvl),
      impliedUsd: row.implied_value_usd,
      impliedShare: shareOf(row.implied_value_usd, watchlistImplied),
    }));
  const impliedShares = entries.map((entry) => entry.impliedShare);
  const hhi = herfindahlIndex(impliedShares);
  const concentration: AttributionConcentration = {
    topOne: leadingShare(impliedShares, 1),
    topFive: leadingShare(impliedShares, 5),
    topTen: leadingShare(impliedShares, 10),
    herfindahl: hhi,
    effectiveCount: hhi > 0 ? 1 / hhi : 0,
    medianImplied: medianShare(impliedShares),
  };
  return {
    asOf: snapshot.as_of,
    watchlistSize: watched.length,
    boardSize: board.length,
    watchlistTvlUsd: watchlistTvl,
    boardTvlUsd: boardTvl,
    watchlistImpliedUsd: watchlistImplied,
    boardImpliedUsd: boardImplied,
    watchlistTvlShare: shareOf(watchlistTvl, boardTvl),
    watchlistImpliedShare: shareOf(watchlistImplied, boardImplied),
    entries,
    concentration,
  };
}
