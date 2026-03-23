import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { router } from './apiRoutes';
import { initWebSocket } from './wsHandler';

// ─────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────

const WEB_PORT   = parseInt(process.env.WEB_PORT || '3000');
const STATIC_DIR = join(__dirname, '../../public');

// ─────────────────────────────────────────────
// INIT WEB SERVER
// ─────────────────────────────────────────────

export const initWebServer = () => {
    const app    = express();
    const server = createServer(app);
    const wss    = new WebSocketServer({ server, path: '/ws' });

    app.use(express.json());
    app.use(express.static(STATIC_DIR));

    // REST API
    app.use('/api', router);

    // SPA fallback
    app.use((_req, res) => res.sendFile(join(STATIC_DIR, 'index.html')));

    // WebSocket
    initWebSocket(wss);

    server.listen(WEB_PORT, () => {
        console.log(`🌐 Web SK aktif di http://localhost:${WEB_PORT}`);
    });

    return server;
};