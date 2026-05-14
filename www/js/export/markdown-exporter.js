/**
 * Markdown exporter for v5 strength workouts.
 *
 * Output is a plain `.md` with YAML frontmatter + an `## ` section per exercise.
 * Designed to drop into Obsidian or any text-first PKM without parsing — coaches
 * who read .md and grep for PRs can ingest the file as-is.
 *
 * The frontmatter carries the machine-readable fields (ids, timestamps,
 * exerciseId, exercise catalog references) so a future re-import is trivial.
 */

import { getExercise } from '../exercise-catalog.js';

function escapeYaml(s) {
  const str = String(s ?? '');
  if (str === '') return '""';
  // Quote whenever the string would otherwise be ambiguous as YAML
  if (/[:#"'`{}[\],&*?|<>=!%@\\\n]|^\s|\s$/.test(str)) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

function repsCell(set) {
  if (set.reps == null && set.durationSec == null) return '—';
  if (set.durationSec != null) {
    const m = Math.floor(set.durationSec / 60);
    const s = set.durationSec % 60;
    const stamp = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${set.durationSec}s`;
    return set.reps != null ? `${set.reps}× ${stamp}` : stamp;
  }
  return set.repsMax != null ? `${set.reps}-${set.repsMax}` : `${set.reps}`;
}

function kgCell(set) {
  if (set.kg == null) return 'bw';
  return Number.isInteger(set.kg) ? `${set.kg}` : set.kg.toFixed(1);
}

function rpeCell(set) {
  if (set.rpe != null) return `RPE ${set.rpe}`;
  if (set.rir != null) return `RIR ${set.rir}`;
  return '—';
}

function durationStr(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/**
 * Build a Markdown string for one strength workout.
 *
 * @param {object} workout  v5 workout (post-migration).
 * @returns {string}
 */
export function workoutToMarkdown(workout) {
  if (!workout) return '';
  const fm = [];
  fm.push('---');
  fm.push(`id: ${workout.id}`);
  fm.push(`date: ${escapeYaml(workout.date)}`);
  if (workout.session) fm.push(`session: ${escapeYaml(workout.session)}`);
  if (workout.phase != null) fm.push(`phase: ${workout.phase}`);
  if (workout.program) fm.push(`program: ${escapeYaml(workout.program)}`);
  if (workout.startedAt) fm.push(`startedAt: ${workout.startedAt}`);
  if (workout.endedAt) fm.push(`endedAt: ${workout.endedAt}`);
  if (workout.durationSec) fm.push(`durationSec: ${workout.durationSec}`);
  if (workout.bodyweightKg) fm.push(`bodyweightKg: ${workout.bodyweightKg}`);
  if (workout._historical) fm.push('historical: true');
  fm.push('---');
  fm.push('');

  const title = workout.session || `Sesión ${workout.date}`;
  fm.push(`# ${title}`);
  fm.push('');

  const headerBits = [
    workout.date,
    workout.phase != null ? `Fase ${workout.phase}` : null,
    workout.program,
    workout.durationSec ? durationStr(workout.durationSec) : null,
  ].filter(Boolean);
  if (headerBits.length) {
    fm.push(`*${headerBits.join(' · ')}*`);
    fm.push('');
  }

  if (workout.notes) {
    fm.push(`> ${workout.notes.replace(/\n/g, '\n> ')}`);
    fm.push('');
  }

  for (const ex of (workout.exercises || [])) {
    const cat = ex.exerciseId ? getExercise(ex.exerciseId) : null;
    const heading = cat
      ? `${ex.name} \`${ex.exerciseId}\``
      : ex.name;
    fm.push(`## ${heading}`);
    fm.push('');

    if (Array.isArray(ex.sets) && ex.sets.length) {
      fm.push('| Set | kg | reps | RPE/RIR | rest |');
      fm.push('|-----|----|----|---------|------|');
      ex.sets.forEach((s, i) => {
        const rest = s.restSec ? `${s.restSec}s` : '—';
        fm.push(`| ${i + 1} | ${kgCell(s)} | ${repsCell(s)} | ${rpeCell(s)} | ${rest} |`);
      });
      fm.push('');
    }
  }

  if (Array.isArray(workout.prs) && workout.prs.length) {
    fm.push('## PRs');
    fm.push('');
    for (const p of workout.prs) {
      const prev = p.prevKg > 0 ? `${p.prevKg}kg → ` : '';
      fm.push(`- **${p.exercise}**: ${prev}${p.kg}kg`);
    }
    fm.push('');
  }

  return fm.join('\n');
}

/**
 * Filename slug for a workout markdown: "2026-05-10_sesion-a.md".
 */
export function markdownFilename(workout) {
  const date = (workout?.date && /^\d{4}-\d{2}-\d{2}$/.test(workout.date)) ? workout.date : 'workout';
  const labelRaw = workout?.session || `id-${workout?.id ?? 'x'}`;
  const label = String(labelRaw)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workout';
  return `${date}_${label}.md`;
}
