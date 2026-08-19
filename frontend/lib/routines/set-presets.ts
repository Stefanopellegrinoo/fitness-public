import type { SetPlanSeed } from './routine-mapping';

export type Preset = { id: string; label: string; build: () => SetPlanSeed[] };

const working = (n: number): SetPlanSeed[] =>
  Array.from({ length: n }, () => ({ setType: 'WORKING', repsMin: 8, repsMax: 12 }));

export const SET_PRESETS: Preset[] = [
  { id: 'straight', label: 'Sets rectos', build: () => working(3) },
  {
    id: 'top-backoff',
    label: 'Top + Backoff',
    build: () => [
      { setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9 },
      ...Array.from({ length: 3 }, (): SetPlanSeed => ({ setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 })),
    ],
  },
  {
    id: 'drop',
    label: 'Drop set',
    build: () => [
      { setType: 'WORKING', repsMin: 8, repsMax: 10 },
      { setType: 'DROP', repsMin: 8, repsMax: 12, percentOfTopSet: 80 },
      { setType: 'DROP', repsMin: 8, repsMax: 12, percentOfTopSet: 60 },
    ],
  },
  {
    id: 'myo',
    label: 'Myo-reps',
    build: () => [
      { setType: 'WORKING', repsMin: 12, repsMax: 15, targetRpe: 9 },
      ...Array.from({ length: 3 }, (): SetPlanSeed => ({ setType: 'MYOREP', repsMin: 3, repsMax: 5 })),
    ],
  },
  {
    id: 'rest-pause',
    label: 'Rest-pause',
    build: () => [
      { setType: 'WORKING', repsMin: 6, repsMax: 8, targetRpe: 9 },
      ...Array.from({ length: 2 }, (): SetPlanSeed => ({ setType: 'RESTPAUSE', repsMin: 2, repsMax: 4 })),
    ],
  },
  {
    id: 'pyramid',
    label: 'Pirámide',
    build: () => [
      { setType: 'WORKING', repsMin: 12, repsMax: 12 },
      { setType: 'WORKING', repsMin: 10, repsMax: 10 },
      { setType: 'WORKING', repsMin: 8, repsMax: 8 },
    ],
  },
  {
    id: 'amrap',
    label: 'AMRAP finisher',
    build: () => [
      ...Array.from({ length: 2 }, (): SetPlanSeed => ({ setType: 'WORKING', repsMin: 8, repsMax: 10 })),
      { setType: 'AMRAP', repsMin: 1 },
    ],
  },
  { id: 'empty', label: 'Vacío', build: () => [{ setType: 'WORKING' }] },
];
