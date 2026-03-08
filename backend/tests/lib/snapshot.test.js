'use strict';

const { computeDSCR } = require('../../src/lib/modelEngine');
const { makeSnapshot } = require('../helpers/fixtures');

describe('computeDSCR', () => {
  test('normal trailing-12 computation', () => {
    const plRows = [];
    const debtRows = [];
    for (let i = 0; i < 12; i++) {
      plRows.push({ periodIndex: i, ebitda: 10000 });
      debtRows.push({ period_index: i, cash_interest: 3000, cash_principal: 2000 });
    }

    const result = computeDSCR(11, 12, plRows, debtRows);

    expect(result.portfolioEbitda).toBe(120000);
    expect(result.debtService).toBe(60000);
    expect(result.dscr).toBe(2.0);
    expect(result.aboveThreshold).toBe(true);
    expect(result.aboveFloor).toBe(true);
  });

  test('zero debt service → Infinity DSCR', () => {
    const plRows = [
      { periodIndex: 0, ebitda: 50000 },
      { periodIndex: 1, ebitda: 50000 }
    ];

    const result = computeDSCR(1, 12, plRows, []);

    expect(result.portfolioEbitda).toBe(100000);
    expect(result.debtService).toBe(0);
    expect(result.dscr).toBe(Infinity);
    expect(result.aboveThreshold).toBe(true);
    expect(result.aboveFloor).toBe(true);
  });

  test('partial trailing window (period 2, trailing 12 → only 3 periods)', () => {
    const plRows = [
      { periodIndex: 0, ebitda: 8000 },
      { periodIndex: 1, ebitda: 9000 },
      { periodIndex: 2, ebitda: 10000 }
    ];
    const debtRows = [
      { period_index: 0, cash_interest: 2000, cash_principal: 1000 },
      { period_index: 1, cash_interest: 2000, cash_principal: 1000 },
      { period_index: 2, cash_interest: 2000, cash_principal: 1000 }
    ];

    const result = computeDSCR(2, 12, plRows, debtRows);

    expect(result.portfolioEbitda).toBe(27000);
    expect(result.debtService).toBe(9000);
    expect(result.dscr).toBe(3.0);
  });

  test('DSCR below floor (< 1.0)', () => {
    const plRows = [{ periodIndex: 0, ebitda: 5000 }];
    const debtRows = [{ period_index: 0, cash_interest: 4000, cash_principal: 3000 }];

    const result = computeDSCR(0, 12, plRows, debtRows);

    expect(result.portfolioEbitda).toBe(5000);
    expect(result.debtService).toBe(7000);
    expect(result.dscr).toBeCloseTo(0.7143, 4);
    expect(result.aboveThreshold).toBe(false);
    expect(result.aboveFloor).toBe(false);
  });

  test('DSCR between floor and threshold (1.0 ≤ x < 1.25)', () => {
    const plRows = [{ periodIndex: 0, ebitda: 11000 }];
    const debtRows = [{ period_index: 0, cash_interest: 5000, cash_principal: 5000 }];

    const result = computeDSCR(0, 12, plRows, debtRows);

    expect(result.dscr).toBe(1.1);
    expect(result.aboveThreshold).toBe(false);
    expect(result.aboveFloor).toBe(true);
  });

  test('exactly at threshold (1.25)', () => {
    const plRows = [{ periodIndex: 0, ebitda: 12500 }];
    const debtRows = [{ period_index: 0, cash_interest: 5000, cash_principal: 5000 }];

    const result = computeDSCR(0, 12, plRows, debtRows);

    expect(result.dscr).toBe(1.25);
    expect(result.aboveThreshold).toBe(true);
    expect(result.aboveFloor).toBe(true);
  });

  test('ignores rows outside trailing window', () => {
    const plRows = [
      { periodIndex: 0, ebitda: 99999 },  // outside window
      { periodIndex: 10, ebitda: 5000 },
      { periodIndex: 11, ebitda: 5000 }
    ];
    const debtRows = [
      { period_index: 0, cash_interest: 99999, cash_principal: 0 },  // outside window
      { period_index: 10, cash_interest: 2000, cash_principal: 1000 },
      { period_index: 11, cash_interest: 2000, cash_principal: 1000 }
    ];

    // trailing 2 from period 11 → window = [10, 11]
    const result = computeDSCR(11, 2, plRows, debtRows);

    expect(result.portfolioEbitda).toBe(10000);
    expect(result.debtService).toBe(6000);
  });

  test('handles numeric strings from DB', () => {
    const plRows = [{ periodIndex: 0, ebitda: '15000' }];
    const debtRows = [{ period_index: 0, cash_interest: '3000', cash_principal: '2000' }];

    const result = computeDSCR(0, 12, plRows, debtRows);

    expect(result.portfolioEbitda).toBe(15000);
    expect(result.debtService).toBe(5000);
    expect(result.dscr).toBe(3.0);
  });

  test('makeSnapshot fixture provides valid defaults', () => {
    const snap = makeSnapshot();
    const result = computeDSCR(
      snap.periodIndex,
      snap.trailingPeriods,
      snap.entityPLRows,
      snap.debtScheduleRows
    );
    expect(result.portfolioEbitda).toBe(0);
    expect(result.debtService).toBe(0);
    expect(result.dscr).toBe(Infinity);
  });
});
