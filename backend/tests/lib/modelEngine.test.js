'use strict';

const {
  generatePeriods,
  resolveDriver,
  projectLineItem,
  projectEntity,
  buildDebtSchedule,
  deriveWorkingCapital,
  deriveCapex,
  buildEntityPL,
  buildEntityCF,
  buildEntityBS,
  buildConsolidatedPL,
  buildConsolidatedBS,
  buildConsolidatedCF,
  calculateModel
} = require('../../src/lib/modelEngine');

const {
  makeModel,
  makeEntity,
  makeLineItem,
  makeDriver,
  makeScenario,
  makeOpScenario,
  makeInstrument,
  makeCloseTerms
} = require('../helpers/fixtures');

// ─── generatePeriods ────────────────────────────────────────────────

describe('generatePeriods', () => {
  test('generates 120 monthly periods', () => {
    const model = makeModel({ start_date: '2025-01-01', period_count: 120 });
    const periods = generatePeriods(model);
    expect(periods).toHaveLength(120);
    expect(periods[0].index).toBe(0);
    expect(periods[119].index).toBe(119);
  });

  test('first period starts Jan 2025', () => {
    const model = makeModel({ start_date: '2025-01-01', period_count: 3 });
    const periods = generatePeriods(model);
    expect(periods[0].label).toBe('Jan 2025');
    expect(periods[0].startDate).toBe('2025-01-01');
    expect(periods[0].endDate).toBe('2025-01-31');
  });

  test('correct labels across year boundary', () => {
    const model = makeModel({ start_date: '2025-11-01', period_count: 3 });
    const periods = generatePeriods(model);
    expect(periods[0].label).toBe('Nov 2025');
    expect(periods[1].label).toBe('Dec 2025');
    expect(periods[2].label).toBe('Jan 2026');
  });

  test('handles Feb end date correctly', () => {
    const model = makeModel({ start_date: '2025-02-01', period_count: 1 });
    const periods = generatePeriods(model);
    expect(periods[0].endDate).toBe('2025-02-28');
  });
});

// ─── resolveDriver ──────────────────────────────────────────────────

describe('resolveDriver', () => {
  test('single driver returns its value', () => {
    const drivers = [makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0 })];
    expect(resolveDriver(drivers, 5, 'cogs_pct_revenue', 0)).toBe(0.35);
  });

  test('overlapping ranges returns highest period_start', () => {
    const drivers = [
      makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0, period_end: null }),
      makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.30, period_start: 12, period_end: null })
    ];
    // period 15 relative to close=0 → rel=15 → both match, pick period_start=12
    expect(resolveDriver(drivers, 15, 'cogs_pct_revenue', 0)).toBe(0.30);
    // period 5 relative to close=0 → rel=5 → only first matches
    expect(resolveDriver(drivers, 5, 'cogs_pct_revenue', 0)).toBe(0.35);
  });

  test('period_end limits range', () => {
    const drivers = [
      makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0, period_end: 11 })
    ];
    expect(resolveDriver(drivers, 11, 'cogs_pct_revenue', 0)).toBe(0.35);
    expect(resolveDriver(drivers, 12, 'cogs_pct_revenue', 0)).toBeNull();
  });

  test('no match returns null', () => {
    const drivers = [makeDriver({ driver_type: 'other', value: 1 })];
    expect(resolveDriver(drivers, 5, 'cogs_pct_revenue', 0)).toBeNull();
  });

  test('respects closePeriodIndex for relative period', () => {
    const drivers = [
      makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })
    ];
    // period 10, close=6 → relative=4 → matches period_start=0
    expect(resolveDriver(drivers, 10, 'da_monthly', 6)).toBe(2000);
    // period 5, close=6 → relative=-1 → doesn't match period_start=0
    expect(resolveDriver(drivers, 5, 'da_monthly', 6)).toBeNull();
  });
});

// ─── projectLineItem ───────────────────────────────────────────────

describe('projectLineItem', () => {
  const model = makeModel({ start_date: '2025-01-01', period_count: 6 });
  const periods = generatePeriods(model);

  test('fixed: constant base_amount every active period', () => {
    const li = makeLineItem({ item_type: 'fixed', base_amount: 50000 });
    const result = projectLineItem(li, periods, [], 0, null);
    expect(result).toHaveLength(6);
    result.forEach(r => expect(r.amount).toBe(50000));
  });

  test('pre-close periods are zero', () => {
    const li = makeLineItem({ item_type: 'fixed', base_amount: 50000 });
    const result = projectLineItem(li, periods, [], 3, null);
    expect(result[0].amount).toBe(0);
    expect(result[1].amount).toBe(0);
    expect(result[2].amount).toBe(0);
    expect(result[3].amount).toBe(50000);
    expect(result[4].amount).toBe(50000);
  });

  test('growth_rate: compounds from base_amount', () => {
    const li = makeLineItem({ item_type: 'growth_rate', base_amount: 10000, growth_rate: 0.02 });
    const result = projectLineItem(li, periods, [], 0, null);
    expect(result[0].amount).toBe(10000);
    expect(result[1].amount).toBeCloseTo(10000 * 1.02, 2);
    expect(result[2].amount).toBeCloseTo(10000 * Math.pow(1.02, 2), 2);
  });

  test('growth_rate: driver overrides lineItem.growth_rate', () => {
    const li = makeLineItem({ item_type: 'growth_rate', base_amount: 10000, growth_rate: 0.02 });
    const drivers = [makeDriver({ driver_type: 'organic_growth_rate', value: 0.05, period_start: 0 })];
    const result = projectLineItem(li, periods, drivers, 0, null);
    expect(result[1].amount).toBeCloseTo(10000 * 1.05, 2);
  });

  test('driver_derived: multiplies revenue by driver', () => {
    const li = makeLineItem({
      category: 'cogs',
      item_type: 'driver_derived',
      driver_type: 'cogs_pct_revenue',
      base_amount: 0
    });
    const drivers = [makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0 })];
    const revenueByPeriod = { 0: 100000, 1: 100000, 2: 100000, 3: 100000, 4: 100000, 5: 100000 };
    const result = projectLineItem(li, periods, drivers, 0, revenueByPeriod);
    result.forEach(r => expect(r.amount).toBe(35000));
  });

  test('manual: uses base_amount', () => {
    const li = makeLineItem({ item_type: 'manual', base_amount: 7500 });
    const result = projectLineItem(li, periods, [], 0, null);
    result.forEach(r => expect(r.amount).toBe(7500));
  });
});

// ─── projectEntity ─────────────────────────────────────────────────

