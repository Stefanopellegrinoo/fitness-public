import type { SetType } from '../types/api.types';

export const SET_TYPE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'WORKING', label: 'Working' },
  { value: 'WARMUP', label: 'Entrada en calor' },
  { value: 'TOP', label: 'Top set' },
  { value: 'BACKOFF', label: 'Back-off' },
  { value: 'DROP', label: 'Drop set' },
  { value: 'MYOREP', label: 'Myo-reps' },
  { value: 'RESTPAUSE', label: 'Rest-pause' },
  { value: 'AMRAP', label: 'AMRAP' },
];
