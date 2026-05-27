import winston from 'winston';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ─── Pretty format for development ───────────────────────────────────────────

const prettyFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
  const stackStr = stack ? `\n${stack}` : '';
  return `${ts} [${level}] ${message}${metaStr}${stackStr}`;
});

// ─── Logger factory ───────────────────────────────────────────────────────────

function createLogger(): winston.Logger {
  const logLevel = process.env.LOG_LEVEL ?? 'info';
  const logFormat = process.env.LOG_FORMAT ?? 'pretty';
  const isJson = logFormat === 'json';

  const transports: winston.transport[] = [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test',
      // MCP stdio transport uses stdout for JSON-RPC. Route ALL log levels
      // to stderr so logs never corrupt the protocol stream.
      stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
    }),
  ];

  const format = isJson
    ? combine(timestamp(), errors({ stack: true }), json())
    : combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        prettyFormat,
      );

  return winston.createLogger({
    level: logLevel,
    format,
    transports,
    exitOnError: false,
  });
}

export const logger = createLogger();

// ─── Child logger helper ──────────────────────────────────────────────────────

/**
 * Creates a child logger with a fixed context label.
 * Useful for adding module/component identifiers to log entries.
 */
export function createChildLogger(module: string): winston.Logger {
  return logger.child({ module });
}
