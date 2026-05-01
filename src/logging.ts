import pino from 'pino';

const level = process.env['LOG_LEVEL']?.toLowerCase() ?? 'info';

export const logger = pino(
  {
    level,
    base: { service: 'ansc-mcp' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ fd: 2, sync: false }),
);

export type Logger = typeof logger;
