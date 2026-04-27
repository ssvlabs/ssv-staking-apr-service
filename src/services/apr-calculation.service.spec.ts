import { getAprCalculationCronExpression } from './apr-calculation.service';

describe('getAprCalculationCronExpression', () => {
  it('uses the existing every-three-hours default when env is missing', () => {
    expect(getAprCalculationCronExpression({})).toBe('0 */3 * * *');
  });

  it('uses APR_CALCULATION_CRON when provided', () => {
    expect(
      getAprCalculationCronExpression({
        APR_CALCULATION_CRON: '0 0 * * *'
      })
    ).toBe('0 0 * * *');
  });
});
