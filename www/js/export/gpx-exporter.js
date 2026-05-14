/**
 * GPX 1.1 exporter for running logs.
 *
 * Output is compatible with Strava, Garmin Connect, TrainingPeaks, Wahoo,
 * Intervals.icu and any tool that consumes the GPX 1.1 standard.
 * Heart rate is encoded with the `gpxtpx:TrackPointExtension` namespace
 * (Garmin's de-facto convention).
 *
 * @typedef {Object} RunLog            See www/js/ui/running-tracker.js getResult()
 * @typedef {Object} RunHeavy          Loaded from IndexedDB via loadRunRoute(id)
 * @property {{coords: number[][]}} [route]  Each coord is [lat, lng, alt, epochMs]
 * @property {Array<[number, number]>} [hrTimeSeries]  [[epochMs, bpm], ...]
 */

const GPX_NS = 'http://www.topografix.com/GPX/1/1';
const GPXTPX_NS = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoFromEpoch(ms) {
  return new Date(ms).toISOString();
}

/**
 * Lookup HR at a given epoch ms.
 * Uses linear search with a stateful cursor — hrTimeSeries is monotonically
 * increasing and the caller walks coords in order, so per-point cost is amortized O(1).
 */
function makeHrLookup(hrTimeSeries) {
  if (!Array.isArray(hrTimeSeries) || hrTimeSeries.length === 0) {
    return () => null;
  }
  let cursor = 0;
  return (ts) => {
    while (cursor + 1 < hrTimeSeries.length && hrTimeSeries[cursor + 1][0] <= ts) {
      cursor++;
    }
    const [hrTs, bpm] = hrTimeSeries[cursor];
    // Only accept HR samples within 30 s of the trackpoint to avoid stale data.
    if (Math.abs(ts - hrTs) > 30_000) return null;
    return Number.isFinite(bpm) ? bpm : null;
  };
}

/**
 * Build a GPX 1.1 XML string for one run.
 *
 * @param {RunLog}   log     The flat run record (date, type, distance, etc.)
 * @param {RunHeavy} heavy   The IDB blob with route + hrTimeSeries.
 * @returns {string|null} GPX XML, or null if there is no usable route data.
 */
export function runToGpx(log, heavy) {
  if (!log || !heavy?.route?.coords?.length) return null;
  const coords = heavy.route.coords;
  const hrLookup = makeHrLookup(heavy.hrTimeSeries);

  const startMs = coords[0][3] ?? log.id ?? Date.now();
  const name = log.session || log.type || 'Run';
  const description = [
    log.distance != null ? `${log.distance.toFixed(2)} km` : null,
    log.duration != null ? `${Math.round(log.duration / 60)} min` : null,
    log.notes,
  ].filter(Boolean).join(' · ');

  const trkpts = coords.map(([lat, lng, alt, ts]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    const hr = ts ? hrLookup(ts) : null;
    const lines = [`    <trkpt lat="${lat}" lon="${lng}">`];
    if (Number.isFinite(alt) && alt !== 0) lines.push(`      <ele>${alt}</ele>`);
    if (ts) lines.push(`      <time>${isoFromEpoch(ts)}</time>`);
    if (hr != null) {
      lines.push(
        '      <extensions>',
        '        <gpxtpx:TrackPointExtension>',
        `          <gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr>`,
        '        </gpxtpx:TrackPointExtension>',
        '      </extensions>'
      );
    }
    lines.push('    </trkpt>');
    return lines.join('\n');
  }).filter(Boolean).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Areté" xmlns="${GPX_NS}" xmlns:gpxtpx="${GPXTPX_NS}">`,
    '  <metadata>',
    `    <name>${escapeXml(name)}</name>`,
    description ? `    <desc>${escapeXml(description)}</desc>` : '',
    `    <time>${isoFromEpoch(startMs)}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
    '    <type>running</type>',
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].filter(Boolean).join('\n');
}

/**
 * Derive a safe filename slug for a run: "2026-05-10_lateral-meadow.gpx".
 * Falls back to id if no session/type/date is present.
 */
export function gpxFilename(log) {
  const date = (log?.date && /^\d{4}-\d{2}-\d{2}$/.test(log.date)) ? log.date : 'run';
  const labelRaw = log?.session || log?.type || String(log?.id ?? 'run');
  const label = String(labelRaw)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'run';
  return `${date}_${label}.gpx`;
}
