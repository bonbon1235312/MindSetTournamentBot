/**
 * Escapes a string for safe inclusion in SVG/XML text content (section 14:
 * "Escape SVG/XML strings"). Team names are user-supplied and could contain
 * `&`, `<`, `>`, quotes — unescaped, they'd corrupt the SVG document or,
 * worse, allow content injection into the rendered graphic.
 */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncates a team name to a safe display length with an ellipsis, then
 * escapes it. Prevents long names from overflowing fixed-width SVG text
 * boxes (section 14: "auto-size or truncate long team names cleanly").
 */
export function truncateAndEscape(input: string, maxChars: number): string {
  const trimmed = input.trim();
  const truncated = trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
  return escapeXml(truncated);
}
