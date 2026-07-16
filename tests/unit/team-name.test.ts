import { describe, it, expect } from 'vitest';
import { validateTeamName } from '../../src/domain/entries/team-name.js';
import { ValidationError } from '../../src/types/errors.js';

describe('validateTeamName', () => {
  it('accepts a normal team name', () => {
    const result = validateTeamName('Rocket FC');
    expect(result.displayName).toBe('Rocket FC');
    expect(result.normalisedName).toBe('rocket fc');
  });

  it('trims surrounding whitespace', () => {
    const result = validateTeamName('   Rocket FC   ');
    expect(result.displayName).toBe('Rocket FC');
  });

  it('rejects an empty name', () => {
    expect(() => validateTeamName('   ')).toThrow(ValidationError);
  });

  it('rejects a name over the max length', () => {
    expect(() => validateTeamName('A'.repeat(41))).toThrow(ValidationError);
  });

  it('accepts a name exactly at the max length', () => {
    expect(() => validateTeamName('A'.repeat(40))).not.toThrow();
  });

  it('rejects @everyone', () => {
    expect(() => validateTeamName('Team @everyone')).toThrow(ValidationError);
  });

  it('rejects @here', () => {
    expect(() => validateTeamName('Team @here')).toThrow(ValidationError);
  });

  it('rejects a raw user mention', () => {
    expect(() => validateTeamName('Team <@123456789012345678>')).toThrow(ValidationError);
  });

  it('rejects a raw role mention', () => {
    expect(() => validateTeamName('Team <@&123456789012345678>')).toThrow(ValidationError);
  });

  it('rejects a channel mention', () => {
    expect(() => validateTeamName('Team <#123456789012345678>')).toThrow(ValidationError);
  });

  it('preserves the intended visible spelling (case, punctuation) in displayName', () => {
    const result = validateTeamName("O'Brien United FC!");
    expect(result.displayName).toBe("O'Brien United FC!");
  });

  it('normalises case and collapses internal whitespace for uniqueness comparison', () => {
    const a = validateTeamName('Rocket   FC');
    const b = validateTeamName('ROCKET FC');
    expect(a.normalisedName).toBe(b.normalisedName);
  });

  it('strips zero-width characters used to dodge naive filters', () => {
    const result = validateTeamName('Rocket​FC');
    expect(result.displayName).toBe('RocketFC');
  });
});
