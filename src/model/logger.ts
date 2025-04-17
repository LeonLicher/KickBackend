/**
 * Logger interface
 */
export interface Logger {
  info: (message: string, ...args: any[]) => void;
  warning: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

/**
 * Simple logger utility
 */
const logger: Logger = {
  info: (message: string, ...args: any[]) =>
    console.log(`[INFO] ${message}`, ...args),
  warning: (message: string, ...args: any[]) =>
    console.warn(`[WARNING] ${message}`, ...args),
  error: (message: string, ...args: any[]) =>
    console.error(`[ERROR] ${message}`, ...args),
  debug: (message: string, ...args: any[]) =>
    console.debug(`[DEBUG] ${message}`, ...args),
};

export default logger;
