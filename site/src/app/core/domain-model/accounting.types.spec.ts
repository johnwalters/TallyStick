import { addMoney, formatMoney, money, negateMoney } from './accounting.types';

describe('Money', () => {
  it('uses exact integer minor units', () => {
    const total = addMoney(money(10_01), money(-1));
    expect(total.minorUnits).toBe(1000n);
    expect(formatMoney(total)).toBe('$10.00');
    expect(negateMoney(total).minorUnits).toBe(-1000n);
  });

  it('rejects mixed currencies', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'CAD'))).toThrowError(/Currency mismatch/);
  });
});
