'use strict';

const {
  calculateXIRR,
  allocateEVByEBITDA,
  runSPVWaterfall,
  computeLiquidityEvent,
  generatePeriods
} = require('../../src/lib/modelEngine');

const {
  makeModel,
  makeEquityEntry,
  makeExitEvent
} = require('../helpers/fixtures');

// ─── calculateXIRR ─────────────────────────────────────────────────

describe('calculateXIRR', () => {
  test('simple 2-year doubling → ~41.4% IRR', () => {
    const cashFlows = [
      { amount: -100000, date: '2025-01-01' },
      { amount: 200000, date: '2027-01-01' }
    ];
    const result = calculateXIRR(cashFlows);
    expect(result.converged).toBe(true);
    // 2× in 2 years: (1+r)^2 = 2 → r = √2 - 1 ≈ 0.4142
    expect(result.irr).toBeCloseTo(0.4142, 1);
    expect(result.moic).toBeCloseTo(2.0, 2);
    expect(result.warning).toBeNull();
  });

  test('3× return over 3 years → ~44% IRR', () => {
    const cashFlows = [
      { amount: -500000, date: '2025-01-01' },
      { amount: 1500000, date: '2028-01-01' }
    ];
    const result = calculateXIRR(cashFlows);
    expect(result.converged).toBe(true);
    // 500k → 1.5M in 3 years: (1.5/0.5)^(1/3) - 1 ≈ 0.4422
    expect(result.irr).toBeCloseTo(0.4422, 1);
    expect(result.moic).toBeCloseTo(3.0, 2);
  });

  test('loss scenario → negative IRR', () => {
    const cashFlows = [
      { amount: -1000000, date: '2025-01-01' },
      { amount: 500000, date: '2028-01-01' }
    ];
    const result = calculateXIRR(cashFlows);
    expect(result.converged).toBe(true);
    expect(result.irr).toBeLessThan(0);
    expect(result.moic).toBeCloseTo(0.5, 2);
  });

  test('multiple cash flows (recap + exit)', () => {
    const cashFlows = [
      { amount: -739500, date: '2025-01-01' },
      { amount: 400000, date: '2028-01-01' }, // recap dividend
      { amount: 2000000, date: '2030-01-01' }  // full exit
    ];
    const result = calculateXIRR(cashFlows);
    expect(result.converged).toBe(true);
    expect(result.irr).toBeGreaterThan(0);
    expect(result.moic).toBeCloseTo((400000 + 2000000) / 739500, 2);
  });

  test('insufficient flows returns null IRR', () => {
    const result = calculateXIRR([{ amount: -100000, date: '2025-01-01' }]);
    expect(result.irr).toBeNull();
    expect(result.warning).toBe('insufficient_flows');
  });

  test('no sign change returns null IRR', () => {
    const result = calculateXIRR([
      { amount: 100000, date: '2025-01-01' },
      { amount: 200000, date: '2026-01-01' }
    ]);
    expect(result.irr).toBeNull();
    expect(result.warning).toBe('no_sign_change');
  });

  test('empty input returns null', () => {
    const result = calculateXIRR([]);
    expect(result.irr).toBeNull();
    expect(result.warning).toBe('insufficient_flows');
  });

  test('breakeven → 0% IRR', () => {
    const cashFlows = [
      { amount: -100000, date: '2025-01-01' },
      { amount: 100000, date: '2028-01-01' }
    ];
    const result = calculateXIRR(cashFlows);
    expect(result.converged).toBe(true);
    expect(result.irr).toBeCloseTo(0, 1);
    expect(result.moic).toBeCloseTo(1.0, 2);
  });
});

// ─── allocateEVByEBITDA ────────────────────────────────────────────

