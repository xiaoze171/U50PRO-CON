import { defineConfig } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';
import { batteryProxyMiddleware } from './dev/battery-proxy.js';

const uni = uniModule.default || uniModule;

const routerOrigin = process.env.ROUTER_ORIGIN || 'http://192.168.0.1';

export default defineConfig({
  base: './',
  plugins: [uni(), {
    name: 'battery-endpoint-proxy',
    configureServer(server) { server.middlewares.use('/battery-api', batteryProxyMiddleware); }
  }],
  server: {
    host: '0.0.0.0',
    port: 5120,
    strictPort: false,
    // Android 构建产物不参与开发页面的热更新。
    watch: { ignored: ['**/android-wrapper/app/build/**'] },
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
      },
      // 原厂后台内嵌：页面从 /router-api/index.html 载入后，原厂 JS 用绝对路径
      // /goform/... 调接口，落到本服务器根路径，需同样转发到路由器。
      // 会话 Cookie 经 cookiePathRewrite 绑定在本站根路径，与 App 共享同一会话。
      '/goform': {
        target: routerOrigin,
        changeOrigin: true,
        cookieDomainRewrite: '',
        cookiePathRewrite: '/',
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
