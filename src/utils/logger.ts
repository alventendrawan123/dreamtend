import pino from "pino";
import { LOGGING } from "../config/constants.js";

export const logger = pino({
  level: LOGGING.level,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  },
});

export type Logger = typeof logger;