describe('allocateEVByEBITDA', () => {
  const entities = [
    { entityId: 'spv-a', ebitda: 2000000, acquisitionCost: 3000000 },
    { entityId: 'spv-b', ebitda: 1000000, acquisitionCost: 2000000 },
    { entityId: 'spv-c', ebitda: 500000, acquisitionCost: 1000000 }
  ];

  test('ebitda_contribution method allocates proportionally', () => {
    const result = allocateEVByEBITDA(entities, 10000000, 'ebitda_contribution');
    expect(result).toHaveLength(3);
    // Total EBITDA = 3.5M → SPV-A = 2/3.5, SPV-B = 1/3.5, SPV-C = 0.5/3.5
    expect(result[0].allocatedAmount).toBeCloseTo(5714285.71, 0);
    expect(result[0].allocationPct).toBeCloseTo(2 / 3.5, 4);
    expect(result[1].allocatedAmount).toBeCloseTo(2857142.86, 0);
    expect(result[2].allocatedAmount).toBeCloseTo(1428571.43, 0);
  });

  test('acquisition_cost method allocates by cost', () => {
    const result = allocateEVByEBITDA(entities, 10000000, 'acquisition_cost');
    // Total cost = 6M → SPV-A = 3/6, SPV-B = 2/6, SPV-C = 1/6
    expect(result[0].allocatedAmount).toBeCloseTo(5000000, 0);
    expect(result[1].allocatedAmount).toBeCloseTo(3333333.33, 0);
    expect(result[2].allocatedAmount).toBeCloseTo(1666666.67, 0);
  });

  test('zero total EBITDA falls back to equal split', () => {
    const zeroEntities = [
      { entityId: 'a', ebitda: 0, acquisitionCost: 0 },
      { entityId: 'b', ebitda: 0, acquisitionCost: 0 }
    ];
    const result = allocateEVByEBITDA(zeroEntities, 1000000, 'ebitda_contribution');
    expect(result[0].allocatedAmount).toBe(500000);
    expect(result[1].allocatedAmount).toBe(500000);
  });
});

// ─── runSPVWaterfall ───────────────────────────────────────────────

describe('runSPVWaterfall', () => {
  test('basic 2-party waterfall with carry', () => {
    const equityTable = [
      {
        partyName: 'Sponsor', partyType: 'sponsor',
        baseEquityPct: 0.60, carryPct: 0.20, hurdleRateAnnual: 0.08,
        contributedCapital: 600000, contributionPeriodIndex: 0
      },
      {
        partyName: 'LP', partyType: 'lp',
        baseEquityPct: 0.40, carryPct: 0, hurdleRateAnnual: 0.08,
        contributedCapital: 400000, contributionPeriodIndex: 0
      }
    ];

    const result = runSPVWaterfall(3000000, equityTable, 3);

    // Step 1: Return capital: Sponsor 600k, LP 400k → remaining 2M
    expect(result[0].returnOfCapital).toBe(600000);
    expect(result[1].returnOfCapital).toBe(400000);

    // Step 2: Preferred return: Sponsor 600k×8%×3=144k, LP 400k×8%×3=96k → remaining 1.76M
    expect(result[0].preferredReturn).toBeCloseTo(144000, 0);
    expect(result[1].preferredReturn).toBeCloseTo(96000, 0);

    // Step 3: Catch-up: Sponsor gets 20%/(1-20%) × remaining
    expect(result[0].catchUp).toBeGreaterThan(0);

    // Total should sum to allocated pool
    const totalDistributed = result.reduce((s, r) => s + r.totalProceeds, 0);
    expect(totalDistributed).toBeCloseTo(3000000, 0);
  });

  test('insufficient proceeds — pro rata capital return', () => {
    const equityTable = [
      {
        partyName: 'Sponsor', partyType: 'sponsor',
        baseEquityPct: 0.60, carryPct: 0.20, hurdleRateAnnual: 0.08,
        contributedCapital: 600000, contributionPeriodIndex: 0
      },
      {
        partyName: 'LP', partyType: 'lp',
        baseEquityPct: 0.40, carryPct: 0, hurdleRateAnnual: 0.08,
        contributedCapital: 400000, contributionPeriodIndex: 0
      }
    ];

    // Only 500k to distribute against 1M contributed
    const result = runSPVWaterfall(500000, equityTable, 3);

    // Pro rata at base_equity_pct: 60% and 40%
    expect(result[0].returnOfCapital).toBeCloseTo(300000, 0);
    expect(result[1].returnOfCapital).toBeCloseTo(200000, 0);
    expect(result[0].preferredReturn).toBe(0);
    expect(result[1].preferredReturn).toBe(0);
    expect(result[0].profit).toBeLessThan(0); // loss
  });

  test('no carry when below hurdle', () => {
    const equityTable = [
      {
        partyName: 'Sponsor', partyType: 'sponsor',
        baseEquityPct: 0.60, carryPct: 0.20, hurdleRateAnnual: 0.08,
        contributedCapital: 600000, contributionPeriodIndex: 0
      },
      {
        partyName: 'LP', partyType: 'lp',
        baseEquityPct: 0.40, carryPct: 0, hurdleRateAnnual: 0.08,
        contributedCapital: 400000, contributionPeriodIndex: 0
      }
    ];

    // 1.1M distributed against 1M contributed + 240k pref = 1.24M needed
    // Only 1.1M → partial preferred, no catch-up
    const result = runSPVWaterfall(1100000, equityTable, 3);
    expect(result[0].catchUp).toBe(0);
    expect(result[0].residual).toBe(0);
  });

  test('single party gets everything', () => {
    const equityTable = [
      {
        partyName: 'Solo', partyType: 'sponsor',
        baseEquityPct: 1.0, carryPct: 0, hurdleRateAnnual: 0,
        contributedCapital: 500000, contributionPeriodIndex: 0
      }
    ];

    const result = runSPVWaterfall(2000000, equityTable, 3);
    expect(result[0].totalProceeds).toBe(2000000);
    expect(result[0].profit).toBe(1500000);
  });
});

