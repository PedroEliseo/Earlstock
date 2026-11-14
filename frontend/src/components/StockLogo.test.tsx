import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { logoUrl, monogram, StockLogo } from './StockLogo';

describe('StockLogo', () => {
  it('requests the ticker logo, encoded, with a 404 on a miss', () => {
    expect(logoUrl('AAPL')).toBe('https://logoapi.sh/icon/ticker/AAPL?fallback=404');
    expect(logoUrl('^GSPC')).toBe('https://logoapi.sh/icon/ticker/%5EGSPC?fallback=404');
  });

  it('is a decorative image that loads lazily', () => {
    const { container } = render(<StockLogo ticker="AAPL" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', logoUrl('AAPL'));
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to a neutral monogram when no logo exists (never another logo)', () => {
    const { container } = render(<StockLogo ticker="BRK.B" />);
    const img = container.querySelector('img');
    if (!img) throw new Error('expected an image');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('BRK');
  });

  it.each([
    ['AAPL', 'AAPL'],
    ['BRK.B', 'BRK'],
    ['^GSPC', 'GSPC'],
    ['EURUSD=X', 'EURU'],
  ])('uses %s -> %s as the monogram', (ticker, initials) => {
    expect(monogram(ticker)).toBe(initials);
  });
});
