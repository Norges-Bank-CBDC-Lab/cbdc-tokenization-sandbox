import { transports, createLogger, format } from 'winston';
import { envVariables } from './env-vars';

const getTime = () => Math.floor(new Date().getTime() / 1000).toString();

export const logger = createLogger({
  level: envVariables.LOG_LEVEL,
  format: format.combine(
    format.timestamp({
      format: getTime,
    }),
    format.printf((info) => {
      const { timestamp, level, message } = info as {
        timestamp?: string;
        level?: string;
        message?: unknown;
      };
      return JSON.stringify({ timestamp, level, message });
    }),
  ),
  transports: [new transports.Console()],
});
