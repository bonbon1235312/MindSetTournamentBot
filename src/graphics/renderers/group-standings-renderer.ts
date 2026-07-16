import { renderGroupStandingsSvg, type GroupStandingsGraphicInput } from '../templates/group-standings-template.js';
import { renderSvgToPng, type RenderedGraphic } from './svg-to-png.js';

export async function renderGroupStandingsGraphic(input: GroupStandingsGraphicInput, cacheDir: string): Promise<RenderedGraphic> {
  const svg = renderGroupStandingsSvg(input);
  return renderSvgToPng(svg, cacheDir, `group-${input.groupCode.toLowerCase()}-standings`);
}
