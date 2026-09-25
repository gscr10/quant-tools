import { BASIC_SAMPLES } from '../samples.ts';
import { LIBRARY } from '../scripts/library/index.ts';

export const PLATFORM_INDICATORS = [
  ...BASIC_SAMPLES.map((entry) => ({
    name: entry.name,
    script: entry.script,
    language: 'pine',
    enabled: false,
    category: 'Examples',
  })),
  ...LIBRARY.map((entry) => ({
    name: entry.name,
    script: entry.script,
    language: 'pine',
    enabled: false,
    category: 'LuxAlgo',
  })),
];
