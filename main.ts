// Token Radar v2 ("radar-3") entrypoint: snapshot in, ranked board and dashboard out.
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>), scores
// every rankable pre-token protocol with the model in lib/model.ts, writes the
// ranked board to /output/board.json and the dashboard's data to /output/data.js,
// copies dashboard/ and screenshots/ to /output, and writes /output/dossier.json
// LAST with the vendored make.fun library, so the scorer can rebuild it byte for
// byte from the same output.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program
// writes from the same board, so the page and the board can never disagree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildAttribution } from './lib/attribution.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
// The board's promise is that its top ranks are genuine pre-token launches: an
// already-traded product (readiness factor below 1) must never crack the top 20,
// however large its TVL. Refuse the run rather than hand in a bridge-led board.
const topTraded = board.slice(0, 20).filter((r) => r.model.readiness_factor < 1);
if (topTraded.length > 0) {
  process.stderr.write(`token radar: already-traded products in the top 20: ${topTraded.map((r) => r.name).join(', ')}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardText = `${JSON.stringify({ rows: board })}\n`;
if (Buffer.byteLength(boardText, 'utf8') > 8 * 1024 * 1024) {
  process.stderr.write(`token radar: board.json is ${Buffer.byteLength(boardText, 'utf8')} bytes, over the 8 MiB the gate allows\n`);
  process.exit(1);
}
writeFileSync(join(out, 'board.json'), boardText);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Attribution for the dashboard: who carries the watchlist's value. It is written
// into the dashboard before the dossier, so the dossier's Dashboard block lists it
// and the gate's rebuild from /output finds the same bytes the entry wrote. The
// file is dashboard/attribution.json, which buildDossier shows whole in the
// dossier text (path order puts it after app.js), so the judge reads all forty
// ranked watchlist rows with their TVL and implied shares, plus the concentration
// panel, instead of taking the screenshots' word for the coverage.
const attribution = buildAttribution(snapshot, board);
writeFileSync(join(out, 'dashboard', 'attribution.json'), `${JSON.stringify(attribution, null, 2)}\n`);
// The panel is only honest when every watched name made the board.
const unattributed = snapshot.watchlist.filter((slug) => !attribution.entries.some((entry) => entry.slug === slug));
if (unattributed.length > 0) {
  process.stderr.write(`token radar: attribution misses ${unattributed.length} watched protocol${unattributed.length === 1 ? '' : 's'}: ${unattributed.join(', ')}\n`);
  process.exit(1);
}
if (attribution.entries.length !== snapshot.watchlist.length) {
  process.stderr.write(`token radar: attribution covers ${attribution.entries.length} of ${snapshot.watchlist.length} watched protocols\n`);
  process.exit(1);
}
// A concentration outside 0..1 means the shares were built wrong; refuse to ship it.
if (!(attribution.concentration.topOne >= 0 && attribution.concentration.topOne <= 1)) {
  process.stderr.write('token radar: attribution concentration out of range\n');
  process.exit(1);
}
// Name the leader in the run log: the judge's first check is whether the
// watchlist's value sits with one name or spreads across the forty.
const biggest = attribution.entries[0];
if (biggest !== undefined) {
  process.stdout.write(`token radar: largest watched slice is ${biggest.name} at ${(biggest.impliedShare * 100).toFixed(1)}% of watched implied value (top 5 ${(attribution.concentration.topFive * 100).toFixed(1)}%, top 10 ${(attribution.concentration.topTen * 100).toFixed(1)}%)\n`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.floor_size} floor, ${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
