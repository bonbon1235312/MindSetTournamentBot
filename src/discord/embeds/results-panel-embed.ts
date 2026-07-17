import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import type { Fixture } from '../../database/schema/index.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import type { CanonicalResult } from '../../domain/fixtures/result-matching.js';
import { encodeCustomId } from '../interactions/custom-id.js';
import { isManagerSubmittable } from '../../services/result-submission-service.js';

const NAMESPACE = 'fixture';

async function teamNamesFor(ctx: AppContext, fixture: Fixture): Promise<{ home: string; away: string }> {
  const [homeEntry, awayEntry] = await Promise.all([
    getEntryById(ctx.db, fixture.homeEntryId),
    getEntryById(ctx.db, fixture.awayEntryId),
  ]);
  const [homeClub, awayClub] = await Promise.all([
    homeEntry ? getClubById(ctx.db, homeEntry.clubId) : undefined,
    awayEntry ? getClubById(ctx.db, awayEntry.clubId) : undefined,
  ]);
  return { home: homeClub?.displayName ?? 'Unknown team', away: awayClub?.displayName ?? 'Unknown team' };
}

function statusLine(fixture: Fixture, home: string, away: string): string {
  switch (fixture.status) {
    case 'SCHEDULED':
    case 'READY':
      return '🕐 Not yet playable';
    case 'WAITING_FOR_SUBMISSIONS':
      return '⏳ Awaiting submissions';
    case 'WAITING_FOR_OPPONENT':
      return '⏳ One side has submitted — waiting on the other';
    case 'RESULT_CONFLICT':
      return '⚠️ Submissions disagree — staff will resolve';
    case 'EVIDENCE_REQUESTED':
      return '📋 Evidence requested';
    case 'OVERDUE':
      return '🔴 Overdue';
    case 'RESOLVED': {
      const decided = fixture.decisionMethod === 'PENALTIES' ? ` (pens ${fixture.penaltyHome}-${fixture.penaltyAway})` : '';
      return `✅ **${home} ${fixture.homeScore}-${fixture.awayScore} ${away}**${decided}`;
    }
    case 'FORFEIT':
      return '🚫 Forfeit';
    case 'VOID':
      return '❌ Void';
    default:
      return fixture.status;
  }
}

export async function buildResultsPanelEmbed(ctx: AppContext, fixtures: Fixture[], label: string): Promise<EmbedBuilder> {
  const lines = await Promise.all(
    fixtures.map(async (fixture) => {
      const { home, away } = await teamNamesFor(ctx, fixture);
      if (fixture.status === 'RESOLVED' || fixture.status === 'FORFEIT' || fixture.status === 'VOID') {
        return statusLine(fixture, home, away);
      }
      return `**${home}** vs **${away}** — ${statusLine(fixture, home, away)}`;
    }),
  );

  return new EmbedBuilder()
    .setColor('#141414')
    .setAuthor({ name: 'MindSet Tournament Bot  ·  Results Panel' })
    .setTitle(`${label} — Submit Your Results`)
    .setDescription(lines.length > 0 ? lines.join('\n') : 'No fixtures yet.')
    .setFooter({ text: 'Pick your fixture below once it has been played. Staff can override any fixture.' })
    .setTimestamp(new Date());
}

export async function buildResultsPanelComponents(
  ctx: AppContext,
  fixtures: Fixture[],
  groupConfirm?: { groupId: string; allResolved: boolean; alreadyConfirmed: boolean },
): Promise<ActionRowBuilder<MessageActionRowComponentBuilder>[]> {
  const submittable = fixtures.filter((f) => isManagerSubmittable(f.status));

  const select = new StringSelectMenuBuilder().setCustomId(encodeCustomId(NAMESPACE, 'select')).setPlaceholder(
    submittable.length === 0 ? 'No fixtures currently accepting results' : 'Select the fixture you played',
  );

  if (submittable.length === 0) {
    select.addOptions([{ label: 'No fixtures ready', value: 'none' }]).setDisabled(true);
  } else {
    const options = await Promise.all(
      submittable.slice(0, 25).map(async (fixture) => {
        const { home, away } = await teamNamesFor(ctx, fixture);
        return { label: `${home} vs ${away}`.slice(0, 100), value: fixture.id };
      }),
    );
    select.addOptions(options);
  }

  const rows = [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];

  if (groupConfirm) {
    const button = new ButtonBuilder()
      .setCustomId(encodeCustomId('group', 'confirm', groupConfirm.groupId))
      .setLabel(groupConfirm.alreadyConfirmed ? '✅ Group Confirmed' : 'Confirm Group Complete')
      .setStyle(groupConfirm.alreadyConfirmed ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(groupConfirm.alreadyConfirmed || !groupConfirm.allResolved);
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(button));
  }

  return rows;
}

export function buildConflictPanelEmbed(
  homeTeam: string,
  awayTeam: string,
  submissionOne: { submitterLabel: string; canonical: CanonicalResult },
  submissionTwo: { submitterLabel: string; canonical: CanonicalResult },
): EmbedBuilder {
  const format = (c: CanonicalResult) => {
    const pens = c.decisionMethod === 'PENALTIES' ? ` (pens ${c.penaltyHome}-${c.penaltyAway})` : '';
    return `${homeTeam} ${c.homeScore}-${c.awayScore} ${awayTeam}${pens}`;
  };

  return new EmbedBuilder()
    .setColor('#C0392B')
    .setAuthor({ name: 'MindSet Tournament Bot  ·  Result Conflict' })
    .setTitle(`⚠️ ${homeTeam} vs ${awayTeam}`)
    .addFields(
      { name: `Submission 1 — from ${submissionOne.submitterLabel}`, value: format(submissionOne.canonical), inline: false },
      { name: `Submission 2 — from ${submissionTwo.submitterLabel}`, value: format(submissionTwo.canonical), inline: false },
    )
    .setFooter({ text: 'Pick which submission is correct, or manually override with the real score.' })
    .setTimestamp(new Date());
}

export function buildConflictPanelComponents(fixtureId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId('result_conflict', 'accept_one', fixtureId)).setLabel('Accept Submission 1').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(encodeCustomId('result_conflict', 'accept_two', fixtureId)).setLabel('Accept Submission 2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(encodeCustomId('result_conflict', 'override', fixtureId)).setLabel('Manual Override').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(encodeCustomId('result_conflict', 'request_evidence', fixtureId)).setLabel('Request Evidence').setStyle(ButtonStyle.Primary),
    ),
  ];
}