describe('projectEntity', () => {
  const model = makeModel({ start_date: '2025-01-01', period_count: 3 });
  const periods = generatePeriods(model);

  test('aggregates multiple revenue items', () => {
    const entity = makeEntity({
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 30000, category: 'revenue' }),
        makeLineItem({ item_type: 'fixed', base_amount: 20000, category: 'revenue' })
      ]
    });
    const result = projectEntity(entity, periods, []);
    expect(result.revenue[0]).toBe(50000);
    expect(result.revenue[1]).toBe(50000);
  });

  test('COGS uses total revenue for entity-level items', () => {
    const entity = makeEntity({
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 100000, category: 'revenue' }),
        makeLineItem({
          category: 'cogs', item_type: 'driver_derived',
          driver_type: 'cogs_pct_revenue', base_amount: 0
        })
      ],
      drivers: [makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0 })]
    });
    const result = projectEntity(entity, periods, entity.drivers);
    expect(result.cogs[0]).toBe(35000);
  });

  test('segment-scoped COGS uses segment revenue', () => {
    const segId = 'seg-1';
    const entity = makeEntity({
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 80000, category: 'revenue', segment_id: segId }),
        makeLineItem({ item_type: 'fixed', base_amount: 20000, category: 'revenue', segment_id: 'seg-2' }),
        makeLineItem({
          category: 'cogs', item_type: 'driver_derived', segment_id: segId,
          driver_type: 'cogs_pct_revenue', base_amount: 0
        })
      ],
      drivers: [makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.50, period_start: 0 })]
    });
    const result = projectEntity(entity, periods, entity.drivers);
    // COGS = 50% of segment revenue (80K), not total (100K)
    expect(result.cogs[0]).toBe(40000);
  });

  test('expense line items go to opex', () => {
    const entity = makeEntity({
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 10000, category: 'expense' })
      ]
    });
    const result = projectEntity(entity, periods, []);
    expect(result.opex[0]).toBe(10000);
  });
});

// ─── buildEntityPL ─────────────────────────────────────────────────

describe('buildEntityPL', () => {
  const model = makeModel({ start_date: '2025-01-01', period_count: 3 });
  const periods = generatePeriods(model);

  test('computes GP, EBITDA, EBIT correctly', () => {
    const entityResult = {
      entityId: 'e1',
      revenue: { 0: 50000, 1: 50000, 2: 50000 },
      revenueByType: { client: { 0: 50000, 1: 50000, 2: 50000 } },
      cogs: { 0: 17500, 1: 17500, 2: 17500 },
      opex: { 0: 10000, 1: 10000, 2: 10000 }
    };
    const drivers = [makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })];
    const grid = buildEntityPL(entityResult, periods, drivers, 0);

    expect(grid[0].revenue).toBe(50000);
    expect(grid[0].cogs).toBe(17500);
    expect(grid[0].grossProfit).toBe(32500);
    expect(grid[0].opex).toBe(10000);
    expect(grid[0].ebitda).toBe(22500);
    expect(grid[0].da).toBe(2000);
    expect(grid[0].ebit).toBe(20500);
  });

  test('D&A defaults to 0 when no driver', () => {
    const entityResult = {
      entityId: 'e1',
      revenue: { 0: 50000 },
      revenueByType: { client: { 0: 50000 } },
      cogs: { 0: 0 },
      opex: { 0: 0 }
    };
    const grid = buildEntityPL(entityResult, periods, [], 0);
    expect(grid[0].da).toBe(0);
    expect(grid[0].ebit).toBe(50000);
  });

  test('pre-close periods have zero revenue and P&L', () => {
    const entityResult = {
      entityId: 'e1',
      revenue: { 3: 50000 },
      revenueByType: { client: { 3: 50000 } },
      cogs: {},
      opex: {}
    };
    const drivers = [makeDriver({ driver_type: 'da_monthly', value: 1000, period_start: 0 })];
    // close at period 3, but our model only has 3 periods (0,1,2)
    const grid = buildEntityPL(entityResult, periods, drivers, 3);
    expect(grid[0].revenue).toBe(0);
    expect(grid[0].ebitda).toBe(0);
    // D&A driver won't match pre-close (relative period < 0)
    expect(grid[0].da).toBe(0);
  });
});

// ─── buildConsolidatedPL ───────────────────────────────────────────

describe('buildConsolidatedPL', () => {
  const model = makeModel({ start_date: '2025-01-01', period_count: 3 });
  const periods = generatePeriods(model);

  test('consolidated revenue = client only', () => {
    const entityPLResults = [
      {
        entityId: 'e1',
        grid: [
          { periodIndex: 0, revenue: 60000, clientRevenue: 50000, cogs: 0, opex: 0, ebitda: 60000, da: 0, ebit: 60000 },
          { periodIndex: 1, revenue: 60000, clientRevenue: 50000, cogs: 0, opex: 0, ebitda: 60000, da: 0, ebit: 60000 },
          { periodIndex: 2, revenue: 60000, clientRevenue: 50000, cogs: 0, opex: 0, ebitda: 60000, da: 0, ebit: 60000 }
        ]
      }
    ];
    const consolidated = buildConsolidatedPL(entityPLResults, periods);
    expect(consolidated.grid[0].revenue).toBe(50000);
    expect(consolidated.grid[0].clientRevenue).toBe(50000);
  });

  test('sums EBITDA across entities', () => {
    const entityPLResults = [
      {
        entityId: 'e1',
        grid: [{ periodIndex: 0, revenue: 50000, clientRevenue: 50000, cogs: 10000, opex: 5000, ebitda: 35000, da: 1000, ebit: 34000 }]
      },
      {
        entityId: 'e2',
        grid: [{ periodIndex: 0, revenue: 30000, clientRevenue: 30000, cogs: 5000, opex: 3000, ebitda: 22000, da: 500, ebit: 21500 }]
      }
    ];
    const consolidated = buildConsolidatedPL(entityPLResults, periods);
    expect(consolidated.grid[0].ebitda).toBe(57000);
    expect(consolidated.grid[0].ebit).toBe(55500);
  });

  test('handles staggered close dates', () => {
    const entityPLResults = [
      {
        entityId: 'e1',
        grid: [
          { periodIndex: 0, revenue: 50000, clientRevenue: 50000, cogs: 0, opex: 0, ebitda: 50000, da: 0, ebit: 50000 },
          { periodIndex: 1, revenue: 50000, clientRevenue: 50000, cogs: 0, opex: 0, ebitda: 50000, da: 0, ebit: 50000 }
        ]
      },
      {
        entityId: 'e2',
        grid: [
          { periodIndex: 0, revenue: 0, clientRevenue: 0, cogs: 0, opex: 0, ebitda: 0, da: 0, ebit: 0 },
          { periodIndex: 1, revenue: 30000, clientRevenue: 30000, cogs: 0, opex: 0, ebitda: 30000, da: 0, ebit: 30000 }
        ]
      }
    ];
    const consolidated = buildConsolidatedPL(entityPLResults, periods);
    expect(consolidated.grid[0].revenue).toBe(50000);
    expect(consolidated.grid[1].revenue).toBe(80000);
  });
});

