import { renderKnockoutBracketSvg, type KnockoutBracketGraphicInput } from '../templates/knockout-bracket-template.js';
import { renderSvgToPng, type RenderedGraphic } from './svg-to-png.js';

export async function renderKnockoutBracketGraphic(input: KnockoutBracketGraphicInput, cacheDir: string): Promise<RenderedGraphic> {
  const svg = renderKnockoutBracketSvg(input);
  const stageSlug = input.stageLabel.toLowerCase().replace(/\s+/g, '-');
  return renderSvgToPng(svg, cacheDir, `knockout-${stageSlug}`);
}
