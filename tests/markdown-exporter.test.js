import { describe, it, expect } from 'vitest';
import { workoutToMarkdown, markdownFilename } from '../www/js/export/markdown-exporter.js';

const sampleWorkout = {
  id: 1715000000000,
  date: '2026-05-10',
  session: 'Día 1 · Fuerza superior',
  phase: 2,
  program: 'arete',
  notes: 'RPE alto en banca',
  startedAt: 1778414400000,
  endedAt: 1778418900000,
  durationSec: 4500,
  exercises: [
    {
      name: 'Press Banca',
      exerciseId: 'bench_press',
      sets: [
        { kg: 60, reps: 8 },
        { kg: 80, reps: 5, rpe: 7 },
        { kg: 85, reps: 5, rpe: 8 },
        { kg: 90, reps: 5, rpe: 9, isFailure: true },
      ],
    },
    {
      name: 'Dominada',
      exerciseId: 'pull_up',
      sets: [
        { kg: null, reps: 10 },
        { kg: 5, reps: 8 },
      ],
    },
    {
      name: 'Plancha',
      exerciseId: 'plank',
      sets: [{ kg: null, reps: null, durationSec: 60 }],
    },
    {
      name: 'Curl con Barra',
      exerciseId: 'barbell_curl',
      sets: [{ kg: 20, reps: 10, repsMax: 12, restSec: 90 }],
    },
  ],
  prs: [{ exercise: 'Press Banca', kg: 90, prevKg: 87.5 }],
};

describe('workoutToMarkdown', () => {
  it('emits YAML frontmatter with key fields', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain(`id: ${sampleWorkout.id}`);
    expect(md).toContain('date: 2026-05-10');
    expect(md).toContain('phase: 2');
    expect(md).toContain('program: arete');
    expect(md).toContain('startedAt: 1778414400000');
    expect(md).toContain('endedAt: 1778418900000');
    expect(md).toContain('durationSec: 4500');
  });

  it('quotes YAML values that contain colons or other reserved chars', () => {
    const md = workoutToMarkdown({ ...sampleWorkout, session: 'Time: 5x5' });
    expect(md).toMatch(/session: "Time: 5x5"/);
  });

  it('marks _historical: true in frontmatter when present', () => {
    const md = workoutToMarkdown({ ...sampleWorkout, _historical: true });
    expect(md).toContain('historical: true');
  });

  it('uses the session as h1 title', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toContain('# Día 1 · Fuerza superior');
  });

  it('renders notes as a blockquote', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toContain('> RPE alto en banca');
  });

  it('emits one ## section per exercise with the canonical id', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toContain('## Press Banca `bench_press`');
    expect(md).toContain('## Dominada `pull_up`');
    expect(md).toContain('## Plancha `plank`');
  });

  it('renders bodyweight as "bw" in the kg column', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toMatch(/\| 1 \| bw \| 10 \|/);
  });

  it('renders duration sets in mm:ss', () => {
    const md = workoutToMarkdown(sampleWorkout);
    // Plank: durationSec=60 → "1:00"
    expect(md).toMatch(/\| 1 \| bw \| 1:00 \|/);
  });

  it('renders rep ranges as "10-12"', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toMatch(/\| 1 \| 20 \| 10-12 \|/);
  });

  it('renders RPE/RIR in the dedicated column', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toMatch(/\| 60 \| 8 \| — \|/);     // no RPE
    expect(md).toMatch(/\| 80 \| 5 \| RPE 7 \|/);
    expect(md).toMatch(/\| 90 \| 5 \| RPE 9 \|/);
  });

  it('renders restSec when present', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toMatch(/\| 20 \| 10-12 \|.*\| 90s \|/);
  });

  it('renders PRs section when present', () => {
    const md = workoutToMarkdown(sampleWorkout);
    expect(md).toContain('## PRs');
    expect(md).toContain('**Press Banca**: 87.5kg → 90kg');
  });

  it('returns empty string for null input', () => {
    expect(workoutToMarkdown(null)).toBe('');
  });
});

describe('markdownFilename', () => {
  it('uses date + slug of session', () => {
    expect(markdownFilename({ date: '2026-05-10', session: 'Día 1 · Fuerza superior' }))
      .toBe('2026-05-10_dia-1-fuerza-superior.md');
  });

  it('falls back to id when no session', () => {
    expect(markdownFilename({ date: '2026-05-10', id: 42 })).toBe('2026-05-10_id-42.md');
  });

  it('strips accents', () => {
    expect(markdownFilename({ date: '2026-05-10', session: 'Sesión Á' })).toBe('2026-05-10_sesion-a.md');
  });
});
