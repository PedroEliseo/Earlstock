import { describe, expect, it } from 'vitest';
import { readViewState, SORT_OPTIONS } from './stockListView';

describe('readViewState', () => {
  it('reads valid parameters', () => {
    expect(readViewState(new URLSearchParams('q=aa&sort=lastDate&dir=desc'))).toEqual({
      query: 'aa',
      sortKey: 'lastDate',
      sortDirection: 'desc',
    });
  });

  it('falls back to defaults for missing or invalid parameters, and ignores old page numbers', () => {
    expect(readViewState(new URLSearchParams('sort=price&dir=up&page=3'))).toEqual({
      query: '',
      sortKey: 'ticker',
      sortDirection: 'asc',
    });
  });
});

describe('SORT_OPTIONS', () => {
  it('offers every key in both directions exactly once', () => {
    const values = SORT_OPTIONS.map((o) => `${o.key}:${o.direction}`);
    expect(new Set(values).size).toBe(6);
  });
});
