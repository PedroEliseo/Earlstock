import { describe, expect, it } from 'vitest';
import { pageCount, readViewState } from './stockListView';

describe('pageCount', () => {
  it('rounds up and is at least one', () => {
    expect(pageCount(120, 50)).toBe(3);
    expect(pageCount(100, 50)).toBe(2);
    expect(pageCount(0, 50)).toBe(1);
  });
});

describe('readViewState', () => {
  it('reads valid parameters', () => {
    expect(readViewState(new URLSearchParams('q=aa&sort=lastDate&dir=desc&page=3'))).toEqual({
      query: 'aa',
      sortKey: 'lastDate',
      sortDirection: 'desc',
      page: 3,
    });
  });

  it('falls back to defaults for missing or invalid parameters', () => {
    expect(readViewState(new URLSearchParams('sort=price&dir=up&page=-2'))).toEqual({
      query: '',
      sortKey: 'ticker',
      sortDirection: 'asc',
      page: 1,
    });
  });
});
