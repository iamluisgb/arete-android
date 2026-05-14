import { describe, it, expect } from 'vitest';
import { runToGpx, gpxFilename } from '../www/js/export/gpx-exporter.js';

const T0 = Date.parse('2026-05-10T08:00:00Z');
const sampleLog = {
  id: T0,
  date: '2026-05-10',
  session: 'Tirada larga',
  type: 'zona2',
  distance: 10.05,
  duration: 3600,
  notes: 'Sensaciones buenas',
};

const sampleHeavy = {
  route: {
    coords: [
      [40.4168, -3.7038, 650.2, T0],
      [40.4172, -3.7041, 651.0, T0 + 5000],
      [40.4176, -3.7045, 652.5, T0 + 10000],
    ],
  },
  hrTimeSeries: [
    [T0, 130],
    [T0 + 5000, 142],
    [T0 + 10000, 148],
  ],
};

describe('runToGpx', () => {
  it('produces well-formed GPX 1.1 XML', () => {
    const gpx = runToGpx(sampleLog, sampleHeavy);
    expect(gpx).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(gpx).toMatch(/<gpx version="1\.1"/);
    expect(gpx).toMatch(/xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/);
    expect(gpx).toMatch(/xmlns:gpxtpx=/);
  });

  it('emits one <trkpt> per coord', () => {
    const gpx = runToGpx(sampleLog, sampleHeavy);
    const count = (gpx.match(/<trkpt /g) || []).length;
    expect(count).toBe(3);
  });

  it('writes ISO 8601 timestamps on <time>', () => {
    const gpx = runToGpx(sampleLog, sampleHeavy);
    expect(gpx).toMatch(/<time>2026-05-10T08:00:00\.000Z<\/time>/);
    expect(gpx).toMatch(/<time>2026-05-10T08:00:05\.000Z<\/time>/);
  });

  it('embeds HR via gpxtpx extension when aligned in time', () => {
    const gpx = runToGpx(sampleLog, sampleHeavy);
    expect(gpx).toMatch(/<gpxtpx:hr>130<\/gpxtpx:hr>/);
    expect(gpx).toMatch(/<gpxtpx:hr>142<\/gpxtpx:hr>/);
    expect(gpx).toMatch(/<gpxtpx:hr>148<\/gpxtpx:hr>/);
  });

  it('omits HR when there is no hrTimeSeries', () => {
    const gpx = runToGpx(sampleLog, { route: sampleHeavy.route });
    expect(gpx).not.toContain('gpxtpx:hr');
  });

  it('omits HR for trackpoints more than 30s away from any sample', () => {
    const heavy = {
      route: { coords: [[40, -3, 100, 2000_000_000_000]] },
      hrTimeSeries: [[1000_000_000_000, 140]],  // 1B ms ≈ 31 years away
    };
    const gpx = runToGpx({ id: 1, date: '2026-05-10' }, heavy);
    expect(gpx).not.toContain('gpxtpx:hr');
  });

  it('escapes XML special chars in session/notes', () => {
    const log = { ...sampleLog, session: 'Tirada <larga> & "rápida"' };
    const gpx = runToGpx(log, sampleHeavy);
    expect(gpx).toContain('&lt;larga&gt;');
    expect(gpx).toContain('&amp;');
    expect(gpx).toContain('&quot;');
    expect(gpx).not.toContain('<larga>');
  });

  it('returns null when there are no coords', () => {
    expect(runToGpx(sampleLog, { route: { coords: [] } })).toBeNull();
    expect(runToGpx(sampleLog, {})).toBeNull();
    expect(runToGpx(null, sampleHeavy)).toBeNull();
  });

  it('handles missing altitude (0) by omitting the <ele> tag', () => {
    const heavy = { route: { coords: [[40, -3, 0, 1715688000000]] } };
    const gpx = runToGpx(sampleLog, heavy);
    expect(gpx).not.toMatch(/<ele>/);
  });

  it('preserves coord precision (6 decimals for lat/lng)', () => {
    const gpx = runToGpx(sampleLog, sampleHeavy);
    expect(gpx).toContain('lat="40.4168" lon="-3.7038"');
    expect(gpx).toContain('lat="40.4172" lon="-3.7041"');
  });
});

describe('gpxFilename', () => {
  it('uses date + slug of session', () => {
    expect(gpxFilename({ date: '2026-05-10', session: 'Tirada larga' })).toBe('2026-05-10_tirada-larga.gpx');
  });

  it('falls back to type when no session', () => {
    expect(gpxFilename({ date: '2026-05-10', type: 'zona2' })).toBe('2026-05-10_zona2.gpx');
  });

  it('falls back to id when no session/type', () => {
    expect(gpxFilename({ date: '2026-05-10', id: 123 })).toBe('2026-05-10_123.gpx');
  });

  it('strips accents and non-ascii from the label', () => {
    expect(gpxFilename({ date: '2026-05-10', session: 'Súbida á cima' })).toBe('2026-05-10_subida-a-cima.gpx');
  });

  it('uses "run" date placeholder when date is bad', () => {
    expect(gpxFilename({ date: 'bad', session: 'easy' })).toBe('run_easy.gpx');
  });
});
