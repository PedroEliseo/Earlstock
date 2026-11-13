import { createStockSchema } from './stocks.schemas.js';

describe('createStockSchema', () => {
  it('trims and upper-cases codes so duplicates are detected case-insensitively', () => {
    expect(
      createStockSchema.parse({
        symbol: ' brk.b ',
        name: ' Berkshire Hathaway ',
        exchange: 'nyse',
        currency: 'usd',
      }),
    ).toEqual({ symbol: 'BRK.B', name: 'Berkshire Hathaway', exchange: 'NYSE', currency: 'USD' });
  });
});
