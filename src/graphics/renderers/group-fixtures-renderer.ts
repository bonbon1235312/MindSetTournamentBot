import { renderGroupFixturesSvg, type GroupFixturesGraphicInput } from '../templates/group-fixtures-template.js';
import { renderSvgToPng, type RenderedGraphic } from './svg-to-png.js';

export async function renderGroupFixturesGraphic(input: GroupFixturesGraphicInput, cacheDir: string): Promise<RenderedGraphic> {
  const svg = renderGroupFixturesSvg(input);
  return renderSvgToPng(svg, cacheDir, `group-${input.groupCode.toLowerCase()}-fixtures`);
}
