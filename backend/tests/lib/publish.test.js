'use strict';

const { computeKeyMetrics } = require('../../src/lib/modelEngine');
const { makePublishRun, makeWaterfallResult } = require('../helpers/fixtures');

describe('computeKeyMetrics', () => {
  test('extracts DSCR min and avg from runs with debt service', () => {
    const run = makePublishRun();
    const result = computeKeyMetrics([run], []);

    expect(result.dscrMin).toBeGreaterThan(0);
    expect(result.dscrAvg).toBeGreaterThan(0);
    // EBITDA per period = 40000, debt service per period = 15000 + 20000 = 35000
    // DSCR = 40000 / 35000 ≈ 1.143
    expect(result.dscrMin).toBeCloseTo(40000 / 35000, 2);
    expect(result.dscrAvg).toBeCloseTo(40000 / 35000, 2);
  });

  test('returns Infinity DSCR when no debt schedules', () => {
    const run = makePublishRun({ debtSchedules: [] });
    const result = computeKeyMetrics([run], []);

    expect(result.dscrMin).toBe(Infinity);
    expect(result.dscrAvg).toBe(Infinity);
  });

  test('returns Infinity DSCR when runs array is empty', () => {
    const result = computeKeyMetrics([], []);
    expect(result.dscrMin).toBe(Infinity);
    expect(result.dscrAvg).toBe(Infinity);
  });

  test('extracts MOIC and IRR by party from waterfall results', () => {
    const wf = makeWaterfallResult();
    const result = computeKeyMetrics([], [wf]);

    expect(result.moicByParty['Sponsor']).toBe(1.67);
    expect(result.moicByParty['Co-Investor']).toBe(1.16);
    expect(result.irrByParty['Sponsor']).toBe(0.18);
    expect(result.irrByParty['Co-Investor']).toBe(0.05);
  });

  test('returns empty MOIC/IRR when no waterfall results', () => {
    const result = computeKeyMetrics([], []);
    expect(result.moicByParty).toEqual({});
    expect(result.irrByParty).toEqual({});
  });

  test('computes leverage at close from first run', () => {
    const run = makePublishRun();
    const result = computeKeyMetrics([run], []);

    // newBorrowings at period 0 = 2000000, totalEquity at period 0 = 2000000
    expect(result.leverageAtClose).toBeCloseTo(1.0, 2);
  });

  test('returns null leverage when no BS results', () => {
    const run = makePublishRun({ entityBSResults: [] });
    const result = computeKeyMetrics([run], []);
    expect(result.leverageAtClose).toBeNull();
  });

  test('handles null/undefined inputs gracefully', () => {
    const result = computeKeyMetrics(null, null);
    expect(result.dscrMin).toBe(Infinity);
    expect(result.dscrAvg).toBe(Infinity);
    expect(result.moicByParty).toEqual({});
    expect(result.irrByParty).toEqual({});
    expect(result.leverageAtClose).toBeNull();
  });

  test('handles single entity with no revenue (DSCR = 0)', () => {
    const run = makePublishRun({
      entityResults: [{
        entityId: 'e1',
        grid: [{ periodIndex: 0, ebitda: 0 }],
        lineItemValues: {}
      }],
      debtSchedules: [{
        entityId: 'e1',
        instrumentName: 'Facility',
        instrumentType: 'facility',
        schedule: [{ periodIndex: 0, cashInterest: 10000, cashPrincipal: 5000, endingBalance: 1000000, newBorrowings: 0 }]
      }]
    });

    const result = computeKeyMetrics([run], []);
    expect(result.dscrMin).toBe(0);
    expect(result.dscrAvg).toBe(0);
  });
});
