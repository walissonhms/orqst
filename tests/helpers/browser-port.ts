/** Browser fixtures must never attach to the installed production listener. */
export function parseBrowserPort(value: string | undefined): number {
  const port = value === undefined ? 4318 : Number(value);
  if (
    (value !== undefined && !/^\d+$/.test(value)) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === 4317
  )
    throw new Error('ORQST_BROWSER_PORT must be an integer from 1024 to 65535 other than 4317');
  return port;
}

export const browserPort = parseBrowserPort(process.env.ORQST_BROWSER_PORT);
export const browserBaseURL = `http://127.0.0.1:${browserPort}`;
