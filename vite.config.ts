import http from 'http';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/**
 * Dynamic ESP32 Proxy Plugin
 * Dynamically proxies camera stream, IMU telemetry, and hardware control
 * to whatever IP is supplied via ?ip=<target_ip> query parameter from the UI.
 * This completely eliminates the need to edit code when Wi-Fi IP address changes.
 */
function dynamicEsp32ProxyPlugin() {
  return {
    name: 'dynamic-esp32-proxy',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url) return next();

        // 1. Dynamic ESP32-CAM MJPEG Stream Proxy (?ip=xxx&port=81)
        if (req.url.startsWith('/esp32-stream')) {
          const url = new URL(req.url, 'http://localhost');
          const targetIp = url.searchParams.get('ip') || process.env.ESP32_IP || '10.65.112.143';
          const targetPort = url.searchParams.get('port') || '81';

          const proxyReq = http.request(
            {
              hostname: targetIp,
              port: parseInt(targetPort, 10),
              path: '/stream',
              method: 'GET',
              timeout: 0,
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
              });
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', (err) => {
            console.warn(`[ESP32 Stream Proxy] Unreachable at http://${targetIp}:${targetPort}/stream -`, err.message);
            if (!res.headersSent) {
              res.writeHead(502, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(`ESP32 camera unreachable at http://${targetIp}:${targetPort}/stream`);
            }
          });

          req.on('close', () => {
            proxyReq.destroy();
          });

          proxyReq.end();
          return;
        }

        // 2. Dynamic ESP32 MPU6050 IMU Telemetry Proxy (?ip=xxx)
        if (req.url.startsWith('/esp32-imu')) {
          const url = new URL(req.url, 'http://localhost');
          const targetIp = url.searchParams.get('ip') || process.env.ESP32_IP || '10.65.112.143';

          const proxyReq = http.request(
            {
              hostname: targetIp,
              port: 80,
              path: '/imu',
              method: 'GET',
              timeout: 3000,
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, {
                ...proxyRes.headers,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', (err) => {
            if (!res.headersSent) {
              res.writeHead(502, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(JSON.stringify({ error: `ESP32 IMU unreachable at ${targetIp}`, status: 'offline' }));
            }
          });

          req.on('close', () => {
            proxyReq.destroy();
          });

          proxyReq.end();
          return;
        }

        // 3. Dynamic ESP32 Control & Alert Command Proxy (?ip=xxx)
        if (req.url.startsWith('/esp32-cmd')) {
          const url = new URL(req.url, 'http://localhost');
          const targetIp = url.searchParams.get('ip') || process.env.ESP32_IP || '10.65.112.143';
          const cmdPath = url.pathname.replace(/^\/esp32-cmd/, '') || '/control';

          const proxyReq = http.request(
            {
              hostname: targetIp,
              port: 80,
              path: cmdPath + url.search,
              method: req.method || 'GET',
              timeout: 3000,
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
              });
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
              res.end(`ESP32 control unreachable at ${targetIp}`);
            }
          });

          req.pipe(proxyReq);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), dynamicEsp32ProxyPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/esp32-stream': {
          target: `http://${process.env.ESP32_IP || '10.65.112.143'}:81`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/esp32-stream/, '/stream'),
          timeout: 0,
        },
        '/esp32-imu': {
          target: `http://${process.env.ESP32_IP || '10.65.112.143'}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/esp32-imu/, '/imu'),
          timeout: 5000,
        },
        '/esp32-cmd': {
          target: `http://${process.env.ESP32_IP || '10.65.112.143'}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/esp32-cmd/, '/control'),
          timeout: 5000,
        },
      },
    },
  };
});