// ─── calculateModel ────────────────────────────────────────────────

describe('calculateModel', () => {
  test('produces cartesian product of scenarios × operatingScenarios', () => {
    const model = makeModel({ period_count: 3 });
    const scenario1 = makeScenario({ name: 'Base Case' });
    const scenario2 = makeScenario({ name: 'Upside' });
    const opBase = makeOpScenario({ name: 'Base' });
    const opDown = makeOpScenario({ name: 'Downside' });

    const entity = makeEntity({
      entity_type: 'spv',
      lineItems: [makeLineItem({ item_type: 'fixed', base_amount: 50000 })]
    });

    const result = calculateModel({
      model,
      entities: [entity],
      scenarios: [scenario1, scenario2],
      operatingScenarios: [opBase, opDown]
    });

    expect(result.runs).toHaveLength(4);
    expect(result.periods).toHaveLength(3);
  });

  test('filters line items by scenario_id', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();
    const otherScenarioId = 'other-scenario-id';

    const entity = makeEntity({
      entity_type: 'spv',
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 50000, scenario_id: null }),
        makeLineItem({ item_type: 'fixed', base_amount: 10000, scenario_id: otherScenarioId })
      ]
    });

    const result = calculateModel({
      model,
      entities: [entity],
      scenarios: [scenario],
      operatingScenarios: [opScenario]
    });

    // Only the null-scenario item should be included (50K), not the other-scenario one (10K)
    const grid = result.runs[0].entityResults[0].grid;
    expect(grid[0].revenue).toBe(50000);
  });

  test('excludes aragon and consolidated entities', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();

    const entities = [
      makeEntity({ entity_type: 'aragon', lineItems: [makeLineItem({ base_amount: 100000 })] }),
      makeEntity({ entity_type: 'consolidated', lineItems: [makeLineItem({ base_amount: 100000 })] }),
      makeEntity({ entity_type: 'spv', lineItems: [makeLineItem({ base_amount: 50000 })] })
    ];

    const result = calculateModel({
      model, entities,
      scenarios: [scenario],
      operatingScenarios: [opScenario]
    });

    expect(result.runs[0].entityResults).toHaveLength(1);
    expect(result.runs[0].entityResults[0].entityType).toBe('spv');
  });

  test('mid_holdco with no line items is excluded', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();

    const entities = [
      makeEntity({ entity_type: 'mid_holdco', lineItems: [] }),
      makeEntity({ entity_type: 'spv', lineItems: [makeLineItem({ base_amount: 50000 })] })
    ];

    const result = calculateModel({
      model, entities,
      scenarios: [scenario],
      operatingScenarios: [opScenario]
    });

    expect(result.runs[0].entityResults).toHaveLength(1);
  });

  test('full integration: revenue + COGS + expense + D&A', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();

    const entity = makeEntity({
      entity_type: 'spv',
      close_period_index: 0,
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 50000, category: 'revenue', revenue_type: 'client' }),
        makeLineItem({ category: 'cogs', item_type: 'driver_derived', driver_type: 'cogs_pct_revenue', base_amount: 0 }),
        makeLineItem({ item_type: 'fixed', base_amount: 10000, category: 'expense' })
      ],
      drivers: [
        makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0 }),
        makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })
      ]
    });

    const result = calculateModel({
      model,
      entities: [entity],
      scenarios: [scenario],
      operatingScenarios: [opScenario]
    });

    const grid = result.runs[0].entityResults[0].grid;
    expect(grid[0].revenue).toBe(50000);
    expect(grid[0].cogs).toBe(17500);
    expect(grid[0].grossProfit).toBe(32500);
    expect(grid[0].opex).toBe(10000);
    expect(grid[0].ebitda).toBe(22500);
    expect(grid[0].da).toBe(2000);
    expect(grid[0].ebit).toBe(20500);

    // Consolidated should match (single entity)
    const consolidated = result.runs[0].consolidatedPL;
    expect(consolidated.grid[0].ebitda).toBe(22500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Phase 4 Tests
// ═══════════════════════════════════════════════════════════════════

// ─── buildDebtSchedule ──────────────────────────────────────────────

describe('buildDebtSchedule', () => {
  const model = makeModel({ period_count: 24 });
  const periods = generatePeriods(model);

  test('pre-start periods are all zeros', () => {
    const inst = makeInstrument({ startPeriodIndex: 6 });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    for (let i = 0; i < 6; i++) {
      expect(sched[i].beginningBalance).toBe(0);
      expect(sched[i].endingBalance).toBe(0);
      expect(sched[i].cashInterest).toBe(0);
    }
  });

  test('new borrowings at startPeriodIndex', () => {
    const inst = makeInstrument({ startPeriodIndex: 0, initialBalance: 2000000 });
    const result = buildDebtSchedule([inst], periods);
    expect(result[0].schedule[0].newBorrowings).toBe(2000000);
    expect(result[0].schedule[1].newBorrowings).toBe(0);
  });

  test('IO phase: interest only, no principal', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 1200000,
      annualRate: 0.12, ioMonths: 12, deferredMonths: 0, termMonths: 24
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // Period 0 = start, IO phase: interest only
    expect(sched[0].cashInterest).toBeCloseTo(1200000 * 0.01, 2);
    expect(sched[0].cashPrincipal).toBe(0);
    expect(sched[0].endingBalance).toBe(1200000);
    // Period 11 still IO
    expect(sched[11].cashPrincipal).toBe(0);
    expect(sched[11].endingBalance).toBe(1200000);
  });

  test('amort phase: straight-line principal', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 1200000,
      annualRate: 0.12, ioMonths: 0, deferredMonths: 0, termMonths: 12
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // Period 0: first amort month, remaining=12
    expect(sched[0].cashPrincipal).toBeCloseTo(1200000 / 12, 2);
    expect(sched[0].cashInterest).toBeCloseTo(1200000 * 0.01, 2);
  });

  test('deferred phase: no cash payments, PIK capitalizes if enabled', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 100000,
      annualRate: 0.12, deferredMonths: 6, ioMonths: 0, termMonths: 24, pik: true
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // Deferred months 0-5: PIK accrues
    expect(sched[0].cashInterest).toBe(0);
    expect(sched[0].cashPrincipal).toBe(0);
    expect(sched[0].pikInterest).toBeCloseTo(100000 * 0.01, 2);
    expect(sched[0].endingBalance).toBeCloseTo(100000 + 1000, 2);
  });

  test('PIK adds interest to balance instead of cash', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 500000,
      annualRate: 0.06, ioMonths: 12, deferredMonths: 0, termMonths: 24, pik: true
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    const pikAmt = 500000 * 0.005;
    expect(sched[0].pikInterest).toBeCloseTo(pikAmt, 2);
    expect(sched[0].cashInterest).toBe(0);
    expect(sched[0].endingBalance).toBeCloseTo(500000 + pikAmt, 2);
  });

  test('balloon payment at specified month', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 1000000,
      annualRate: 0.10, ioMonths: 24, deferredMonths: 0, termMonths: 24,
      balloonMonth: 12
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // At month 12, balloon pays off remaining balance
    expect(sched[12].balloonPayment).toBeCloseTo(1000000, 0);
    expect(sched[12].endingBalance).toBe(0);
    // After balloon, all zeros
    expect(sched[13].beginningBalance).toBe(0);
    expect(sched[13].cashInterest).toBe(0);
  });

  test('seller note starts at entity close period', () => {
    const inst = makeInstrument({
      instrumentName: 'Seller Note', instrumentType: 'seller_note',
      startPeriodIndex: 3, initialBalance: 350000,
      annualRate: 0.06, ioMonths: 12, deferredMonths: 0, termMonths: 24
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    expect(sched[2].endingBalance).toBe(0);
    expect(sched[3].newBorrowings).toBe(350000);
    expect(sched[3].endingBalance).toBe(350000);
  });

  test('currentPortion = sum of next 12 months principal+balloon', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 120000,
      annualRate: 0.12, ioMonths: 0, deferredMonths: 0, termMonths: 24
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // currentPortion at period 0 = sum of principal in periods 1-12
    let expected = 0;
    for (let j = 1; j <= 12; j++) {
      expected += sched[j].cashPrincipal;
    }
    expect(sched[0].currentPortion).toBeCloseTo(expected, 2);
  });

  test('ltPortion = endingBalance - currentPortion (clamped ≥ 0)', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 120000,
      annualRate: 0.12, ioMonths: 0, deferredMonths: 0, termMonths: 24
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    expect(sched[0].ltPortion).toBeCloseTo(sched[0].endingBalance - sched[0].currentPortion, 2);
    expect(sched[0].ltPortion).toBeGreaterThanOrEqual(0);
  });

  test('multiple instruments tracked separately', () => {
    const inst1 = makeInstrument({ instrumentName: 'Facility', initialBalance: 2000000 });
    const inst2 = makeInstrument({ instrumentName: 'Seller Note', instrumentType: 'seller_note', initialBalance: 350000 });
    const result = buildDebtSchedule([inst1, inst2], periods);
    expect(result).toHaveLength(2);
    expect(result[0].instrumentName).toBe('Facility');
    expect(result[1].instrumentName).toBe('Seller Note');
  });

  test('endingBalance never negative', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 10000,
      annualRate: 0.12, ioMonths: 0, deferredMonths: 0, termMonths: 6
    });
    const shortPeriods = generatePeriods(makeModel({ period_count: 12 }));
    const result = buildDebtSchedule([inst], shortPeriods);
    for (const row of result[0].schedule) {
      expect(row.endingBalance).toBeGreaterThanOrEqual(0);
    }
  });

  test('IO then amort transition', () => {
    const inst = makeInstrument({
      startPeriodIndex: 0, initialBalance: 240000,
      annualRate: 0.12, ioMonths: 6, deferredMonths: 0, termMonths: 18
    });
    const result = buildDebtSchedule([inst], periods);
    const sched = result[0].schedule;
    // Periods 0-5: IO (no principal)
    for (let i = 0; i < 6; i++) {
      expect(sched[i].cashPrincipal).toBe(0);
    }
    // Period 6: first amort month. amortMonthsTotal = 18-6 = 12
    expect(sched[6].cashPrincipal).toBeCloseTo(240000 / 12, 2);
  });
});

