import { toSafeInteger } from './numbers.js';

describe('toSafeInteger', () => {
  it.each([
    ['0', 0],
    ['1000', 1000],
    ['9007199254740991', 9007199254740991],
  ])('converts %s', (value, expected) => {
    expect(toSafeInteger(value)).toBe(expected);
  });

  it.each(['9007199254740992', '-9007199254740992', '1.5', '1e3', '', ' 1', 'abc'])(
    'refuses %p rather than losing precision or guessing',
    (value) => {
      expect(() => toSafeInteger(value)).toThrow();
    },
  );
});
