import { ErreurArguments, lireDateSimulee } from './arguments-expiration';

describe('lireDateSimulee (H22)', () => {
  const MAINTENANT = new Date('2026-11-04T15:00:00Z');

  it('une date seule désigne la fin de cette journée en UTC', () => {
    expect(lireDateSimulee(['--date', '2026-11-08'], MAINTENANT)).toEqual(
      new Date('2026-11-08T23:59:59.999Z'),
    );
  });

  it('la date du jour est acceptée : sa fin est postérieure à l’heure réelle', () => {
    expect(lireDateSimulee(['--date', '2026-11-04'], MAINTENANT)).toEqual(
      new Date('2026-11-04T23:59:59.999Z'),
    );
  });

  it.each([
    ['2026-11-08T09:00:00Z', '2026-11-08T09:00:00.000Z'],
    ['2026-11-08T10:30:00+01:00', '2026-11-08T09:30:00.000Z'],
    ['2026-11-08T09:00Z', '2026-11-08T09:00:00.000Z'],
  ])('une date avec heure et fuseau est prise telle quelle : %s', (valeur, attendu) => {
    expect(lireDateSimulee(['--date', valeur], MAINTENANT).toISOString()).toBe(attendu);
  });

  it.each([
    ['absente', []],
    ['sans valeur', ['--date']],
    ['mal écrite', ['--date', '08/11/2026']],
    ['impossible', ['--date', '2026-02-30']],
    ['sans fuseau horaire', ['--date', '2026-11-08T09:00:00']],
  ])('refuse une date %s', (_cas, args) => {
    expect(() => lireDateSimulee(args, MAINTENANT)).toThrow(ErreurArguments);
  });

  it('refuse une date antérieure à l’heure réelle', () => {
    expect(() => lireDateSimulee(['--date', '2026-11-03'], MAINTENANT)).toThrow(/antérieure/);
    expect(() => lireDateSimulee(['--date', '2026-11-04T14:59:59Z'], MAINTENANT)).toThrow(
      /antérieure/,
    );
  });
});