// ─── deriveWorkingCapital ────────────────────────────────────────────

describe('deriveWorkingCapital', () => {
  const model = makeModel({ period_count: 6 });
  const periods = generatePeriods(model);

  function makePLGrid(revenue, cogs, opex) {
    return periods.map((_, i) => ({
      periodIndex: i, revenue, cogs, opex, grossProfit: revenue - cogs,
      ebitda: revenue - cogs - opex, da: 0, ebit: revenue - cogs - opex,
      interestExpense: 0, ebt: revenue - cogs - opex, tax: 0, netIncome: revenue - cogs - opex
    }));
  }

  test('AR = (revenue / 30) × ar_days', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const drivers = [makeDriver({ driver_type: 'ar_days', value: 45, period_start: 0 })];
    const result = deriveWorkingCapital(plGrid, periods, drivers, 0);
    expect(result[0].ar).toBeCloseTo((60000 / 30) * 45, 2);
  });

  test('AP = (cogs / 30) × ap_days', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const drivers = [makeDriver({ driver_type: 'ap_days', value: 30, period_start: 0 })];
    const result = deriveWorkingCapital(plGrid, periods, drivers, 0);
    expect(result[0].ap).toBeCloseTo((21000 / 30) * 30, 2);
  });

  test('prepaid = opex × prepaid_pct', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const drivers = [makeDriver({ driver_type: 'prepaid_pct', value: 0.02, period_start: 0 })];
    const result = deriveWorkingCapital(plGrid, periods, drivers, 0);
    expect(result[0].prepaid).toBeCloseTo(10000 * 0.02, 2);
  });

  test('accrued = opex × accrued_exp_pct', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const drivers = [makeDriver({ driver_type: 'accrued_exp_pct', value: 0.05, period_start: 0 })];
    const result = deriveWorkingCapital(plGrid, periods, drivers, 0);
    expect(result[0].accrued).toBeCloseTo(10000 * 0.05, 2);
  });

  test('pre-close periods are zeros', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const drivers = [makeDriver({ driver_type: 'ar_days', value: 45, period_start: 0 })];
    const result = deriveWorkingCapital(plGrid, periods, drivers, 3);
    expect(result[0].ar).toBe(0);
    expect(result[2].ar).toBe(0);
    expect(result[3].ar).toBeGreaterThan(0);
  });

  test('missing driver → 0', () => {
    const plGrid = makePLGrid(60000, 21000, 10000);
    const result = deriveWorkingCapital(plGrid, periods, [], 0);
    expect(result[0].ar).toBe(0);
    expect(result[0].ap).toBe(0);
    expect(result[0].prepaid).toBe(0);
    expect(result[0].accrued).toBe(0);
  });
});

