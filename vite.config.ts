import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: ['.monkeycode-ai.online'],
  },
});
