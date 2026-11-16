// Starts a private Vite dev server for the lifetime of one tool run (screenshots / capture),
// so the tools never depend on a long-running `npm run dev`. Set SHOT_PORT to reuse an external server.
import { createServer } from 'vite';

export async function startServer() {
  if (process.env.SHOT_PORT) return { port: +process.env.SHOT_PORT, close: async () => {} };
  // Windows reserves random port ranges (listen fails with EACCES there), so try a few.
  // (Stay below 6000: Chrome refuses to open several ports above it as "unsafe".)
  let last;
  for (let i = 0; i < 12; i++) {
    const server = await createServer({ logLevel: 'error', clearScreen: false, server: { host: '127.0.0.1', port: 5300 + Math.floor(Math.random() * 690), strictPort: true, hmr: false, watch: null } });
    try {
      await server.listen();
      return { port: server.httpServer.address().port, close: () => server.close() };
    } catch (e) { last = e; await server.close().catch(() => {}); }
  }
  throw last;
}