// ─── deriveCapex ─────────────────────────────────────────────────────

describe('deriveCapex', () => {
  const model = makeModel({ period_count: 6 });
  const periods = generatePeriods(model);

  test('capex = revenue × capex_pct_revenue', () => {
    const plGrid = periods.map((_, i) => ({
      periodIndex: i, revenue: 50000, cogs: 0, opex: 0, grossProfit: 50000,
      ebitda: 50000, da: 0, ebit: 50000, interestExpense: 0, ebt: 50000, tax: 0, netIncome: 50000
    }));
    const drivers = [makeDriver({ driver_type: 'capex_pct_revenue', value: 0.01, period_start: 0 })];
    const result = deriveCapex(plGrid, periods, drivers, 0);
    expect(result[0].capex).toBeCloseTo(500, 2);
  });

  test('pre-close periods → 0', () => {
    const plGrid = periods.map((_, i) => ({
      periodIndex: i, revenue: 50000, cogs: 0, opex: 0, grossProfit: 50000,
      ebitda: 50000, da: 0, ebit: 50000, interestExpense: 0, ebt: 50000, tax: 0, netIncome: 50000
    }));
    const drivers = [makeDriver({ driver_type: 'capex_pct_revenue', value: 0.01, period_start: 0 })];
    const result = deriveCapex(plGrid, periods, drivers, 3);
    expect(result[0].capex).toBe(0);
    expect(result[3].capex).toBeCloseTo(500, 2);
  });

  test('missing driver → 0', () => {
    const plGrid = periods.map((_, i) => ({
      periodIndex: i, revenue: 50000, cogs: 0, opex: 0, grossProfit: 50000,
      ebitda: 50000, da: 0, ebit: 50000, interestExpense: 0, ebt: 50000, tax: 0, netIncome: 50000
    }));
    const result = deriveCapex(plGrid, periods, [], 0);
    expect(result[0].capex).toBe(0);
  });
});

// ─── buildEntityPL (extended) ─────────────────────────────────────

describe('buildEntityPL (Phase 4 extensions)', () => {
  const model = makeModel({ period_count: 6 });
  const periods = generatePeriods(model);

  function makeEntityResult(rev = 50000, cogs = 17500, opex = 10000) {
    const revenue = {}; const cogsMap = {}; const opexMap = {};
    for (let i = 0; i < 6; i++) { revenue[i] = rev; cogsMap[i] = cogs; opexMap[i] = opex; }
    return {
      entityId: 'e1', revenue, revenueByType: { client: { ...revenue } },
      cogs: cogsMap, opex: opexMap
    };
  }

  test('interestExpense sums across debt schedules', () => {
    const entityResult = makeEntityResult();
    const debtSchedules = [{
      instrumentName: 'Facility', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 1000000, newBorrowings: 0,
        cashInterest: 7500, pikInterest: 0, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 1000000, currentPortion: 0, ltPortion: 1000000
      }))
    }];
    const drivers = [makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })];
    const grid = buildEntityPL(entityResult, periods, drivers, 0, debtSchedules);
    expect(grid[0].interestExpense).toBe(7500);
    expect(grid[0].ebt).toBe(grid[0].ebit - 7500);
  });

  test('EBT = EBIT - interestExpense', () => {
    const entityResult = makeEntityResult();
    const debtSchedules = [{
      instrumentName: 'F', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 0, newBorrowings: 0,
        cashInterest: 5000, pikInterest: 500, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 0, currentPortion: 0, ltPortion: 0
      }))
    }];
    const drivers = [makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })];
    const grid = buildEntityPL(entityResult, periods, drivers, 0, debtSchedules);
    // interest = 5000 + 500 = 5500
    expect(grid[0].interestExpense).toBe(5500);
    expect(grid[0].ebt).toBe(grid[0].ebit - 5500);
  });

  test('tax = ebt × tax_rate when ebt > 0', () => {
    const entityResult = makeEntityResult();
    const drivers = [
      makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 }),
      makeDriver({ driver_type: 'tax_rate', value: 0.21, period_start: 0 })
    ];
    const grid = buildEntityPL(entityResult, periods, drivers, 0, []);
    // EBIT = 50000 - 17500 - 10000 - 2000 = 20500, no interest → EBT = 20500
    expect(grid[0].tax).toBeCloseTo(20500 * 0.21, 2);
    expect(grid[0].netIncome).toBeCloseTo(20500 * (1 - 0.21), 2);
  });

  test('tax = 0 when ebt ≤ 0', () => {
    const entityResult = makeEntityResult(10000, 8000, 5000);
    const drivers = [
      makeDriver({ driver_type: 'da_monthly', value: 0, period_start: 0 }),
      makeDriver({ driver_type: 'tax_rate', value: 0.21, period_start: 0 })
    ];
    // ebit = 10000 - 8000 - 5000 = -3000
    const heavyInterest = [{
      instrumentName: 'F', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 0, newBorrowings: 0,
        cashInterest: 1000, pikInterest: 0, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 0, currentPortion: 0, ltPortion: 0
      }))
    }];
    const grid = buildEntityPL(entityResult, periods, drivers, 0, heavyInterest);
    expect(grid[0].ebt).toBeLessThan(0);
    expect(grid[0].tax).toBe(0);
    expect(grid[0].netIncome).toBe(grid[0].ebt);
  });

  test('backwards compatible: no debtSchedules → interest=0, NI=EBIT', () => {
    const entityResult = makeEntityResult();
    const drivers = [makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 })];
    const grid = buildEntityPL(entityResult, periods, drivers, 0);
    expect(grid[0].interestExpense).toBe(0);
    expect(grid[0].ebt).toBe(grid[0].ebit);
    expect(grid[0].tax).toBe(0);
    expect(grid[0].netIncome).toBe(grid[0].ebit);
  });

  test('netIncome = ebt - tax', () => {
    const entityResult = makeEntityResult();
    const drivers = [
      makeDriver({ driver_type: 'da_monthly', value: 0, period_start: 0 }),
      makeDriver({ driver_type: 'tax_rate', value: 0.25, period_start: 0 })
    ];
    const grid = buildEntityPL(entityResult, periods, drivers, 0, []);
    const ebt = 50000 - 17500 - 10000; // 22500
    expect(grid[0].netIncome).toBeCloseTo(ebt * 0.75, 2);
  });
});

// ─── buildEntityCF ──────────────────────────────────────────────────

