import { renderWinnerAnnouncementSvg, type WinnerAnnouncementGraphicInput } from '../templates/winner-announcement-template.js';
import { renderSvgToPng, type RenderedGraphic } from './svg-to-png.js';

export async function renderWinnerAnnouncementGraphic(input: WinnerAnnouncementGraphicInput, cacheDir: string): Promise<RenderedGraphic> {
  const svg = renderWinnerAnnouncementSvg(input);
  return renderSvgToPng(svg, cacheDir, 'winner-announcement');
}
