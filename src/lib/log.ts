type Field = string | number | boolean | null | undefined;

/** Printed to stdout so it shows up in Vercel runtime logs. */
export function debug(scope: string, message: string, fields?: Record<string, Field>) {
  const extra = fields
    ? ` ${Object.entries(fields)
        .map(([key, value]) => `${key}=${formatField(value)}`)
        .join(" ")}`
    : "";
  console.log(`[autotube] ${scope} ${message}${extra}`);
}

export function debugError(scope: string, message: string, fields?: Record<string, Field>) {
  const extra = fields
    ? ` ${Object.entries(fields)
        .map(([key, value]) => `${key}=${formatField(value)}`)
        .join(" ")}`
    : "";
  console.error(`[autotube] ${scope} ${message}${extra}`);
}

function formatField(value: Field) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return JSON.stringify(value.slice(0, 240));
  return String(value);
}