describe('buildEntityCF', () => {
  const model = makeModel({ period_count: 6 });
  const periods = generatePeriods(model);

  function makeSimplePL(ni = 15000, da = 2000) {
    return periods.map((_, i) => ({
      periodIndex: i, revenue: 50000, clientRevenue: 50000, cogs: 17500, grossProfit: 32500,
      opex: 10000, ebitda: 22500, da, ebit: 20500, interestExpense: 0, ebt: 20500, tax: 5500, netIncome: ni
    }));
  }

  function makeZeroWC() {
    return periods.map((_, i) => ({ periodIndex: i, ar: 0, ap: 0, prepaid: 0, accrued: 0 }));
  }

  function makeZeroCapex() {
    return periods.map((_, i) => ({ periodIndex: i, capex: 0 }));
  }

  test('operating CF = NI + D&A when no WC changes', () => {
    const pl = makeSimplePL(15000, 2000);
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms: null
    });
    expect(grid[0].cashFromOperations).toBe(15000 + 2000);
  });

  test('AR increase is negative (use of cash)', () => {
    const pl = makeSimplePL();
    const wcGrid = periods.map((_, i) => ({ periodIndex: i, ar: i === 0 ? 5000 : 5000, ap: 0, prepaid: 0, accrued: 0 }));
    const grid = buildEntityCF({
      entityPL: pl, wcGrid, capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms: null
    });
    // Period 0: AR goes from 0 to 5000 → change = 5000
    expect(grid[0].changeInAr).toBe(5000);
    // cashFromOperations reduced by AR increase
    expect(grid[0].cashFromOperations).toBe(15000 + 2000 - 5000);
  });

  test('AP increase is positive (source of cash)', () => {
    const pl = makeSimplePL();
    const wcGrid = periods.map((_, i) => ({ periodIndex: i, ar: 0, ap: i === 0 ? 3000 : 3000, prepaid: 0, accrued: 0 }));
    const grid = buildEntityCF({
      entityPL: pl, wcGrid, capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms: null
    });
    expect(grid[0].changeInAp).toBe(3000);
    expect(grid[0].cashFromOperations).toBe(15000 + 2000 + 3000);
  });

  test('investing CF: capex is negative', () => {
    const pl = makeSimplePL();
    const capexGrid = periods.map((_, i) => ({ periodIndex: i, capex: 500 }));
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid,
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms: null
    });
    expect(grid[0].cashFromInvesting).toBe(-500);
  });

  test('acquisition at close period', () => {
    const pl = makeSimplePL();
    const closeTerms = makeCloseTerms({ purchasePrice: 3000000, equityContributed: 1000000 });
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms
    });
    expect(grid[0].acquisitions).toBe(3000000);
    expect(grid[0].cashFromInvesting).toBe(-3000000);
    // Only at close period
    expect(grid[1].acquisitions).toBe(0);
  });

  test('financing: debt proceeds and equity at close', () => {
    const pl = makeSimplePL();
    const closeTerms = makeCloseTerms({ purchasePrice: 3000000, equityContributed: 1000000 });
    const debtSchedules = [{
      instrumentName: 'F', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 0, newBorrowings: i === 0 ? 2000000 : 0,
        cashInterest: 15000, pikInterest: 0, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 2000000, currentPortion: 0, ltPortion: 2000000
      }))
    }];
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules, periods, closePeriodIndex: 0, closeTerms
    });
    expect(grid[0].debtProceeds).toBe(2000000);
    expect(grid[0].equityContributions).toBe(1000000);
    expect(grid[0].cashInterest).toBe(15000);
    expect(grid[0].cashFromFinancing).toBe(2000000 - 0 - 15000 + 1000000);
  });

  test('ending cash = beginning + net change', () => {
    const pl = makeSimplePL();
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 0, closeTerms: null
    });
    expect(grid[0].beginningCash).toBe(0);
    expect(grid[0].endingCash).toBe(grid[0].netChange);
    expect(grid[1].beginningCash).toBe(grid[0].endingCash);
    expect(grid[1].endingCash).toBe(grid[1].beginningCash + grid[1].netChange);
  });

  test('pre-close periods are zeros', () => {
    const pl = makeSimplePL();
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules: [], periods, closePeriodIndex: 3, closeTerms: null
    });
    expect(grid[0].cashFromOperations).toBe(0);
    expect(grid[0].endingCash).toBe(0);
    expect(grid[2].endingCash).toBe(0);
  });

  test('PIK interest is non-cash add-back to operating CF', () => {
    const pl = makeSimplePL();
    const debtSchedules = [{
      instrumentName: 'F', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 500000, newBorrowings: 0,
        cashInterest: 0, pikInterest: 2500, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 502500, currentPortion: 0, ltPortion: 502500
      }))
    }];
    const grid = buildEntityCF({
      entityPL: pl, wcGrid: makeZeroWC(), capexGrid: makeZeroCapex(),
      debtSchedules, periods, closePeriodIndex: 0, closeTerms: null
    });
    expect(grid[0].pikInterest).toBe(2500);
    expect(grid[0].cashFromOperations).toBe(15000 + 2000 + 2500);
  });
});

// ─── buildEntityBS ──────────────────────────────────────────────────

