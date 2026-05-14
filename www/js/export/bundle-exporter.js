/**
 * Complete export bundle: a single .zip with:
 *   - arete-backup.json     full DB (same shape as exportData())
 *   - runs/*.gpx            one file per running log that has a route
 *   - workouts/*.md         one file per strength workout (v5)
 *   - README.txt            human pointer to where each format opens
 *
 * JSZip is loaded lazily from unpkg the first time the user exports
 * (same CDN pattern as Leaflet in app.html). This keeps the cold-start
 * bundle small — most users never click "Export everything".
 */

import { getAllRoutes } from '../data.js';
import { runToGpx, gpxFilename } from './gpx-exporter.js';
import { workoutToMarkdown, markdownFilename } from './markdown-exporter.js';

const JSZIP_CDN = 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js';
let _jsZipPromise = null;

/** Lazy-load JSZip from CDN. Cached after the first call. */
function loadJSZip() {
  if (typeof window !== 'undefined' && window.JSZip) return Promise.resolve(window.JSZip);
  if (_jsZipPromise) return _jsZipPromise;
  _jsZipPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_CDN;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (window.JSZip) resolve(window.JSZip);
      else reject(new Error('JSZip loaded but window.JSZip is undefined'));
    };
    s.onerror = () => reject(new Error('JSZip CDN load failed (offline?)'));
    document.head.appendChild(s);
  });
  return _jsZipPromise;
}

const README = [
  'Areté export bundle',
  '',
  '  arete-backup.json    Full database — import this back into Areté to restore.',
  '  runs/*.gpx           GPS tracks (GPX 1.1). Opens in Strava, Garmin Connect,',
  '                       TrainingPeaks, Wahoo, Intervals.icu.',
  '  workouts/*.md        Strength sessions (Markdown + YAML frontmatter).',
  '                       Drop into Obsidian, Logseq, or any text editor.',
  '',
].join('\n');

/**
 * Build the zip blob in memory and trigger a browser download.
 *
 * @param {object} db                 Full db loaded via loadDB().
 * @param {object} [opts]
 * @param {(p:{stage:string,pct:number})=>void} [opts.onProgress]  Optional progress callback.
 */
export async function exportBundle(db, { onProgress } = {}) {
  const report = (stage, pct) => onProgress?.({ stage, pct });
  report('Cargando librería de ZIP', 0);
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  zip.file('README.txt', README);

  // ── Full DB (with heavy fields reconstructed) ────────────
  report('Backup JSON', 5);
  const routes = (db.runningLogs?.length) ? await getAllRoutes() : new Map();
  const fullDB = db.runningLogs?.length
    ? { ...db, runningLogs: db.runningLogs.map(l => {
        const heavy = routes.get(l.id);
        return heavy ? { ...l, ...heavy } : l;
      })}
    : db;
  zip.file('arete-backup.json', JSON.stringify(fullDB, null, 2));

  // ── Runs → GPX ───────────────────────────────────────────
  const runs = db.runningLogs || [];
  let runsWithRoute = 0;
  for (let i = 0; i < runs.length; i++) {
    const log = runs[i];
    const heavy = routes.get(log.id);
    if (!heavy?.route?.coords?.length) continue;
    const gpx = runToGpx(log, heavy);
    if (gpx) {
      zip.file(`runs/${gpxFilename(log)}`, gpx);
      runsWithRoute++;
    }
    report(`Carreras (${i + 1}/${runs.length})`, 20 + (i / Math.max(runs.length, 1)) * 30);
  }

  // ── Strength workouts → Markdown ─────────────────────────
  const workouts = db.workouts || [];
  for (let i = 0; i < workouts.length; i++) {
    const w = workouts[i];
    const md = workoutToMarkdown(w);
    if (md) zip.file(`workouts/${markdownFilename(w)}`, md);
    report(`Sesiones (${i + 1}/${workouts.length})`, 50 + (i / Math.max(workouts.length, 1)) * 30);
  }

  // ── Generate + trigger download ──────────────────────────
  report('Comprimiendo', 85);
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => report('Comprimiendo', 85 + meta.percent * 0.14),
  );
  report('Descargando', 99);

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arete-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  report('Completado', 100);
  return {
    workouts: workouts.length,
    runs: runs.length,
    runsWithRoute,
  };
}
