import { describe, it, expect } from 'vitest';
import { EXERCISES, findExerciseId, getExercise, catalogSize } from '../www/js/exercise-catalog.js';

describe('exercise-catalog structure', () => {
  it('has a non-trivial number of exercises', () => {
    expect(catalogSize()).toBeGreaterThan(20);
  });

  it('every entry has required fields', () => {
    for (const ex of EXERCISES) {
      expect(ex.id).toMatch(/^[a-z0-9_]+$/);
      expect(typeof ex.name_es).toBe('string');
      expect(typeof ex.name_en).toBe('string');
      expect(Array.isArray(ex.aliases)).toBe(true);
    }
  });

  it('has no duplicate ids', () => {
    const ids = EXERCISES.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findExerciseId', () => {
  it('matches by Spanish name', () => {
    expect(findExerciseId('Sentadilla')).toBe('back_squat');
    expect(findExerciseId('Peso Muerto')).toBe('deadlift');
  });

  it('matches by English name', () => {
    expect(findExerciseId('Back Squat')).toBe('back_squat');
    expect(findExerciseId('Pull Up')).toBe('pull_up');
  });

  it('matches by alias', () => {
    expect(findExerciseId('squat')).toBe('back_squat');
    expect(findExerciseId('dominadas')).toBe('pull_up');
  });

  it('is accent-insensitive', () => {
    expect(findExerciseId('Sentadilla Búlgara')).toBe('bulgarian_squat');
    expect(findExerciseId('Flexión')).toBe('push_up');
  });

  it('is case-insensitive', () => {
    expect(findExerciseId('SENTADILLA')).toBe('back_squat');
    expect(findExerciseId('sentadilla')).toBe('back_squat');
  });

  it('returns null for empty/null/unknown', () => {
    expect(findExerciseId(null)).toBeNull();
    expect(findExerciseId('')).toBeNull();
    expect(findExerciseId('Ejercicio que no existe')).toBeNull();
  });

  it('matches real names from arete.json programs', () => {
    // Sample of names actually present in www/programs/arete.json
    const realNames = [
      'Sentadilla', 'Peso Muerto', 'Press Banca', 'Press Militar',
      'Dominada', 'Remo Invertido', 'Curl con Barra', 'Curl Invertido',
      'Burpees', 'Sentadilla Frontal',
    ];
    for (const n of realNames) {
      expect(findExerciseId(n), `expected match for "${n}"`).not.toBeNull();
    }
  });

  it('matches kettlebell program names', () => {
    const kbNames = [
      'Swing', 'Swing 1 Mano', 'Clean', 'Clean & Press',
      'Snatch', 'Thruster', 'Levantamiento Turco', 'Renegade Row',
    ];
    for (const n of kbNames) {
      expect(findExerciseId(n), `expected match for "${n}"`).not.toBeNull();
    }
  });
});

describe('getExercise', () => {
  it('returns the entry for a known id', () => {
    const ex = getExercise('back_squat');
    expect(ex.name_es).toBe('Sentadilla');
    expect(ex.fitName).toBe('back_squat');
  });

  it('returns null for unknown id', () => {
    expect(getExercise('does_not_exist')).toBeNull();
  });
});
