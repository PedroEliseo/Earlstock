import { describe, expect, it } from 'vitest';
import { daysAgo } from '../../test/fixtures';
import { readCompareViewState, withCompareChanges } from './compareViewState';

describe('compare view state', () => {
  it('reads tickers, range and basis', () => {
    expect(
      readCompareViewState(new URLSearchParams('tickers=aaa,BBB&range=6M&basis=adjClose')),
    ).toEqual({
      tickers: ['AAA', 'BBB'],
      ignored: { invalid: [], duplicates: [], overflow: [] },
      range: { kind: 'preset', preset: '6M' },
      basis: 'adjClose',
      invalidSettings: false,
    });
  });

  it('defaults to Close and the default range', () => {
    const state = readCompareViewState(new URLSearchParams(''));
    expect(state).toMatchObject({
      tickers: [],
      basis: 'close',
      range: { kind: 'default' },
      invalidSettings: false,
    });
  });

  it('normalizes duplicates, invalid entries and more than five tickers deterministically', () => {
    const state = readCompareViewState(new URLSearchParams('tickers=A,B,a,C!,D,E,F,G'));
    expect(state.tickers).toEqual(['A', 'B', 'D', 'E', 'F']);
    expect(state.ignored).toEqual({ invalid: ['C!'], duplicates: ['A'], overflow: ['G'] });
  });

  it('reports an unknown basis or range', () => {
    expect(readCompareViewState(new URLSearchParams('basis=open')).invalidSettings).toBe(true);
    expect(readCompareViewState(new URLSearchParams('range=2W')).invalidSettings).toBe(true);
  });

  it('writes changes, omitting defaults', () => {
    const from = daysAgo(60);
    const to = daysAgo(30);
    const next = withCompareChanges(new URLSearchParams('basis=adjClose'), {
      tickers: ['AAA', 'BBB'],
      range: { kind: 'custom', from, to },
      basis: 'close',
    });
    expect(next.toString()).toBe(`tickers=AAA%2CBBB&range=custom&from=${from}&to=${to}`);
    expect(withCompareChanges(next, { tickers: [] }).has('tickers')).toBe(false);
  });
});