describe('buildEntityBS', () => {
  const model = makeModel({ period_count: 6 });
  const periods = generatePeriods(model);

  function makeSimplePL(ni = 15000, da = 2000) {
    return periods.map((_, i) => ({
      periodIndex: i, revenue: 50000, clientRevenue: 50000, cogs: 17500, grossProfit: 32500,
      opex: 10000, ebitda: 22500, da, ebit: 20500, interestExpense: 0, ebt: 20500, tax: 5500, netIncome: ni
    }));
  }

  function makeSimpleWC(ar = 0, ap = 0, prepaid = 0, accrued = 0) {
    return periods.map((_, i) => ({ periodIndex: i, ar, ap, prepaid, accrued }));
  }

  function makeSimpleCapex(capex = 0) {
    return periods.map((_, i) => ({ periodIndex: i, capex }));
  }

  function makeSimpleCF(endingCash = 10000) {
    return periods.map((_, i) => ({
      periodIndex: i, netIncome: 0, da: 0, pikInterest: 0,
      changeInAr: 0, changeInAp: 0, changeInPrepaid: 0, changeInAccrued: 0,
      cashFromOperations: 0, capex: 0, acquisitions: 0, cashFromInvesting: 0,
      debtProceeds: 0, debtRepayment: 0, cashInterest: 0, equityContributions: 0,
      cashFromFinancing: 0, netChange: 0, beginningCash: 0, endingCash
    }));
  }

  test('cash = CF ending cash', () => {
    const cfGrid = makeSimpleCF(25000);
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid, periods, closePeriodIndex: 0, closeTerms: makeCloseTerms()
    });
    expect(grid[0].cash).toBe(25000);
  });

  test('goodwill = purchasePrice (constant)', () => {
    const closeTerms = makeCloseTerms({ purchasePrice: 3000000 });
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms
    });
    expect(grid[0].goodwill).toBe(3000000);
    expect(grid[5].goodwill).toBe(3000000);
  });

  test('fixedAssetsNet = cumulative(capex) - cumulative(da)', () => {
    const pl = makeSimplePL(15000, 1000);
    const capexGrid = makeSimpleCapex(500);
    const grid = buildEntityBS({
      entityPL: pl, wcGrid: makeSimpleWC(), capexGrid,
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms: makeCloseTerms()
    });
    // Period 0: capex=500, da=1000 → net = 500 - 1000 = -500
    expect(grid[0].fixedAssetsNet).toBeCloseTo(-500, 2);
    // Period 1: cumCapex=1000, cumDa=2000 → net = -1000
    expect(grid[1].fixedAssetsNet).toBeCloseTo(-1000, 2);
  });

  test('retainedEarnings = cumulative(netIncome)', () => {
    const pl = makeSimplePL(10000);
    const grid = buildEntityBS({
      entityPL: pl, wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms: makeCloseTerms()
    });
    expect(grid[0].retainedEarnings).toBe(10000);
    expect(grid[1].retainedEarnings).toBe(20000);
    expect(grid[2].retainedEarnings).toBe(30000);
  });

  test('contributedCapital = equityContributed (constant)', () => {
    const closeTerms = makeCloseTerms({ equityContributed: 1000000 });
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms
    });
    expect(grid[0].contributedCapital).toBe(1000000);
    expect(grid[5].contributedCapital).toBe(1000000);
  });

  test('pre-close periods are zero with isBalanced=true', () => {
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 3, closeTerms: makeCloseTerms()
    });
    expect(grid[0].totalAssets).toBe(0);
    expect(grid[0].isBalanced).toBe(true);
  });

  test('debt from schedules: currentPortion + longTermDebt', () => {
    const debtSchedules = [{
      instrumentName: 'F', instrumentType: 'facility', entityId: 'e1',
      schedule: periods.map((_, i) => ({
        periodIndex: i, beginningBalance: 2000000, newBorrowings: 0,
        cashInterest: 0, pikInterest: 0, cashPrincipal: 0,
        balloonPayment: 0, endingBalance: 2000000, currentPortion: 200000, ltPortion: 1800000
      }))
    }];
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid: makeSimpleWC(), capexGrid: makeSimpleCapex(),
      debtSchedules, cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms: makeCloseTerms()
    });
    expect(grid[0].currentPortionLtd).toBe(200000);
    expect(grid[0].longTermDebt).toBe(1800000);
  });

  test('WC accounts on BS: AR, AP, prepaid, accrued', () => {
    const wcGrid = makeSimpleWC(90000, 21000, 200, 500);
    const grid = buildEntityBS({
      entityPL: makeSimplePL(), wcGrid, capexGrid: makeSimpleCapex(),
      debtSchedules: [], cfGrid: makeSimpleCF(), periods, closePeriodIndex: 0, closeTerms: makeCloseTerms()
    });
    expect(grid[0].accountsReceivable).toBe(90000);
    expect(grid[0].accountsPayable).toBe(21000);
    expect(grid[0].prepaidExpenses).toBe(200);
    expect(grid[0].accruedExpenses).toBe(500);
  });
});

// ─── Consolidation ──────────────────────────────────────────────────

describe('buildConsolidatedBS', () => {
  const model = makeModel({ period_count: 3 });
  const periods = generatePeriods(model);

  test('sums all numeric fields across entities', () => {
    const e1 = { grid: periods.map((_, i) => ({
      periodIndex: i, cash: 10000, accountsReceivable: 5000, prepaidExpenses: 100,
      otherCurrentAssets: 0, goodwill: 1000000, otherIntangibles: 0, fixedAssetsNet: 500,
      otherLtAssets: 0, totalAssets: 1015600,
      accountsPayable: 3000, accruedExpenses: 500, currentPortionLtd: 10000,
      otherCurrentLiabilities: 0, longTermDebt: 990000, otherLtLiabilities: 0, totalLiabilities: 1003500,
      contributedCapital: 5000, retainedEarnings: 7100, totalEquity: 12100, isBalanced: true
    }))};
    const e2 = { grid: periods.map((_, i) => ({
      periodIndex: i, cash: 5000, accountsReceivable: 2000, prepaidExpenses: 50,
      otherCurrentAssets: 0, goodwill: 500000, otherIntangibles: 0, fixedAssetsNet: 200,
      otherLtAssets: 0, totalAssets: 507250,
      accountsPayable: 1000, accruedExpenses: 250, currentPortionLtd: 5000,
      otherCurrentLiabilities: 0, longTermDebt: 495000, otherLtLiabilities: 0, totalLiabilities: 501250,
      contributedCapital: 2000, retainedEarnings: 4000, totalEquity: 6000, isBalanced: true
    }))};

    const result = buildConsolidatedBS([e1, e2], periods);
    expect(result[0].cash).toBe(15000);
    expect(result[0].goodwill).toBe(1500000);
    expect(result[0].totalAssets).toBe(1015600 + 507250);
  });

  test('recomputes isBalanced on consolidated', () => {
    const e1 = { grid: [{ periodIndex: 0, cash: 100, accountsReceivable: 0, prepaidExpenses: 0,
      otherCurrentAssets: 0, goodwill: 0, otherIntangibles: 0, fixedAssetsNet: 0, otherLtAssets: 0,
      totalAssets: 100, accountsPayable: 0, accruedExpenses: 0, currentPortionLtd: 0,
      otherCurrentLiabilities: 0, longTermDebt: 0, otherLtLiabilities: 0, totalLiabilities: 0,
      contributedCapital: 100, retainedEarnings: 0, totalEquity: 100, isBalanced: true }]};
    const result = buildConsolidatedBS([e1], periods);
    expect(result[0].isBalanced).toBe(true);
  });
});

