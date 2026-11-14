import { toActiveSnapshot } from './dataset.repository.js';

describe('toActiveSnapshot', () => {
  it('maps both columns NULL (the sentinel row) to "no active snapshot"', () => {
    expect(toActiveSnapshot({ importId: null, activatedAt: null })).toBeNull();
  });

  it('maps a valid pair', () => {
    expect(toActiveSnapshot({ importId: 3, activatedAt: '2000-01-01T00:00:00.000Z' })).toEqual({
      importId: 3,
      activatedAt: '2000-01-01T00:00:00.000Z',
    });
  });

  it.each([
    ['a missing row', undefined],
    ['only one column NULL', { importId: 3, activatedAt: null }],
    ['an unparsed driver value (e.g. a Date)', { importId: 3, activatedAt: new Date(0) }],
    [
      'a non-ISO timestamp (e.g. DateStyle=SQL)',
      { importId: 3, activatedAt: '01/02/2000 00:00:00 UTC' },
    ],
    ['a non-numeric id', { importId: '3', activatedAt: '2000-01-01T00:00:00.000Z' }],
  ])('treats %s as a fault, never as "not loaded"', (_case, row) => {
    expect(() => toActiveSnapshot(row)).toThrow();
  });
});
