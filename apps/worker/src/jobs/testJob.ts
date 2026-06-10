import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

/**
 * A simple test job that logs a message with a timestamp.
 */
export const processTestJob = async () => {
  const timestamp = new Date().toISOString();
  logger.info(`Hello from worker! Current timestamp: ${timestamp}`);
  return { success: true, timestamp };
};