// ─── computeLiquidityEvent ─────────────────────────────────────────

describe('computeLiquidityEvent', () => {
  const model = makeModel({ start_date: '2025-01-01', period_count: 60 });
  const periods = generatePeriods(model);

  // Two SPVs, one closing at period 0, one at period 12
  const entityPLGrids = [
    {
      entityId: 'spv-a',
      grid: Array.from({ length: 60 }, (_, i) => ({
        periodIndex: i,
        ebitda: i >= 0 ? 150000 : 0, // 150k/mo = 1.8M TTM
        revenue: 300000, cogs: 100000, opex: 50000
      }))
    },
    {
      entityId: 'spv-b',
      grid: Array.from({ length: 60 }, (_, i) => ({
        periodIndex: i,
        ebitda: i >= 12 ? 100000 : 0, // 100k/mo = 1.2M TTM after close
        revenue: 200000, cogs: 60000, opex: 40000
      }))
    }
  ];

  const debtSchedules = [
    {
      entityId: 'spv-a', instrumentName: 'Senior Facility', instrumentType: 'facility',
      schedule: Array.from({ length: 60 }, (_, i) => ({
        periodIndex: i,
        endingBalance: Math.max(0, 2000000 - i * 25000),
        beginningBalance: i === 0 ? 0 : Math.max(0, 2000000 - (i - 1) * 25000),
        cashPrincipal: 25000, cashInterest: 15000, pikInterest: 0,
        newBorrowings: i === 0 ? 2000000 : 0, balloonPayment: 0
      }))
    },
    {
      entityId: 'spv-a', instrumentName: 'Seller Note', instrumentType: 'seller_note',
      schedule: Array.from({ length: 60 }, (_, i) => ({
        periodIndex: i,
        endingBalance: Math.max(0, 500000 - i * 8333),
        beginningBalance: i === 0 ? 0 : Math.max(0, 500000 - (i - 1) * 8333),
        cashPrincipal: 8333, cashInterest: 2500, pikInterest: 0,
        newBorrowings: i === 0 ? 500000 : 0, balloonPayment: 0
      }))
    }
  ];

  const equityTables = [
    {
      entityId: 'spv-a',
      entries: [
        makeEquityEntry({ party_name: 'Tristan', party_type: 'sponsor', base_equity_pct: 0.60, carry_pct: 0.20, hurdle_rate_annual: 0.08, contributed_capital: 600000, contribution_period_index: 0 }),
        makeEquityEntry({ party_name: 'Partner', party_type: 'partner', base_equity_pct: 0.40, carry_pct: 0, hurdle_rate_annual: 0.08, contributed_capital: 400000, contribution_period_index: 0 })
      ]
    },
    {
      entityId: 'spv-b',
      entries: [
        makeEquityEntry({ party_name: 'Tristan', party_type: 'sponsor', base_equity_pct: 0.75, carry_pct: 0.20, hurdle_rate_annual: 0.08, contributed_capital: 375000, contribution_period_index: 12 }),
        makeEquityEntry({ party_name: 'Investor A', party_type: 'lp', base_equity_pct: 0.25, carry_pct: 0, hurdle_rate_annual: 0.08, contributed_capital: 125000, contribution_period_index: 12 })
      ]
    }
  ];

  const dealTerms = [
    { entityId: 'spv-a', purchasePrice: 3000000 },
    { entityId: 'spv-b', purchasePrice: 2000000 }
  ];

  test('full exit at period 35 produces valid waterfall', () => {
    const exitEvent = makeExitEvent({
      event_period_index: 35,
      exit_multiple_base: 6.0,
      exit_multiple_low: 5.0,
      exit_multiple_high: 7.0
    });

    const result = computeLiquidityEvent({
      exitEvent, entityPLGrids, debtSchedules, equityTables, model, periods, dealTerms
    });

    expect(result.exitType).toBe('full_exit');
    expect(result.platformEBITDA).toBeGreaterThan(0);
    expect(result.cases.base).toBeDefined();
    expect(result.cases.low).toBeDefined();
    expect(result.cases.high).toBeDefined();

    // Base case: GEV = platformEBITDA × 6.0
    const baseCase = result.cases.base;
    expect(baseCase.grossEV).toBe(result.platformEBITDA * 6.0);
    expect(baseCase.txCosts).toBe(baseCase.grossEV * 0.04);
    expect(baseCase.netEquityPool).toBeGreaterThan(0);

    // All parties should have results
    expect(baseCase.partyResults.length).toBeGreaterThan(0);
    // Tristan should appear (participates in both SPVs)
    const tristan = baseCase.partyResults.find(p => p.partyName === 'Tristan');
    expect(tristan).toBeDefined();
    expect(tristan.totalProceeds).toBeGreaterThan(0);
    expect(tristan.moic).toBeGreaterThan(0);
  });

  test('recapitalization produces dividend and warnings', () => {
    const exitEvent = makeExitEvent({
      exit_type: 'recapitalization',
      event_name: 'Month 36 Recap',
      event_period_index: 35,
      recap_leverage_multiple: 5.0,
      recap_refi_costs_pct: 0.02,
      recap_new_facility_term_months: 84
    });

    const result = computeLiquidityEvent({
      exitEvent, entityPLGrids, debtSchedules, equityTables, model, periods, dealTerms
    });

    expect(result.exitType).toBe('recapitalization');
    expect(result.newFacilitySize).toBe(result.platformEBITDA * 5.0);
    expect(result.refiCosts).toBe(result.newFacilitySize * 0.02);
    expect(result.postRecapDebt).toBeDefined();

    // Party results should not have IRR (recap is not terminal)
    for (const p of result.partyResults) {
      expect(p.irr).toBeNull();
      expect(p.irrWarning).toBe('recap_partial');
    }
  });

  test('recap not accretive when leverage too low', () => {
    const exitEvent = makeExitEvent({
      exit_type: 'recapitalization',
      event_period_index: 5, // Early, lots of debt remaining
      recap_leverage_multiple: 0.5, // Very low
      recap_refi_costs_pct: 0.02
    });

    const result = computeLiquidityEvent({
      exitEvent, entityPLGrids, debtSchedules, equityTables, model, periods, dealTerms
    });

    expect(result.warnings).toContain('recap_not_accretive');
    expect(result.dividendPool).toBe(0);
  });

  test('high exit case produces higher proceeds than low', () => {
    const exitEvent = makeExitEvent({ event_period_index: 35 });
    const result = computeLiquidityEvent({
      exitEvent, entityPLGrids, debtSchedules, equityTables, model, periods, dealTerms
    });

    expect(result.cases.high.grossEV).toBeGreaterThan(result.cases.low.grossEV);
    expect(result.cases.high.netEquityPool).toBeGreaterThan(result.cases.low.netEquityPool);
  });

  test('SPV without equity table gets warning', () => {
    const exitEvent = makeExitEvent({ event_period_index: 35 });
    const result = computeLiquidityEvent({
      exitEvent, entityPLGrids, debtSchedules,
      equityTables: [equityTables[0]], // Only SPV-A has equity
      model, periods, dealTerms
    });

    const spvB = result.cases.base.spvWaterfalls.find(s => s.entityId === 'spv-b');
    expect(spvB.warning).toBe('no_equity_table');
  });
});
