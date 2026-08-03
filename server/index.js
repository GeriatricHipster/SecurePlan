import 'dotenv/config';
import { createApplication } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const runtime = createApplication();

runtime.httpServer.requestTimeout = 10 * 60 * 1000;
runtime.httpServer.headersTimeout = 65 * 1000;
runtime.httpServer.keepAliveTimeout = 60 * 1000;
runtime.httpServer.on('error', (error) => {
  console.error('SecurePlan HTTP server failed.', error);
  process.exitCode = 1;
});

runtime.httpServer.listen(port, host, () => {
  console.log(`SecurePlan is listening on ${runtime.config.frontendOrigin || `http://${host}:${port}`}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down SecurePlan.`);
  const forceExit = setTimeout(() => process.exit(1), 10000).unref();
  try {
    await runtime.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('Graceful shutdown failed.', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export const app = runtime.app;
export const httpServer = runtime.httpServer;
export default runtime;