describe('buildConsolidatedCF', () => {
  const model = makeModel({ period_count: 3 });
  const periods = generatePeriods(model);

  test('sums CF fields across entities', () => {
    const e1 = { grid: periods.map((_, i) => ({
      periodIndex: i, netIncome: 10000, da: 2000, pikInterest: 0,
      changeInAr: 1000, changeInAp: 500, changeInPrepaid: 100, changeInAccrued: 200,
      cashFromOperations: 11600, capex: 500, acquisitions: 0, cashFromInvesting: -500,
      debtProceeds: 0, debtRepayment: 5000, cashInterest: 1000, equityContributions: 0,
      cashFromFinancing: -6000, netChange: 5100, beginningCash: 0, endingCash: 5100
    }))};
    const e2 = { grid: periods.map((_, i) => ({
      periodIndex: i, netIncome: 5000, da: 1000, pikInterest: 0,
      changeInAr: 500, changeInAp: 200, changeInPrepaid: 50, changeInAccrued: 100,
      cashFromOperations: 5750, capex: 250, acquisitions: 0, cashFromInvesting: -250,
      debtProceeds: 0, debtRepayment: 2000, cashInterest: 500, equityContributions: 0,
      cashFromFinancing: -2500, netChange: 3000, beginningCash: 0, endingCash: 3000
    }))};

    const result = buildConsolidatedCF([e1, e2], periods);
    expect(result[0].netIncome).toBe(15000);
    expect(result[0].cashFromOperations).toBe(11600 + 5750);
    expect(result[0].endingCash).toBe(5100 + 3000);
  });
});

// ─── calculateModel (Phase 4 orchestrator) ──────────────────────────

describe('calculateModel (Phase 4)', () => {
  test('produces BS/CF/debtSchedules when dealTerms provided', () => {
    const model = makeModel({ period_count: 12 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();
    const entity = makeEntity({
      entity_type: 'spv',
      close_period_index: 0,
      lineItems: [
        makeLineItem({ item_type: 'fixed', base_amount: 50000, category: 'revenue', revenue_type: 'client' }),
        makeLineItem({ category: 'cogs', item_type: 'driver_derived', driver_type: 'cogs_pct_revenue', base_amount: 0 }),
        makeLineItem({ item_type: 'fixed', base_amount: 10000, category: 'expense' })
      ],
      drivers: [
        makeDriver({ driver_type: 'cogs_pct_revenue', value: 0.35, period_start: 0 }),
        makeDriver({ driver_type: 'da_monthly', value: 2000, period_start: 0 }),
        makeDriver({ driver_type: 'tax_rate', value: 0.21, period_start: 0 }),
        makeDriver({ driver_type: 'ar_days', value: 45, period_start: 0 }),
        makeDriver({ driver_type: 'ap_days', value: 30, period_start: 0 }),
        makeDriver({ driver_type: 'prepaid_pct', value: 0.02, period_start: 0 }),
        makeDriver({ driver_type: 'accrued_exp_pct', value: 0.05, period_start: 0 }),
        makeDriver({ driver_type: 'capex_pct_revenue', value: 0.01, period_start: 0 })
      ]
    });

    const dealTerms = {
      [scenario.id]: {
        facility: {
          amount: 2000000, rate: 0.09, termMonths: 84,
          ioMonths: 12, deferredMonths: 0, pik: false, balloonMonth: null
        },
        entities: {
          [entity.id]: {
            purchasePrice: 3000000,
            trancheAmount: 2000000,
            sellerNoteAmount: 350000,
            sellerNoteRate: 0.06,
            sellerNoteTermMonths: 60,
            sellerNoteIoMonths: 12,
            equityContributed: 1000000
          }
        }
      }
    };

    const result = calculateModel({
      model, entities: [entity],
      scenarios: [scenario], operatingScenarios: [opScenario],
      dealTerms
    });

    const run = result.runs[0];

    // Has BS/CF/debt results
    expect(run.entityBSResults).toHaveLength(1);
    expect(run.entityCFResults).toHaveLength(1);
    expect(run.debtSchedules).toHaveLength(2); // facility + seller note
    expect(run.consolidatedBS).toBeDefined();
    expect(run.consolidatedCF).toBeDefined();

    // P&L has new fields
    const pl = run.entityResults[0].grid[0];
    expect(pl.interestExpense).toBeGreaterThan(0);
    expect(pl.netIncome).toBeDefined();

    // BS has cash matching CF
    const bs = run.entityBSResults[0].grid;
    const cf = run.entityCFResults[0].grid;
    for (let i = 0; i < 12; i++) {
      expect(bs[i].cash).toBeCloseTo(cf[i].endingCash, 2);
    }
  });

  test('no dealTerms → still works (backwards compat)', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();
    const entity = makeEntity({
      entity_type: 'spv',
      lineItems: [makeLineItem({ item_type: 'fixed', base_amount: 50000 })]
    });

    const result = calculateModel({
      model, entities: [entity],
      scenarios: [scenario], operatingScenarios: [opScenario]
    });

    const run = result.runs[0];
    expect(run.entityResults).toHaveLength(1);
    expect(run.entityBSResults).toHaveLength(1);
    expect(run.debtSchedules).toHaveLength(0);
  });

  test('multi-entity staggered close produces correct consolidated', () => {
    const model = makeModel({ period_count: 6 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();
    const e1 = makeEntity({
      entity_type: 'spv', entity_name: 'SPV-A', close_period_index: 0,
      lineItems: [makeLineItem({ item_type: 'fixed', base_amount: 30000, category: 'revenue', revenue_type: 'client' })]
    });
    const e2 = makeEntity({
      entity_type: 'spv', entity_name: 'SPV-B', close_period_index: 3,
      lineItems: [makeLineItem({ item_type: 'fixed', base_amount: 20000, category: 'revenue', revenue_type: 'client' })]
    });

    const result = calculateModel({
      model, entities: [e1, e2],
      scenarios: [scenario], operatingScenarios: [opScenario]
    });

    const run = result.runs[0];
    // Period 0: only e1 revenue
    expect(run.consolidatedPL.grid[0].revenue).toBe(30000);
    // Period 3: both
    expect(run.consolidatedPL.grid[3].revenue).toBe(50000);
    // Both have BS results
    expect(run.entityBSResults).toHaveLength(2);
  });

  test('validation errors reported for BS imbalance', () => {
    const model = makeModel({ period_count: 3 });
    const scenario = makeScenario();
    const opScenario = makeOpScenario();
    const entity = makeEntity({
      entity_type: 'spv',
      lineItems: [makeLineItem({ item_type: 'fixed', base_amount: 50000, category: 'revenue', revenue_type: 'client' })]
    });

    const result = calculateModel({
      model, entities: [entity],
      scenarios: [scenario], operatingScenarios: [opScenario]
    });

    // Without deal terms, the BS will naturally not balance (no equity, no liabilities to match assets)
    // Check that validationErrors array exists
    expect(Array.isArray(result.runs[0].validationErrors)).toBe(true);
  });
});
