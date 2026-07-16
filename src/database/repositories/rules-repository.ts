import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { rulesVersions, type RulesVersion } from '../schema/index.js';
import { DEFAULT_ENTRY_FEE_PENCE } from '../../config/constants.js';

/** Section 29's default rules text. Used only to seed the very first
 * rules_versions row for a guild — after that, staff edit via future
 * tooling and every edit becomes a new version (old entries keep whatever
 * version they accepted). */
export function defaultRulesContent(): string {
  return [
    `Entry fee: £${(DEFAULT_ENTRY_FEE_PENCE / 100).toFixed(2)} per team`,
    'Payment methods: PayPal or Revolut',
    'Prize pool: based on confirmed paid entries',
    'Platform: Any',
    'Region: Europe',
    'No-show policy: tournament ban',
    'Disconnect before five in-game minutes: restart',
    'Disconnect after five in-game minutes: play on',
    'Evidence dispute: ping an administrator',
    'Withdrawal: half refund',
    'Cheating: user ban and team tournament ban',
    'Winners have one day to provide payment details',
  ].join('\n');
}

export async function getActiveRulesVersion(db: Database, guildId: string): Promise<RulesVersion> {
  const existing = await db.query.rulesVersions.findFirst({
    where: and(eq(rulesVersions.guildId, guildId), eq(rulesVersions.active, true)),
    orderBy: desc(rulesVersions.version),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(rulesVersions)
    .values({
      guildId,
      title: 'MindSet Cash Cup Rules',
      content: defaultRulesContent(),
      version: 1,
      active: true,
    })
    .returning();
  if (!created) throw new Error(`Failed to seed default rules for guild ${guildId}`);
  return created;
}
