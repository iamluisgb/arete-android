/**
 * Canonical exercise catalog — strength training only.
 *
 * Each entry maps an internal slug (`id`) to:
 *  - human-readable names in ES/EN
 *  - Health Connect's `ExerciseSegmentType` constant (Android API)
 *  - FIT format `exercise_category` + `exercise_name` enums (Garmin)
 *
 * `null` in any mapping means "no clean standard equivalent" — the exporter
 * should fall back to a generic category (e.g. `OTHER`) and stash the original
 * name in notes/description.
 *
 * Source: real exercises from www/programs/arete.json + kettlebell.json (audit 2026-05-14).
 * Grow this on demand: when a workout's `findExerciseId(name)` returns null,
 * the exporter logs it and we add it to the catalog in a follow-up.
 */

export const EXERCISES = [
  // ── Barbell big lifts ─────────────────────────────────────
  { id: 'back_squat',          name_es: 'Sentadilla',                 name_en: 'Back Squat',          aliases: ['squat', 'sentadilla trasera'],         healthConnectSegment: 'BARBELL_SQUAT',   fitCategory: 'squat',          fitName: 'back_squat' },
  { id: 'front_squat',         name_es: 'Sentadilla Frontal',         name_en: 'Front Squat',         aliases: ['sent frontal'],                         healthConnectSegment: 'FRONT_SQUAT',     fitCategory: 'squat',          fitName: 'front_squat' },
  { id: 'bulgarian_squat',     name_es: 'Sentadilla Búlgara',         name_en: 'Bulgarian Split Squat', aliases: ['split squat búlgara'],               healthConnectSegment: 'SINGLE_LEG_SQUAT', fitCategory: 'squat',         fitName: 'split_squat' },
  { id: 'deadlift',            name_es: 'Peso Muerto',                name_en: 'Deadlift',            aliases: ['deadlift convencional', 'pm'],          healthConnectSegment: 'DEADLIFT',        fitCategory: 'deadlift',       fitName: 'deadlift' },
  { id: 'sumo_deadlift',       name_es: 'Peso Muerto Sumo',           name_en: 'Sumo Deadlift',       aliases: ['deadlift sumo'],                        healthConnectSegment: 'DEADLIFT',        fitCategory: 'deadlift',       fitName: 'sumo_deadlift' },
  { id: 'single_leg_deadlift', name_es: 'Peso Muerto a 1 Pierna',     name_en: 'Single Leg Deadlift', aliases: ['deadlift con 1 pierna', 'pm 1 pierna'], healthConnectSegment: 'DEADLIFT',        fitCategory: 'deadlift',       fitName: 'single_leg_deadlift' },
  { id: 'suitcase_deadlift',   name_es: 'Peso Muerto Maleta',         name_en: 'Suitcase Deadlift',   aliases: ['deadlift maleta'],                      healthConnectSegment: 'DEADLIFT',        fitCategory: 'deadlift',       fitName: 'suitcase_deadlift' },
  { id: 'bench_press',         name_es: 'Press Banca',                name_en: 'Bench Press',         aliases: ['press de banca'],                       healthConnectSegment: 'BARBELL_BENCH_PRESS', fitCategory: 'bench_press', fitName: 'barbell_bench_press' },
  { id: 'overhead_press',      name_es: 'Press Militar',              name_en: 'Overhead Press',      aliases: ['press militar de pie', 'omp', 'press'], healthConnectSegment: 'BARBELL_SHOULDER_PRESS', fitCategory: 'shoulder_press', fitName: 'standing_military_press' },
  { id: 'barbell_row',         name_es: 'Remo con Barra',             name_en: 'Barbell Row',         aliases: ['remo'],                                 healthConnectSegment: 'BARBELL_ROW',     fitCategory: 'row',            fitName: 'barbell_bent_over_row' },

  // ── Bodyweight / gymnastics ──────────────────────────────
  { id: 'pull_up',             name_es: 'Dominada',                   name_en: 'Pull Up',             aliases: ['dominadas'],                            healthConnectSegment: 'PULL_UP',         fitCategory: 'pull_up',        fitName: 'pull_up' },
  { id: 'inverted_row',        name_es: 'Remo Invertido',             name_en: 'Inverted Row',        aliases: ['dominada australiana'],                 healthConnectSegment: 'ROW',             fitCategory: 'row',            fitName: 'inverted_row' },
  { id: 'push_up',             name_es: 'Flexión',                    name_en: 'Push Up',             aliases: ['flexiones', 'flexión de pecho'],        healthConnectSegment: 'PUSH_UP',         fitCategory: 'push_up',        fitName: 'push_up' },
  { id: 'dip',                 name_es: 'Fondo',                      name_en: 'Dip',                 aliases: ['fondos', 'fondos en paralelas'],        healthConnectSegment: 'OTHER_WORKOUT',   fitCategory: 'triceps_extension', fitName: 'dip' },
  { id: 'plank',               name_es: 'Plancha',                    name_en: 'Plank',               aliases: ['plank', 'plancha frontal'],             healthConnectSegment: 'PLANK',           fitCategory: 'plank',          fitName: 'front_plank' },
  { id: 'burpee',              name_es: 'Burpee',                     name_en: 'Burpee',              aliases: ['burpees'],                              healthConnectSegment: 'BURPEE',          fitCategory: 'cardio',         fitName: 'burpee' },

  // ── Kettlebell ───────────────────────────────────────────
  { id: 'kb_swing',            name_es: 'Swing',                      name_en: 'Kettlebell Swing',    aliases: ['kb swing', 'swing 2 manos'],            healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'kettlebell_swing' },
  { id: 'kb_swing_one_arm',    name_es: 'Swing 1 Mano',               name_en: 'One-Arm KB Swing',   aliases: ['swing una mano', 'kb swing 1 brazo'],   healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'single_arm_kettlebell_swing' },
  { id: 'kb_power_swing',      name_es: 'Power Swing',                name_en: 'Power Swing',        aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'kettlebell_swing' },
  { id: 'kb_clean',            name_es: 'Clean (KB)',                 name_en: 'KB Clean',           aliases: ['clean'],                                healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'clean' },
  { id: 'kb_dead_clean',       name_es: 'Dead Clean',                 name_en: 'Dead Clean',         aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'clean' },
  { id: 'kb_clean_and_press',  name_es: 'Clean & Press',              name_en: 'Clean & Press',      aliases: ['c&p'],                                  healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'clean_and_press' },
  { id: 'kb_clean_and_push_press', name_es: 'Clean & Push Press',     name_en: 'Clean & Push Press', aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'clean_and_jerk' },
  { id: 'kb_push_press',       name_es: 'Push Press',                 name_en: 'Push Press',         aliases: [],                                       healthConnectSegment: null, fitCategory: 'shoulder_press', fitName: 'push_press' },
  { id: 'kb_snatch',           name_es: 'Snatch',                     name_en: 'Snatch',             aliases: ['arrancada'],                            healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'snatch' },
  { id: 'kb_dead_snatch',      name_es: 'Dead Snatch',                name_en: 'Dead Snatch',        aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'snatch' },
  { id: 'kb_thruster',         name_es: 'Thruster',                   name_en: 'Thruster',           aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'thruster' },
  { id: 'kb_high_pull',        name_es: 'High Pull',                  name_en: 'High Pull',          aliases: [],                                       healthConnectSegment: null, fitCategory: 'olympic_lift',   fitName: 'high_pull' },
  { id: 'kb_renegade_row',     name_es: 'Renegade Row',               name_en: 'Renegade Row',       aliases: [],                                       healthConnectSegment: null, fitCategory: 'row',            fitName: 'renegade_row' },
  { id: 'kb_windmill',         name_es: 'Windmill',                   name_en: 'Windmill',           aliases: ['windmill bajo', 'windmill alto'],       healthConnectSegment: null, fitCategory: 'core',           fitName: 'windmill' },
  { id: 'turkish_get_up',      name_es: 'Levantamiento Turco',        name_en: 'Turkish Get-Up',     aliases: ['tgu', 'turkish get-up'],                healthConnectSegment: null, fitCategory: 'core',           fitName: 'turkish_get_up' },
  { id: 'kb_around_the_world', name_es: 'Around the World',           name_en: 'Around the World',   aliases: ['ocho'],                                 healthConnectSegment: null, fitCategory: 'core',           fitName: null },

  // ── Accessory / arms ─────────────────────────────────────
  { id: 'barbell_curl',        name_es: 'Curl con Barra',             name_en: 'Barbell Curl',        aliases: ['curl barra'],                          healthConnectSegment: 'BARBELL_BICEPS_CURL', fitCategory: 'curl',     fitName: 'barbell_biceps_curl' },
  { id: 'reverse_curl',        name_es: 'Curl Invertido',             name_en: 'Reverse Curl',        aliases: ['curl invertido con barra'],            healthConnectSegment: 'BICEPS_CURL',     fitCategory: 'curl',           fitName: 'reverse_grip_barbell_biceps_curl' },
];

/**
 * Build lookup maps once on module load. O(1) lookup after init.
 * Normalizes names: lowercase + strip diacritics + collapse spaces.
 */
const _byId = new Map();
const _byName = new Map();

function _normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

for (const ex of EXERCISES) {
  _byId.set(ex.id, ex);
  _byName.set(_normalize(ex.name_es), ex);
  _byName.set(_normalize(ex.name_en), ex);
  for (const a of ex.aliases || []) _byName.set(_normalize(a), ex);
}

/**
 * Find a canonical exercise by free-text name (e.g. from a v4 workout).
 * Strips accents and matches case-insensitively against name_es, name_en and aliases.
 * @param {string} name
 * @returns {string|null} exerciseId or null if not found.
 */
export function findExerciseId(name) {
  if (!name) return null;
  const hit = _byName.get(_normalize(name));
  return hit ? hit.id : null;
}

/** @param {string} id @returns {object|null} */
export function getExercise(id) {
  return _byId.get(id) || null;
}

/** @returns {number} Catalog size (for diagnostics) */
export function catalogSize() {
  return EXERCISES.length;
}
