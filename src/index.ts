/**
 * MCP TFS 2018 Server — Entry Point
 *
 * Supports two transport modes:
 *   - stdio  (default, used by MCP clients like Claude Desktop)
 *   - http   (for HTTP/SSE-based integrations — set MCP_TRANSPORT=http)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';
import { TfsConfigError } from './utils/errors.js';
import { notifyIfUpdateAvailable } from './utils/version-check.js';

async function main(): Promise<void> {
  // Validate config eagerly so we fail fast with a clear message
  let server;
  try {
    server = createServer();
  } catch (err) {
    if (err instanceof TfsConfigError) {
      logger.error(`Configuration error: ${err.message}`);
      logger.error('Check your .env file against .env.example');
      process.exit(1);
    }
    throw err;
  }

  const transport = process.env.MCP_TRANSPORT ?? 'stdio';

  if (transport === 'stdio') {
    logger.info('Starting MCP server on stdio transport');
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    logger.info('MCP TFS 2018 server running — waiting for requests');
    void notifyIfUpdateAvailable();
  } else {
    // HTTP/SSE transport — requires @modelcontextprotocol/sdk >= 1.1
    logger.error(`Transport "${transport}" is not yet supported in this build. Use MCP_TRANSPORT=stdio.`);
    process.exit(1);
  }
}

// ─── Process lifecycle ────────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  process.exit(1);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received — shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down');
  process.exit(0);
});

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`Fatal error during startup: ${msg}`);
  process.exit(1);
});
