'use strict';

const { v4: uuidv4 } = require('uuid');

function makeModel(overrides = {}) {
  return {
    id: uuidv4(),
    start_date: '2025-01-01',
    period_count: 120,
    ...overrides
  };
}

function makeEntity(overrides = {}) {
  return {
    id: uuidv4(),
    entity_type: 'spv',
    entity_name: 'Test SPV',
    close_period_index: 0,
    lineItems: [],
    drivers: [],
    ...overrides
  };
}

function makeLineItem(overrides = {}) {
  return {
    id: uuidv4(),
    category: 'revenue',
    revenue_type: 'client',
    statement: 'pl',
    group_name: 'Revenue',
    item_name: 'Client Revenue',
    item_type: 'fixed',
    base_amount: 50000,
    growth_rate: null,
    segment_id: null,
    scenario_id: null,
    operating_scenario_id: null,
    ...overrides
  };
}

function makeDriver(overrides = {}) {
  return {
    id: uuidv4(),
    driver_type: 'cogs_pct_revenue',
    value: 0.35,
    period_start: 0,
    period_end: null,
    operating_scenario_id: null,
    ...overrides
  };
}

function makeScenario(overrides = {}) {
  return {
    id: uuidv4(),
    name: 'Base Case',
    is_base_case: true,
    ...overrides
  };
}

function makeOpScenario(overrides = {}) {
  return {
    id: uuidv4(),
    name: 'Base',
    case_type: 'base',
    is_default: true,
    ...overrides
  };
}

function makeInstrument(overrides = {}) {
  return {
    instrumentName: 'Senior Facility',
    instrumentType: 'facility',
    entityId: 'entity-1',
    startPeriodIndex: 0,
    initialBalance: 2000000,
    annualRate: 0.09,
    termMonths: 84,
    ioMonths: 12,
    deferredMonths: 0,
    pik: false,
    balloonMonth: null,
    ...overrides
  };
}

function makeCloseTerms(overrides = {}) {
  return {
    purchasePrice: 3000000,
    equityContributed: 1000000,
    ...overrides
  };
}

function makeEquityEntry(overrides = {}) {
  return {
    party_name: 'Sponsor',
    party_type: 'sponsor',
    base_equity_pct: 0.60,
    carry_pct: 0.20,
    hurdle_rate_annual: 0.08,
    contributed_capital: 600000,
    contribution_period_index: 0,
    ...overrides
  };
}

function makeExitEvent(overrides = {}) {
  return {
    id: uuidv4(),
    exit_type: 'full_exit',
    event_name: 'Month 36 Full Exit',
    event_period_index: 35,
    profit_metric: 'ebitda',
    trailing_periods: 12,
    exit_multiple_low: 5.0,
    exit_multiple_base: 6.0,
    exit_multiple_high: 7.0,
    exit_transaction_costs_pct: 0.04,
    ebitda_allocation_method: 'ebitda_contribution',
    recap_leverage_multiple: null,
    recap_refi_costs_pct: null,
    recap_new_facility_term_months: null,
    ...overrides
  };
}

function makeSnapshot(overrides = {}) {
  return {
    periodIndex: 11,
    trailingPeriods: 12,
    entityPLRows: [],
    debtScheduleRows: [],
    ...overrides
  };
}

function makePublishRun(overrides = {}) {
  return {
    scenarioId: uuidv4(),
    operatingScenarioId: uuidv4(),
    entityResults: [{
      entityId: uuidv4(),
      entityName: 'Test SPV',
      entityType: 'spv',
      grid: Array.from({ length: 12 }, (_, i) => ({
        periodIndex: i,
        revenue: 100000,
        cogs: 35000,
        opex: 25000,
        grossProfit: 65000,
        ebitda: 40000
      })),
      lineItemValues: {}
    }],
    entityBSResults: [{
      entityId: uuidv4(),
      grid: [{
        periodIndex: 0,
        totalAssets: 5000000,
        totalLiabilities: 3000000,
        totalEquity: 2000000
      }]
    }],
    debtSchedules: [{
      entityId: uuidv4(),
      instrumentName: 'Senior Facility',
      instrumentType: 'facility',
      schedule: Array.from({ length: 12 }, (_, i) => ({
        periodIndex: i,
        beginningBalance: 2000000 - i * 20000,
        newBorrowings: i === 0 ? 2000000 : 0,
        cashInterest: 15000,
        pikInterest: 0,
        cashPrincipal: 20000,
        balloonPayment: 0,
        endingBalance: 2000000 - (i + 1) * 20000,
        currentPortion: 240000,
        ltPortion: 2000000 - (i + 1) * 20000 - 240000
      }))
    }],
    warnings: [],
    validationErrors: [],
    ...overrides
  };
}

function makeWaterfallResult(overrides = {}) {
  return {
    exitType: 'full_exit',
    eventName: 'Month 36 Exit',
    eventPeriodIndex: 35,
    platformEBITDA: 480000,
    totalRemainingDebt: 1300000,
    cases: {
      base: {
        grossEV: 2880000,
        netProceeds: 2764800,
        totalDebtRepaid: 1300000,
        netEquityPool: 1464800,
        partyResults: [
          { partyName: 'Sponsor', partyType: 'sponsor', totalContributed: 600000, totalProceeds: 1000000, moic: 1.67, irr: 0.18 },
          { partyName: 'Co-Investor', partyType: 'lp', totalContributed: 400000, totalProceeds: 464800, moic: 1.16, irr: 0.05 }
        ],
        ...overrides.base
      },
      ...overrides.cases
    },
    ...overrides
  };
}

module.exports = {
  makeModel,
  makeEntity,
  makeLineItem,
  makeDriver,
  makeScenario,
  makeOpScenario,
  makeInstrument,
  makeCloseTerms,
  makeEquityEntry,
  makeExitEvent,
  makeSnapshot,
  makePublishRun,
  makeWaterfallResult
};
