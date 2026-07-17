import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { graphics, type Graphic, type NewGraphic } from '../schema/index.js';
import type { GraphicType } from '../schema/enums.js';

export async function recordGraphic(db: Database, values: NewGraphic): Promise<Graphic> {
  const [created] = await db.insert(graphics).values(values).returning();
  if (!created) throw new Error('Failed to record graphic');
  return created;
}

/** Every recorded render for one entity + graphic type, newest first —
 * lets staff (or a future admin view) see the render history for, say, a
 * group's standings graphic across however many times it changed. */
export async function getGraphicHistory(
  db: Database,
  graphicType: GraphicType,
  scope: { tournamentId: string; groupId?: string; knockoutRoundId?: string },
): Promise<Graphic[]> {
  return db.query.graphics.findMany({
    where: and(
      eq(graphics.graphicType, graphicType),
      eq(graphics.tournamentId, scope.tournamentId),
      ...(scope.groupId ? [eq(graphics.groupId, scope.groupId)] : []),
      ...(scope.knockoutRoundId ? [eq(graphics.knockoutRoundId, scope.knockoutRoundId)] : []),
    ),
    orderBy: (g, { desc }) => [desc(g.version)],
  });
}
