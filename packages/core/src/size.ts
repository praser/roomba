/**
 * Normalize a raw size string into a consistent "<number> <UNIT>B" form so
 * every engine renders sizes the same way. Engines call this on their source's
 * size text (e.g. Vimm's "330 MB", Emuparadise's "441M") before returning it.
 *
 *   "441M"      -> "441 MB"
 *   "330 MB"    -> "330 MB"
 *   "73.66 MB"  -> "73.66 MB"
 *   "40K"       -> "40 KB"
 *   "1.3G"      -> "1.3 GB"
 *   "1024"      -> "1024 B"
 *
 * Unparseable input is returned trimmed, unchanged.
 */
export function normalizeSize(raw: string): string {
  const match = /^\s*([\d.]+)\s*([KMGTP])?i?B?\s*$/i.exec(raw);
  if (!match) return raw.trim();
  const [, value, unit] = match;
  return unit ? `${value} ${unit.toUpperCase()}B` : `${value} B`;
}
