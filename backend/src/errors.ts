export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(https:\/\/[^/\s]+\/v2\/)[A-Za-z0-9_-]+/g, "$1[redacted]");
}
