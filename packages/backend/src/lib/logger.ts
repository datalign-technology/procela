import pino from 'pino';
import config from '../config';

const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export default logger;
