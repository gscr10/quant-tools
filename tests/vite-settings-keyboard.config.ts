import { mergeConfig } from 'vite';
import config from '../vite.config.ts';

// Independent keyboard sequences must not be interrupted by another worker's
// unrelated edit triggering a development page reload.
export default mergeConfig(config, { server: { hmr: false, watch: null } });
