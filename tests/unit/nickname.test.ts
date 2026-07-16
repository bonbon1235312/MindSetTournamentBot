import { describe, it, expect } from 'vitest';
import { buildTournamentNickname } from '../../src/domain/entries/nickname.js';

describe('buildTournamentNickname', () => {
  it('appends " M" for a manager', () => {
    expect(buildTournamentNickname('Rocket FC', 'MANAGER')).toBe('Rocket FC M');
  });

  it('appends " CO" for a co-manager', () => {
    expect(buildTournamentNickname('Rocket FC', 'CO_MANAGER')).toBe('Rocket FC CO');
  });

  it('never exceeds Discord\'s 32-character nickname limit', () => {
    const longName = 'A'.repeat(40);
    const nickname = buildTournamentNickname(longName, 'MANAGER');
    expect(nickname.length).toBeLessThanOrEqual(32);
  });

  it('always keeps the manager suffix fully visible, even when shortening', () => {
    const longName = 'The Extremely Long Championship Winning Football Club';
    const nickname = buildTournamentNickname(longName, 'MANAGER');
    expect(nickname.endsWith(' M')).toBe(true);
  });

  it('always keeps the co-manager suffix fully visible, even when shortening', () => {
    const longName = 'The Extremely Long Championship Winning Football Club';
    const nickname = buildTournamentNickname(longName, 'CO_MANAGER');
    expect(nickname.endsWith(' CO')).toBe(true);
    expect(nickname.length).toBeLessThanOrEqual(32);
  });

  it('does not shorten a name that already fits', () => {
    expect(buildTournamentNickname('Short', 'MANAGER')).toBe('Short M');
  });

  it('trims trailing whitespace introduced by truncation', () => {
    // Constructed so the cut point lands right after a space.
    const name = 'A'.repeat(29) + ' B';
    const nickname = buildTournamentNickname(name, 'MANAGER');
    expect(nickname).not.toMatch(/ {2,}M$/); // no double space before suffix
  });
});
