import {
  cleanAppealNumber,
  yearFromAppealRegistration,
  yearFromDecisionNumber,
  dmyToIso,
  isPlausibleYear,
} from '../src/utils/identifiers.js';

describe('identifiers', () => {
  describe('cleanAppealNumber', () => {
    it('strips trailing semicolons and whitespace', () => {
      expect(cleanAppealNumber('02/1092/24;')).toBe('02/1092/24');
      expect(cleanAppealNumber('  02/0001/24  ')).toBe('02/0001/24');
      expect(cleanAppealNumber('02/0001/24,')).toBe('02/0001/24');
    });
  });

  describe('yearFromAppealRegistration', () => {
    it('parses 2-digit suffix as 20xx', () => {
      expect(yearFromAppealRegistration('02/1245/24')).toBe(2024);
      expect(yearFromAppealRegistration('02/0001/19;')).toBe(2019);
    });
    it('rejects malformed inputs', () => {
      expect(() => yearFromAppealRegistration('abc')).toThrow();
      expect(() => yearFromAppealRegistration('02-1245-24')).toThrow();
    });
  });

  describe('yearFromDecisionNumber', () => {
    it('parses trailing 2-digit suffix as 20xx', () => {
      expect(yearFromDecisionNumber('03D-962-24')).toBe(2024);
      expect(yearFromDecisionNumber('05D-1-25')).toBe(2025);
    });
    it('rejects malformed inputs', () => {
      expect(() => yearFromDecisionNumber('NOPE')).toThrow();
    });
  });

  describe('dmyToIso', () => {
    it('converts dd/mm/yyyy', () => {
      expect(dmyToIso('31/12/2024')).toBe('2024-12-31');
      expect(dmyToIso(' 1/3/2024 ')).toBe('2024-03-01');
    });
    it('returns null on garbage', () => {
      expect(dmyToIso('not a date')).toBeNull();
      expect(dmyToIso('32/01/2024')).toBeNull();
      expect(dmyToIso('15/13/2024')).toBeNull();
    });
  });

  describe('isPlausibleYear', () => {
    it('accepts 2014..2099', () => {
      expect(isPlausibleYear(2024)).toBe(true);
      expect(isPlausibleYear(2014)).toBe(true);
      expect(isPlausibleYear(2099)).toBe(true);
    });
    it('rejects out-of-range', () => {
      expect(isPlausibleYear(2013)).toBe(false);
      expect(isPlausibleYear(1999)).toBe(false);
      expect(isPlausibleYear(2100)).toBe(false);
    });
  });
});
