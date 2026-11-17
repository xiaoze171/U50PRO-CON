import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';

const uni = uniModule.default || uniModule;

// Compile the Android WebView UI; this project has no browser preview server.
export default defineConfig({
  base: './',
  plugins: [uni()]
});
