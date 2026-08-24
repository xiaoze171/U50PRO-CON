import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';

const uni = uniModule.default || uniModule;

const routerOrigin = process.env.ROUTER_ORIGIN || 'http://192.168.0.1';

export default defineConfig({
  base: './',
  plugins: [uni()],
  server: {
    host: '0.0.0.0',
    port: 5120,
    strictPort: false,
    proxy: {
      '/router-api': {
        target: routerOrigin,
        changeOrigin: true,
        cookieDomainRewrite: '',
        cookiePathRewrite: '/',
        rewrite: path => path.replace(/^\/router-api/, ''),
        configure(proxy) {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.setHeader('Origin', routerOrigin);
            proxyReq.setHeader('Referer', `${routerOrigin}/index.html`);
            proxyReq.setHeader('X-Requested-With', 'XMLHttpRequest');
          });
        }
      }
    }
  }
});
