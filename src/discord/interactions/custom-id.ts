/**
 * Structured custom_id encoding (section 36: "Use signed or safely encoded
 * custom IDs with database lookup"). We don't cryptographically sign these
 * — instead every handler re-validates the encoded entity ID against
 * current database state (permissions, tournament status, version) before
 * acting, so a tampered custom_id can point at data but never bypass a
 * server-side check. Format: "namespace:action:id1:id2:...", capped well
 * under Discord's 100-char custom_id limit.
 */
const DELIMITER = ':';

export function encodeCustomId(namespace: string, action: string, ...parts: string[]): string {
  const id = [namespace, action, ...parts].join(DELIMITER);
  if (id.length > 100) {
    throw new Error(`custom_id exceeds 100 characters: ${id}`);
  }
  return id;
}

export interface DecodedCustomId {
  namespace: string;
  action: string;
  parts: string[];
}

export function decodeCustomId(customId: string): DecodedCustomId {
  const [namespace, action, ...parts] = customId.split(DELIMITER);
  if (!namespace || !action) {
    throw new Error(`Malformed custom_id: ${customId}`);
  }
  return { namespace, action, parts };
}
