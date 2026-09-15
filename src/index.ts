import { buildServer } from './api/server.js';
import { config } from './config/index.js';

async function main() {
  const server = buildServer();

  try {
    await server.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`
=============================================================
  🚀 Universal Payment Aggregator & UPI Direct Switch Engine
=============================================================
  • Status: Online
  • Environment: ${config.nodeEnv}
  • Server listening at: http://${config.host}:${config.port}
  • Interactive Sandbox Demo: http://localhost:${config.port}/demo/index.html
  • Health Check: http://localhost:${config.port}/health
=============================================================
  Acquiring Bank Integrations:
  - HDFC Bank Direct (SmartHub / UPI Direct)
  - ICICI Bank Direct (Eazypay Composite API)
  - Axis Bank Direct (Merchant UPI Gateway)
  - Universal Mock Bank Sandbox
=============================================================
`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
