'use strict';

// ─── 1. generatePeriods ─────────────────────────────────────────────
function generatePeriods(model) {
  const { start_date, period_count } = model;
  const start = new Date(start_date + 'T00:00:00Z');
  const periods = [];

  for (let i = 0; i < period_count; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const endDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    periods.push({
      index: i,
      label,
      startDate: d.toISOString().slice(0, 10),
      endDate: endDay.toISOString().slice(0, 10)
    });
  }
  return periods;
}

// ─── 2. resolveDriver ───────────────────────────────────────────────
function resolveDriver(drivers, periodIndex, driverType, closePeriodIndex) {
  const relativePeriod = periodIndex - closePeriodIndex;
  const matches = drivers.filter(d =>
    d.driver_type === driverType &&
    d.period_start <= relativePeriod &&
    (d.period_end == null || d.period_end >= relativePeriod)
  );
  if (matches.length === 0) return null;
  // Most specific = highest period_start
  matches.sort((a, b) => b.period_start - a.period_start);
  return matches[0].value;
}

// ─── 3. projectLineItem ────────────────────────────────────────────
function projectLineItem(lineItem, periods, drivers, closePeriodIndex, revenueByPeriod) {
  const results = [];

  for (const period of periods) {
    const pi = period.index;

    // Pre-close periods → 0
    if (pi < closePeriodIndex) {
      results.push({ periodIndex: pi, amount: 0 });
      continue;
    }

    let amount = 0;

    switch (lineItem.item_type) {
      case 'fixed':
        amount = Number(lineItem.base_amount) || 0;
        break;

      case 'growth_rate': {
        const base = Number(lineItem.base_amount) || 0;
        const driverRate = resolveDriver(drivers, pi, 'organic_growth_rate', closePeriodIndex);
        const rate = driverRate != null ? driverRate : (Number(lineItem.growth_rate) || 0);
        const periodsElapsed = pi - closePeriodIndex;
        amount = base * Math.pow(1 + rate, periodsElapsed);
        break;
      }

      case 'driver_derived': {
        const rev = (revenueByPeriod && revenueByPeriod[pi]) || 0;
        const driverVal = resolveDriver(drivers, pi, lineItem.driver_type || 'cogs_pct_revenue', closePeriodIndex);
        amount = rev * (driverVal != null ? driverVal : 0);
        break;
      }

      case 'manual':
        amount = Number(lineItem.base_amount) || 0;
        break;

      default:
        amount = 0;
    }

    results.push({ periodIndex: pi, amount });
  }

  return results;
}

// ─── 4. projectEntity ──────────────────────────────────────────────
function projectEntity(entity, periods, drivers) {
  const closePeriodIndex = entity.close_period_index || 0;
  const lineItems = entity.lineItems || [];
  const lineItemValues = {};

  // 4a. Project revenue line items first
  const revenueItems = lineItems.filter(li => li.category === 'revenue');
  const revenueByPeriod = {};
  const revenueBySegment = {};
  const revenueByType = { client: {}, referral: {}, management: {} };

  for (const li of revenueItems) {
    const values = projectLineItem(li, periods, drivers, closePeriodIndex, null);
    lineItemValues[li.id] = values;

    for (const v of values) {
      revenueByPeriod[v.periodIndex] = (revenueByPeriod[v.periodIndex] || 0) + v.amount;

      // By segment
      const segKey = li.segment_id || '__unsegmented__';
      if (!revenueBySegment[segKey]) revenueBySegment[segKey] = {};
      revenueBySegment[segKey][v.periodIndex] = (revenueBySegment[segKey][v.periodIndex] || 0) + v.amount;

      // By type
      const revType = li.revenue_type || 'client';
      if (!revenueByType[revType]) revenueByType[revType] = {};
      revenueByType[revType][v.periodIndex] = (revenueByType[revType][v.periodIndex] || 0) + v.amount;
    }
  }

  // 4b. Project COGS line items (use segment revenue if segment-scoped, otherwise total)
  const cogsItems = lineItems.filter(li => li.category === 'cogs');
  const cogsByPeriod = {};

  for (const li of cogsItems) {
    const segRevenue = li.segment_id && revenueBySegment[li.segment_id]
      ? revenueBySegment[li.segment_id]
      : revenueByPeriod;
    const values = projectLineItem(li, periods, drivers, closePeriodIndex, segRevenue);
    lineItemValues[li.id] = values;

    for (const v of values) {
      cogsByPeriod[v.periodIndex] = (cogsByPeriod[v.periodIndex] || 0) + v.amount;
    }
  }

  // 4c. Project expense line items
  const expenseItems = lineItems.filter(li => li.category === 'expense');
  const opexByPeriod = {};

  for (const li of expenseItems) {
    const values = projectLineItem(li, periods, drivers, closePeriodIndex, revenueByPeriod);
    lineItemValues[li.id] = values;

    for (const v of values) {
      opexByPeriod[v.periodIndex] = (opexByPeriod[v.periodIndex] || 0) + v.amount;
    }
  }

  return {
    entityId: entity.id,
    lineItemValues,
    revenue: revenueByPeriod,
    revenueBySegment,
    revenueByType,
    cogs: cogsByPeriod,
    opex: opexByPeriod
  };
}

// ─── 5. buildDebtSchedule ─────────────────────────────────────────
function buildDebtSchedule(instruments, periods) {
  const results = [];

  for (const inst of instruments) {
    const {
      instrumentName, instrumentType, entityId,
      startPeriodIndex, initialBalance, annualRate,
      termMonths, ioMonths, deferredMonths, pik, balloonMonth
    } = inst;

    const monthlyRate = annualRate / 12;
    const schedule = [];

    // Pass 1: build balances and payments
    let balance = 0;
    for (const period of periods) {
      const pi = period.index;
      const row = {
        periodIndex: pi,
        beginningBalance: 0,
        newBorrowings: 0,
        cashInterest: 0,
        pikInterest: 0,
        cashPrincipal: 0,
        balloonPayment: 0,
        endingBalance: 0,
        currentPortion: 0,
        ltPortion: 0
      };

      if (pi < startPeriodIndex) {
        schedule.push(row);
        continue;
      }

      row.beginningBalance = balance;

      if (pi === startPeriodIndex) {
        row.newBorrowings = initialBalance;
      }

      const workingBalance = row.beginningBalance + row.newBorrowings;
      const monthsActive = pi - startPeriodIndex;

      // Balloon check
      if (balloonMonth != null && monthsActive === balloonMonth) {
        if (pik) {
          row.pikInterest = workingBalance * monthlyRate;
        } else {
          row.cashInterest = workingBalance * monthlyRate;
        }
        row.balloonPayment = workingBalance + (pik ? row.pikInterest : 0);
        row.endingBalance = 0;
        balance = 0;
        schedule.push(row);
        continue;
      }

      // Post-balloon or post-term: zeros
      if (balloonMonth != null && monthsActive > balloonMonth) {
        schedule.push(row);
        continue;
      }

      if (monthsActive < deferredMonths) {
        // Deferred phase: no cash payments
        if (pik) {
          row.pikInterest = workingBalance * monthlyRate;
        }
        // No cash interest or principal during deferral
        row.endingBalance = workingBalance + row.pikInterest;
      } else if (monthsActive < deferredMonths + ioMonths) {
        // IO phase: interest only
        if (pik) {
          row.pikInterest = workingBalance * monthlyRate;
          row.endingBalance = workingBalance + row.pikInterest;
        } else {
          row.cashInterest = workingBalance * monthlyRate;
          row.endingBalance = workingBalance;
        }
      } else {
        // Amort phase: straight-line principal
        const amortMonthsTotal = termMonths - deferredMonths - ioMonths;
        const amortMonthsElapsed = monthsActive - deferredMonths - ioMonths;
        const remainingAmortMonths = amortMonthsTotal - amortMonthsElapsed;

        if (pik) {
          row.pikInterest = workingBalance * monthlyRate;
        } else {
          row.cashInterest = workingBalance * monthlyRate;
        }

        if (remainingAmortMonths > 0) {
          row.cashPrincipal = workingBalance / remainingAmortMonths;
        }

        row.endingBalance = workingBalance + row.pikInterest - row.cashPrincipal;
      }

      // Clamp
      if (row.endingBalance < 0) row.endingBalance = 0;
      balance = row.endingBalance;
      schedule.push(row);
    }

    // Pass 2: compute currentPortion (sum of next 12 months principal+balloon)
    for (let i = 0; i < schedule.length; i++) {
      let currentSum = 0;
      for (let j = i + 1; j <= i + 12 && j < schedule.length; j++) {
        currentSum += schedule[j].cashPrincipal + schedule[j].balloonPayment;
      }
      schedule[i].currentPortion = currentSum;
      schedule[i].ltPortion = schedule[i].endingBalance - currentSum;
      if (schedule[i].ltPortion < 0) schedule[i].ltPortion = 0;
    }

    results.push({
      instrumentName,
      instrumentType,
      entityId,
      schedule
    });
  }

  return results;
}

// ─── 6. deriveWorkingCapital ──────────────────────────────────────
function deriveWorkingCapital(entityPLGrid, periods, drivers, closePeriodIndex) {
  const result = [];
  for (const period of periods) {
    const pi = period.index;
    if (pi < closePeriodIndex) {
      result.push({ periodIndex: pi, ar: 0, ap: 0, prepaid: 0, accrued: 0 });
      continue;
    }
    const plRow = entityPLGrid.find(r => r.periodIndex === pi);
    const revenue = plRow ? plRow.revenue : 0;
    const cogs = plRow ? plRow.cogs : 0;
    const opex = plRow ? plRow.opex : 0;

    const arDays = resolveDriver(drivers, pi, 'ar_days', closePeriodIndex) || 0;
    const apDays = resolveDriver(drivers, pi, 'ap_days', closePeriodIndex) || 0;
    const prepaidPct = resolveDriver(drivers, pi, 'prepaid_pct', closePeriodIndex) || 0;
    const accruedPct = resolveDriver(drivers, pi, 'accrued_exp_pct', closePeriodIndex) || 0;

    result.push({
      periodIndex: pi,
      ar: (revenue / 30) * arDays,
      ap: (cogs / 30) * apDays,
      prepaid: opex * prepaidPct,
      accrued: opex * accruedPct
    });
  }
  return result;
}

// ─── 7. deriveCapex ───────────────────────────────────────────────
function deriveCapex(entityPLGrid, periods, drivers, closePeriodIndex) {
  const result = [];
  for (const period of periods) {
    const pi = period.index;
    if (pi < closePeriodIndex) {
      result.push({ periodIndex: pi, capex: 0 });
      continue;
    }
    const plRow = entityPLGrid.find(r => r.periodIndex === pi);
    const revenue = plRow ? plRow.revenue : 0;
    const capexPct = resolveDriver(drivers, pi, 'capex_pct_revenue', closePeriodIndex) || 0;
    result.push({ periodIndex: pi, capex: revenue * capexPct });
  }
  return result;
}

// ─── 8. buildEntityPL ──────────────────────────────────────────────
function buildEntityPL(entityResult, periods, drivers, closePeriodIndex, debtSchedules) {
  const grid = [];
  const schedules = debtSchedules || [];

  for (const period of periods) {
    const pi = period.index;
    const revenue = entityResult.revenue[pi] || 0;
    const clientRevenue = (entityResult.revenueByType.client && entityResult.revenueByType.client[pi]) || 0;
    const cogs = entityResult.cogs[pi] || 0;
    const grossProfit = revenue - cogs;
    const opex = entityResult.opex[pi] || 0;
    const ebitda = grossProfit - opex;
    const da = resolveDriver(drivers, pi, 'da_monthly', closePeriodIndex) || 0;
    const ebit = ebitda - da;

    // Interest from debt schedules
    let interestExpense = 0;
    for (const ds of schedules) {
      const row = ds.schedule.find(r => r.periodIndex === pi);
      if (row) {
        interestExpense += row.cashInterest + row.pikInterest;
      }
    }

    const ebt = ebit - interestExpense;
    const taxRate = resolveDriver(drivers, pi, 'tax_rate', closePeriodIndex) || 0;
    const tax = ebt > 0 ? ebt * taxRate : 0;
    const netIncome = ebt - tax;

    grid.push({
      periodIndex: pi,
      revenue,
      clientRevenue,
      cogs,
      grossProfit,
      opex,
      ebitda,
      da,
      ebit,
      interestExpense,
      ebt,
      tax,
      netIncome
    });
  }

  return grid;
}

// ─── 9. buildEntityCF ─────────────────────────────────────────────
function buildEntityCF(params) {
  const { entityPL, wcGrid, capexGrid, debtSchedules, periods, closePeriodIndex, closeTerms } = params;
  const schedules = debtSchedules || [];
  const grid = [];
  let prevCash = 0;

  for (const period of periods) {
    const pi = period.index;
    const plRow = entityPL.find(r => r.periodIndex === pi);
    const wcRow = wcGrid.find(r => r.periodIndex === pi);
    const capexRow = capexGrid.find(r => r.periodIndex === pi);

    if (pi < closePeriodIndex) {
      grid.push({
        periodIndex: pi,
        netIncome: 0, da: 0, pikInterest: 0,
        changeInAr: 0, changeInAp: 0, changeInPrepaid: 0, changeInAccrued: 0,
        cashFromOperations: 0,
        capex: 0, acquisitions: 0, cashFromInvesting: 0,
        debtProceeds: 0, debtRepayment: 0, cashInterest: 0, equityContributions: 0,
        cashFromFinancing: 0,
        netChange: 0, beginningCash: 0, endingCash: 0
      });
      continue;
    }

    const netIncome = plRow ? plRow.netIncome : 0;
    const da = plRow ? plRow.da : 0;

    // PIK interest is a non-cash add-back
    let pikInterest = 0;
    let debtProceeds = 0;
    let debtRepayment = 0;
    let cashInterestTotal = 0;
    for (const ds of schedules) {
      const row = ds.schedule.find(r => r.periodIndex === pi);
      if (row) {
        pikInterest += row.pikInterest;
        debtProceeds += row.newBorrowings;
        debtRepayment += row.cashPrincipal + row.balloonPayment;
        cashInterestTotal += row.cashInterest;
      }
    }

    // WC changes (compare to prior period)
    const prevWc = wcGrid.find(r => r.periodIndex === pi - 1);
    const changeInAr = wcRow ? wcRow.ar - (prevWc ? prevWc.ar : 0) : 0;
    const changeInAp = wcRow ? wcRow.ap - (prevWc ? prevWc.ap : 0) : 0;
    const changeInPrepaid = wcRow ? wcRow.prepaid - (prevWc ? prevWc.prepaid : 0) : 0;
    const changeInAccrued = wcRow ? wcRow.accrued - (prevWc ? prevWc.accrued : 0) : 0;

    // Operating CF
    const cashFromOperations = netIncome + da + pikInterest
      - changeInAr + changeInAp - changeInPrepaid + changeInAccrued;

    // Investing CF
    const capex = capexRow ? capexRow.capex : 0;
    const acquisitions = (closeTerms && pi === closePeriodIndex)
      ? closeTerms.purchasePrice + (closeTerms.transactionCosts || 0)
      : 0;
    const cashFromInvesting = -capex - acquisitions;

    // Financing CF
    const equityContributions = (closeTerms && pi === closePeriodIndex) ? closeTerms.equityContributed : 0;
    const cashFromFinancing = debtProceeds - debtRepayment - cashInterestTotal + equityContributions;

    const netChange = cashFromOperations + cashFromInvesting + cashFromFinancing;
    // Working capital reserve is Day 1 cash set aside at close
    const wcReserve = (closeTerms && pi === closePeriodIndex) ? (closeTerms.workingCapitalReserve || 0) : 0;
    const beginningCash = pi === closePeriodIndex ? wcReserve : prevCash;
    const endingCash = beginningCash + netChange;

    grid.push({
      periodIndex: pi,
      netIncome, da, pikInterest,
      changeInAr, changeInAp, changeInPrepaid, changeInAccrued,
      cashFromOperations,
      capex, acquisitions, cashFromInvesting,
      debtProceeds, debtRepayment, cashInterest: cashInterestTotal, equityContributions,
      cashFromFinancing,
      netChange, beginningCash, endingCash
    });

    prevCash = endingCash;
  }

  return grid;
}

// ─── 10. buildEntityBS ────────────────────────────────────────────
function buildEntityBS(params) {
  const { entityPL, wcGrid, capexGrid, debtSchedules, cfGrid, periods, closePeriodIndex, closeTerms } = params;
  const schedules = debtSchedules || [];
  const grid = [];
  let cumulativeCapex = 0;
  let cumulativeDa = 0;
  let cumulativeNetIncome = 0;

  for (const period of periods) {
    const pi = period.index;
    const plRow = entityPL.find(r => r.periodIndex === pi);
    const wcRow = wcGrid.find(r => r.periodIndex === pi);
    const capexRow = capexGrid.find(r => r.periodIndex === pi);
    const cfRow = cfGrid.find(r => r.periodIndex === pi);

    if (pi < closePeriodIndex) {
      grid.push({
        periodIndex: pi,
        cash: 0, accountsReceivable: 0, prepaidExpenses: 0, otherCurrentAssets: 0,
        goodwill: 0, otherIntangibles: 0, fixedAssetsNet: 0, otherLtAssets: 0, totalAssets: 0,
        accountsPayable: 0, accruedExpenses: 0, currentPortionLtd: 0, otherCurrentLiabilities: 0,
        longTermDebt: 0, otherLtLiabilities: 0, totalLiabilities: 0,
        contributedCapital: 0, retainedEarnings: 0, totalEquity: 0,
        isBalanced: true
      });
      continue;
    }

    cumulativeCapex += capexRow ? capexRow.capex : 0;
    cumulativeDa += plRow ? plRow.da : 0;
    cumulativeNetIncome += plRow ? plRow.netIncome : 0;

    const cash = cfRow ? cfRow.endingCash : 0;
    const accountsReceivable = wcRow ? wcRow.ar : 0;
    const prepaidExpenses = wcRow ? wcRow.prepaid : 0;
    const goodwill = closeTerms ? closeTerms.purchasePrice : 0;
    const fixedAssetsNet = cumulativeCapex - cumulativeDa;

    // Debt from schedules
    let currentPortionLtd = 0;
    let longTermDebt = 0;
    for (const ds of schedules) {
      const row = ds.schedule.find(r => r.periodIndex === pi);
      if (row) {
        currentPortionLtd += row.currentPortion;
        longTermDebt += row.ltPortion;
      }
    }

    const accountsPayable = wcRow ? wcRow.ap : 0;
    const accruedExpenses = wcRow ? wcRow.accrued : 0;

    const contributedCapital = closeTerms ? closeTerms.equityContributed : 0;
    const retainedEarnings = cumulativeNetIncome;

    const totalAssets = cash + accountsReceivable + prepaidExpenses + goodwill + fixedAssetsNet;
    const totalLiabilities = accountsPayable + accruedExpenses + currentPortionLtd + longTermDebt;
    const totalEquity = contributedCapital + retainedEarnings;
    const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

    grid.push({
      periodIndex: pi,
      cash, accountsReceivable, prepaidExpenses, otherCurrentAssets: 0,
      goodwill, otherIntangibles: 0, fixedAssetsNet, otherLtAssets: 0, totalAssets,
      accountsPayable, accruedExpenses, currentPortionLtd, otherCurrentLiabilities: 0,
      longTermDebt, otherLtLiabilities: 0, totalLiabilities,
      contributedCapital, retainedEarnings, totalEquity,
      isBalanced
    });
  }

  return grid;
}

// ─── 11. buildConsolidatedBS ──────────────────────────────────────
function buildConsolidatedBS(entityBSResults, periods) {
  const numericFields = [
    'cash', 'accountsReceivable', 'prepaidExpenses', 'otherCurrentAssets',
    'goodwill', 'otherIntangibles', 'fixedAssetsNet', 'otherLtAssets', 'totalAssets',
    'accountsPayable', 'accruedExpenses', 'currentPortionLtd', 'otherCurrentLiabilities',
    'longTermDebt', 'otherLtLiabilities', 'totalLiabilities',
    'contributedCapital', 'retainedEarnings', 'totalEquity'
  ];

  const grid = [];
  for (const period of periods) {
    const pi = period.index;
    const row = { periodIndex: pi };
    for (const f of numericFields) row[f] = 0;

    for (const ebs of entityBSResults) {
      const bsRow = ebs.grid.find(r => r.periodIndex === pi);
      if (!bsRow) continue;
      for (const f of numericFields) row[f] += bsRow[f];
    }

    row.isBalanced = Math.abs(row.totalAssets - (row.totalLiabilities + row.totalEquity)) < 0.01;
    grid.push(row);
  }
  return grid;
}

// ─── 12. buildConsolidatedCF ──────────────────────────────────────
function buildConsolidatedCF(entityCFResults, periods) {
  const numericFields = [
    'netIncome', 'da', 'pikInterest',
    'changeInAr', 'changeInAp', 'changeInPrepaid', 'changeInAccrued',
    'cashFromOperations',
    'capex', 'acquisitions', 'cashFromInvesting',
    'debtProceeds', 'debtRepayment', 'cashInterest', 'equityContributions',
    'cashFromFinancing',
    'netChange', 'beginningCash', 'endingCash'
  ];

  const grid = [];
  for (const period of periods) {
    const pi = period.index;
    const row = { periodIndex: pi };
    for (const f of numericFields) row[f] = 0;

    for (const ecf of entityCFResults) {
      const cfRow = ecf.grid.find(r => r.periodIndex === pi);
      if (!cfRow) continue;
      for (const f of numericFields) row[f] += cfRow[f];
    }

    grid.push(row);
  }
  return grid;
}

// ─── 13. buildConsolidatedPL ────────────────────────────────────────
function buildConsolidatedPL(entityPLResults, periods) {
  const grid = [];

  // ── Line-item-level consolidation using canonical_key ──
  // Build a map: canonical_key → { metadata, periodAmounts: { [pi]: amount } }
  const lineItemMap = {};
  const lineItemOrder = []; // preserve insertion order for sort

  for (const epl of entityPLResults) {
    const lineItems = epl.lineItems || [];
    const lineItemValues = epl.lineItemValues || {};

    for (const li of lineItems) {
      const key = li.canonical_key || `${li.statement}.${li.category}.${li.group_name}.${li.item_name}`
        .toLowerCase().replace(/ /g, '_').replace(/&/g, 'and').replace(/\//g, '_').replace(/-/g, '_').replace(/__+/g, '_');

      if (!lineItemMap[key]) {
        lineItemMap[key] = {
          canonicalKey: key,
          itemName: li.item_name,
          category: li.category,
          groupName: li.group_name,
          statement: li.statement,
          sortOrder: li.sort_order || 0,
          amounts: {}
        };
        lineItemOrder.push(key);
      }

      // Sum this entity's values into the consolidated line item
      const values = lineItemValues[li.id] || [];
      for (const v of values) {
        lineItemMap[key].amounts[v.periodIndex] = (lineItemMap[key].amounts[v.periodIndex] || 0) + v.amount;
      }
    }
  }

  // Sort by category order (revenue → cogs → expense) then sort_order
  const categoryOrder = { revenue: 0, cogs: 1, expense: 2 };
  const lineItemDetail = lineItemOrder
    .map(key => lineItemMap[key])
    .sort((a, b) => {
      const catDiff = (categoryOrder[a.category] || 9) - (categoryOrder[b.category] || 9);
      if (catDiff !== 0) return catDiff;
      return a.sortOrder - b.sortOrder;
    });

  // ── Aggregate grid (unchanged behavior) ──
  for (const period of periods) {
    const pi = period.index;
    let revenue = 0;
    let clientRevenue = 0;
    let cogs = 0;
    let opex = 0;
    let ebitda = 0;
    let da = 0;
    let ebit = 0;
    let interestExpense = 0;
    let ebt = 0;
    let tax = 0;
    let netIncome = 0;

    for (const epl of entityPLResults) {
      const row = epl.grid.find(r => r.periodIndex === pi);
      if (!row) continue;
      revenue += row.revenue;
      clientRevenue += row.clientRevenue;
      cogs += row.cogs;
      opex += row.opex;
      ebitda += row.ebitda;
      da += row.da;
      ebit += row.ebit;
      interestExpense += row.interestExpense || 0;
      ebt += row.ebt != null ? row.ebt : row.ebit;
      tax += row.tax || 0;
      netIncome += row.netIncome != null ? row.netIncome : row.ebit;
    }

    grid.push({
      periodIndex: pi,
      revenue: clientRevenue,
      clientRevenue,
      cogs,
      grossProfit: clientRevenue - cogs,
      opex,
      ebitda,
      da,
      ebit,
      interestExpense,
      ebt,
      tax,
      netIncome
    });
  }

  return { grid, lineItemDetail };
}

// ─── 14. calculateModel (top-level orchestrator) ────────────────────
const PROJECTABLE_TYPES = new Set(['spv', 'target', 'mid_holdco', 'intermediate_holdco']);

function calculateModel(input) {
  const { model, entities, scenarios, operatingScenarios, dealTerms } = input;
  const periods = generatePeriods(model);
  const runs = [];

  for (const scenario of scenarios) {
    for (const opScenario of operatingScenarios) {
      const warnings = [];
      const validationErrors = [];

      // Filter and sort entities
      const projectableEntities = entities
        .filter(e => {
          if (!PROJECTABLE_TYPES.has(e.entity_type)) return false;
          if (['mid_holdco', 'intermediate_holdco'].includes(e.entity_type)) {
            return e.lineItems && e.lineItems.length > 0;
          }
          return true;
        })
        .sort((a, b) => (a.close_period_index || 0) - (b.close_period_index || 0));

      // Get deal terms for this scenario
      const scenarioDealTerms = dealTerms && dealTerms[scenario.id] ? dealTerms[scenario.id] : null;

      // Build facility instrument from scenario-level terms
      const facilityInstruments = [];
      if (scenarioDealTerms && scenarioDealTerms.facility) {
        const f = scenarioDealTerms.facility;
        facilityInstruments.push({
          instrumentName: 'Senior Facility',
          instrumentType: 'facility',
          entityId: null, // assigned per entity
          startPeriodIndex: 0,
          initialBalance: f.amount || 0,
          annualRate: f.rate || 0,
          termMonths: f.termMonths || 84,
          ioMonths: f.ioMonths || 0,
          deferredMonths: f.deferredMonths || 0,
          pik: f.pik || false,
          balloonMonth: f.balloonMonth || null
        });
      }

      const entityPLResults = [];
      const entityBSResults = [];
      const entityCFResults = [];
      const allDebtSchedules = [];

      for (const entity of projectableEntities) {
        const filteredLineItems = (entity.lineItems || []).filter(li => {
          const scenarioMatch = li.scenario_id == null || li.scenario_id === scenario.id;
          const opMatch = li.operating_scenario_id == null || li.operating_scenario_id === opScenario.id;
          return scenarioMatch && opMatch;
        });

        const filteredDrivers = (entity.drivers || []).filter(d =>
          d.operating_scenario_id == null || d.operating_scenario_id === opScenario.id
        );

        const entityWithFiltered = { ...entity, lineItems: filteredLineItems };
        const closePeriodIndex = entity.close_period_index || 0;

        // Build instruments for this entity
        const instruments = [];

        // Facility — first entity gets the draw
        if (facilityInstruments.length > 0 && scenarioDealTerms && scenarioDealTerms.entities) {
          const entityTerms = scenarioDealTerms.entities[entity.id];
          if (entityTerms && entityTerms.trancheAmount) {
            instruments.push({
              ...facilityInstruments[0],
              entityId: entity.id,
              startPeriodIndex: closePeriodIndex,
              initialBalance: entityTerms.trancheAmount
            });
          }
        }

        // Seller note from entity deal terms
        if (scenarioDealTerms && scenarioDealTerms.entities) {
          const entityTerms = scenarioDealTerms.entities[entity.id];
          if (entityTerms && entityTerms.sellerNoteAmount) {
            instruments.push({
              instrumentName: 'Seller Note',
              instrumentType: 'seller_note',
              entityId: entity.id,
              startPeriodIndex: closePeriodIndex,
              initialBalance: entityTerms.sellerNoteAmount,
              annualRate: entityTerms.sellerNoteRate || 0.06,
              termMonths: entityTerms.sellerNoteTermMonths || 60,
              ioMonths: entityTerms.sellerNoteIoMonths || 0,
              deferredMonths: entityTerms.sellerNoteDeferredMonths || 0,
              pik: entityTerms.sellerNotePik || false,
              balloonMonth: null
            });
          }
        }

        // Build debt schedule
        const entityDebtSchedules = buildDebtSchedule(instruments, periods);
        allDebtSchedules.push(...entityDebtSchedules);

        // Project entity (revenue/cogs/opex)
        const entityResult = projectEntity(entityWithFiltered, periods, filteredDrivers);

        // Build P&L (extended with interest/tax/NI)
        const plGrid = buildEntityPL(entityResult, periods, filteredDrivers, closePeriodIndex, entityDebtSchedules);

        // Working capital + CapEx
        const wcGrid = deriveWorkingCapital(plGrid, periods, filteredDrivers, closePeriodIndex);
        const capexGrid = deriveCapex(plGrid, periods, filteredDrivers, closePeriodIndex);

        // Close terms for this entity
        let closeTerms = null;
        if (scenarioDealTerms && scenarioDealTerms.entities && scenarioDealTerms.entities[entity.id]) {
          const et = scenarioDealTerms.entities[entity.id];
          closeTerms = {
            purchasePrice: et.purchasePrice || 0,
            equityContributed: et.equityContributed || 0,
            workingCapitalReserve: et.workingCapitalReserve || 0,
            transactionCosts: et.transactionCosts || 0
          };
        }

        // Cash flow
        const cfGrid = buildEntityCF({
          entityPL: plGrid, wcGrid, capexGrid,
          debtSchedules: entityDebtSchedules, periods,
          closePeriodIndex, closeTerms
        });

        // Balance sheet
        const bsGrid = buildEntityBS({
          entityPL: plGrid, wcGrid, capexGrid,
          debtSchedules: entityDebtSchedules, cfGrid,
          periods, closePeriodIndex, closeTerms
        });

        // Validation
        for (const bsRow of bsGrid) {
          if (!bsRow.isBalanced) {
            validationErrors.push({
              type: 'bs_imbalance',
              entityId: entity.id,
              periodIndex: bsRow.periodIndex,
              diff: bsRow.totalAssets - (bsRow.totalLiabilities + bsRow.totalEquity)
            });
          }
        }

        entityPLResults.push({
          entityId: entity.id,
          entityName: entity.entity_name,
          entityType: entity.entity_type,
          lineItemValues: entityResult.lineItemValues,
          lineItems: filteredLineItems,
          grid: plGrid
        });

        entityBSResults.push({
          entityId: entity.id,
          entityName: entity.entity_name,
          grid: bsGrid
        });

        entityCFResults.push({
          entityId: entity.id,
          entityName: entity.entity_name,
          grid: cfGrid
        });
      }

      const consolidatedPL = buildConsolidatedPL(entityPLResults, periods);
      const consolidatedBS = buildConsolidatedBS(entityBSResults, periods);
      const consolidatedCF = buildConsolidatedCF(entityCFResults, periods);

      runs.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        operatingScenarioId: opScenario.id,
        operatingScenarioName: opScenario.name,
        entityResults: entityPLResults,
        entityBSResults,
        entityCFResults,
        debtSchedules: allDebtSchedules,
        consolidatedPL,
        consolidatedBS,
        consolidatedCF,
        warnings,
        validationErrors
      });
    }
  }

  return { periods, runs };
}

// ─── 15. calculateXIRR ──────────────────────────────────────────────
/**
 * XIRR: finds the annualized rate r such that NPV = Σ cf[i]/(1+r)^(d[i]/365) = 0
 *
 * @param {Array<{amount: number, date: string}>} cashFlows
 *   Each entry: { amount: -500000, date: '2025-01-01' }
 *   Negative = outflow, positive = inflow
 * @returns {{ irr: number|null, moic: number, converged: boolean, warning: string|null }}
 */
function calculateXIRR(cashFlows) {
  if (!cashFlows || cashFlows.length < 2) {
    const totalIn = cashFlows ? cashFlows.filter(cf => cf.amount > 0).reduce((s, cf) => s + cf.amount, 0) : 0;
    const totalOut = cashFlows ? cashFlows.filter(cf => cf.amount < 0).reduce((s, cf) => s + Math.abs(cf.amount), 0) : 0;
    return { irr: null, moic: totalOut > 0 ? totalIn / totalOut : 0, converged: false, warning: 'insufficient_flows' };
  }

  const hasPositive = cashFlows.some(cf => cf.amount > 0);
  const hasNegative = cashFlows.some(cf => cf.amount < 0);
  const totalIn = cashFlows.filter(cf => cf.amount > 0).reduce((s, cf) => s + cf.amount, 0);
  const totalOut = cashFlows.filter(cf => cf.amount < 0).reduce((s, cf) => s + Math.abs(cf.amount), 0);
  const moic = totalOut > 0 ? totalIn / totalOut : 0;

  if (!hasPositive || !hasNegative) {
    return { irr: null, moic, converged: false, warning: 'no_sign_change' };
  }

  // Parse dates to day offsets from first date
  const dates = cashFlows.map(cf => new Date(cf.date + 'T00:00:00Z'));
  const d0 = dates[0].getTime();
  const dayOffsets = dates.map(d => (d.getTime() - d0) / (1000 * 60 * 60 * 24));

  function npv(rate) {
    let sum = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      sum += cashFlows[i].amount / Math.pow(1 + rate, dayOffsets[i] / 365);
    }
    return sum;
  }

  function npvDerivative(rate) {
    let sum = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const exp = dayOffsets[i] / 365;
      sum -= exp * cashFlows[i].amount / Math.pow(1 + rate, exp + 1);
    }
    return sum;
  }

  // Phase 1: Bisection — find bracket where NPV changes sign
  let rLow = null;
  let rHigh = null;
  let prevNPV = npv(-0.99);
  for (let r = -0.99; r <= 10.0; r += 0.005) {
    const curNPV = npv(r);
    if (prevNPV * curNPV < 0) {
      rLow = r - 0.005;
      rHigh = r;
      break;
    }
    prevNPV = curNPV;
  }

  if (rLow == null) {
    return { irr: null, moic, converged: false, warning: 'no_solution' };
  }

  // Phase 2: Newton-Raphson refinement from bracket midpoint
  let rate = (rLow + rHigh) / 2;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    if (Math.abs(f) < 0.01) {
      if (rate > 10.0) {
        return { irr: null, moic, converged: false, warning: 'exceeds_range' };
      }
      return { irr: rate, moic, converged: true, warning: null };
    }
    const df = npvDerivative(rate);
    if (Math.abs(df) < 1e-12) break;
    const newRate = rate - f / df;
    // Keep within bracket bounds for safety
    if (newRate < rLow || newRate > rHigh) {
      // Fall back to bisection step
      const mid = (rLow + rHigh) / 2;
      if (npv(mid) * npv(rLow) < 0) {
        rHigh = mid;
      } else {
        rLow = mid;
      }
      rate = (rLow + rHigh) / 2;
    } else {
      rate = newRate;
    }
  }

  // Didn't converge — return bisection midpoint as approximate
  if (rate > 10.0) {
    return { irr: null, moic, converged: false, warning: 'exceeds_range' };
  }
  return { irr: rate, moic, converged: false, warning: 'approximate' };
}

// ─── 16. allocateEVByEBITDA ─────────────────────────────────────────
/**
 * Allocates net equity pool to each SPV based on EBITDA contribution or acquisition cost.
 *
 * @param {Array<{entityId, ebitda, acquisitionCost}>} entityMetrics
 * @param {number} netEquityPool
 * @param {'ebitda_contribution'|'acquisition_cost'} method
 * @returns {Array<{entityId, allocatedAmount, allocationPct}>}
 */
function allocateEVByEBITDA(entityMetrics, netEquityPool, method) {
  const key = method === 'acquisition_cost' ? 'acquisitionCost' : 'ebitda';
  const total = entityMetrics.reduce((s, e) => s + (e[key] || 0), 0);

  if (total <= 0) {
    // Equal allocation as fallback
    const share = netEquityPool / entityMetrics.length;
    return entityMetrics.map(e => ({
      entityId: e.entityId,
      allocatedAmount: share,
      allocationPct: 1 / entityMetrics.length
    }));
  }

  return entityMetrics.map(e => {
    const pct = (e[key] || 0) / total;
    return {
      entityId: e.entityId,
      allocatedAmount: netEquityPool * pct,
      allocationPct: pct
    };
  });
}

// ─── 17. runSPVWaterfall ────────────────────────────────────────────
/**
 * Runs the 4-step waterfall for a single SPV's allocated equity pool.
 *
 * @param {number} allocatedPool - Amount allocated to this SPV
 * @param {Array<{partyName, partyType, baseEquityPct, carryPct, hurdleRateAnnual,
 *   contributedCapital, contributionPeriodIndex}>} equityTable
 * @param {number} yearsHeld - Years from contribution to exit
 * @returns {Array<{partyName, partyType, returnOfCapital, preferredReturn,
 *   catchUp, residual, totalProceeds, profit}>}
 */
function runSPVWaterfall(allocatedPool, equityTable, yearsHeld) {
  let remaining = allocatedPool;
  const results = equityTable.map(e => ({
    partyName: e.partyName,
    partyType: e.partyType,
    contributedCapital: e.contributedCapital,
    returnOfCapital: 0,
    preferredReturn: 0,
    catchUp: 0,
    residual: 0,
    totalProceeds: 0,
    profit: 0
  }));

  const totalContributed = equityTable.reduce((s, e) => s + e.contributedCapital, 0);

  // Step 1: Return of contributed capital (pro rata if insufficient)
  if (remaining >= totalContributed) {
    for (let i = 0; i < equityTable.length; i++) {
      results[i].returnOfCapital = equityTable[i].contributedCapital;
    }
    remaining -= totalContributed;
  } else {
    // Pro rata at base_equity_pct
    for (let i = 0; i < equityTable.length; i++) {
      results[i].returnOfCapital = remaining * equityTable[i].baseEquityPct;
    }
    remaining = 0;
  }

  if (remaining <= 0) {
    for (let i = 0; i < results.length; i++) {
      results[i].totalProceeds = results[i].returnOfCapital;
      results[i].profit = results[i].totalProceeds - equityTable[i].contributedCapital;
    }
    return results;
  }

  // Step 2: Preferred return (hurdle)
  let totalPrefReturn = 0;
  const prefAmounts = equityTable.map(e => {
    const pref = e.contributedCapital * e.hurdleRateAnnual * yearsHeld;
    totalPrefReturn += pref;
    return pref;
  });

  if (remaining >= totalPrefReturn) {
    for (let i = 0; i < equityTable.length; i++) {
      results[i].preferredReturn = prefAmounts[i];
    }
    remaining -= totalPrefReturn;
  } else {
    // Pro rata preferred return
    const ratio = totalPrefReturn > 0 ? remaining / totalPrefReturn : 0;
    for (let i = 0; i < equityTable.length; i++) {
      results[i].preferredReturn = prefAmounts[i] * ratio;
    }
    remaining = 0;
  }

  if (remaining <= 0) {
    for (let i = 0; i < results.length; i++) {
      results[i].totalProceeds = results[i].returnOfCapital + results[i].preferredReturn;
      results[i].profit = results[i].totalProceeds - equityTable[i].contributedCapital;
    }
    return results;
  }

  // Step 3: Sponsor catch-up
  // Sponsor receives carry_pct of total profit above hurdle
  const sponsors = equityTable.filter(e => e.carryPct > 0);
  if (sponsors.length > 0) {
    // Total profit above hurdle (remaining is what's left after capital + pref)
    // Catch-up: sponsor gets distributions until they have carryPct of total profit
    // Total profit above hurdle = remaining (everything beyond capital + pref return)
    // Sponsor target = carryPct × totalProfit / (1 - carryPct) [standard catch-up formula]
    // But simplified: sponsor gets carry_pct of remaining until caught up
    for (let si = 0; si < sponsors.length; si++) {
      const sponsor = sponsors[si];
      const sponsorIdx = equityTable.indexOf(sponsor);
      // Catch-up amount: sponsor_carry_pct / (1 - sponsor_carry_pct) of remaining,
      // capped at available
      const catchUpTarget = (sponsor.carryPct / (1 - sponsor.carryPct)) * remaining;
      const catchUp = Math.min(catchUpTarget, remaining);
      results[sponsorIdx].catchUp = catchUp;
      remaining -= catchUp;
    }
  }

  if (remaining <= 0) {
    for (let i = 0; i < results.length; i++) {
      results[i].totalProceeds = results[i].returnOfCapital + results[i].preferredReturn + results[i].catchUp;
      results[i].profit = results[i].totalProceeds - equityTable[i].contributedCapital;
    }
    return results;
  }

  // Step 4: Remaining proceeds split at base_equity_pct
  for (let i = 0; i < equityTable.length; i++) {
    results[i].residual = remaining * equityTable[i].baseEquityPct;
  }

  // Totals
  for (let i = 0; i < results.length; i++) {
    results[i].totalProceeds = results[i].returnOfCapital + results[i].preferredReturn
      + results[i].catchUp + results[i].residual;
    results[i].profit = results[i].totalProceeds - equityTable[i].contributedCapital;
  }

  return results;
}

// ─── 18. computeLiquidityEvent ──────────────────────────────────────
/**
 * Computes a full exit or recapitalization event.
 *
 * @param {Object} params
 * @param {Object} params.exitEvent - model_liquidity_events row
 * @param {Array} params.entityPLGrids - [{entityId, grid: [{periodIndex, ebitda, ...}]}]
 * @param {Array} params.debtSchedules - [{entityId, instrumentName, instrumentType, schedule}]
 * @param {Array} params.equityTables - [{entityId, entries: [{partyName, partyType, ...}]}]
 * @param {Object} params.model - { start_date, period_count }
 * @param {Array} params.periods - from generatePeriods
 * @param {Array} params.dealTerms - [{entityId, purchasePrice}] for acquisition_cost method
 * @returns {Object} Full waterfall result with per-party returns
 */
function computeLiquidityEvent(params) {
  const { exitEvent, entityPLGrids, debtSchedules, equityTables, model, periods, dealTerms } = params;
  const eventPeriod = exitEvent.event_period_index;
  const trailingPeriods = exitEvent.trailing_periods || 12;
  const exitType = exitEvent.exit_type || 'full_exit';

  // 1. Compute trailing EBITDA per entity and platform total
  const entityMetrics = [];
  let platformEBITDA = 0;

  for (const epl of entityPLGrids) {
    const startPeriod = Math.max(0, eventPeriod - trailingPeriods + 1);
    let trailingEbitda = 0;
    for (let pi = startPeriod; pi <= eventPeriod; pi++) {
      const row = epl.grid.find(r => r.periodIndex === pi);
      if (row) trailingEbitda += row.ebitda;
    }

    const dt = dealTerms ? dealTerms.find(d => d.entityId === epl.entityId) : null;
    entityMetrics.push({
      entityId: epl.entityId,
      ebitda: trailingEbitda,
      acquisitionCost: dt ? dt.purchasePrice : 0
    });
    platformEBITDA += trailingEbitda;
  }

  // 2. Compute total remaining debt at event period
  let totalRemainingDebt = 0;
  const debtByEntity = {};
  for (const ds of debtSchedules) {
    const row = ds.schedule.find(r => r.periodIndex === eventPeriod);
    const balance = row ? row.endingBalance : 0;
    totalRemainingDebt += balance;
    if (!debtByEntity[ds.entityId]) debtByEntity[ds.entityId] = 0;
    debtByEntity[ds.entityId] += balance;
  }

  if (exitType === 'recapitalization') {
    return computeRecap({
      exitEvent, platformEBITDA, totalRemainingDebt, entityMetrics,
      equityTables, debtSchedules, model, periods, debtByEntity
    });
  }

  // 3. Full exit waterfall
  const exitMultipleBase = Number(exitEvent.exit_multiple_base) || 0;
  const exitMultipleLow = Number(exitEvent.exit_multiple_low) || exitMultipleBase;
  const exitMultipleHigh = Number(exitEvent.exit_multiple_high) || exitMultipleBase;
  const txCostsPct = Number(exitEvent.exit_transaction_costs_pct) || 0.04;

  const cases = [
    { label: 'low', multiple: exitMultipleLow },
    { label: 'base', multiple: exitMultipleBase },
    { label: 'high', multiple: exitMultipleHigh }
  ];

  const results = {};

  for (const c of cases) {
    const grossEV = platformEBITDA * c.multiple;
    const txCosts = grossEV * txCostsPct;
    const netProceeds = grossEV - txCosts;
    const grossEquityPool = netProceeds - totalRemainingDebt;
    // TODO: earnout settlement would reduce this further
    const netEquityPool = Math.max(0, grossEquityPool);

    // Allocate to SPVs
    const method = exitEvent.ebitda_allocation_method || 'ebitda_contribution';
    const allocations = allocateEVByEBITDA(entityMetrics, netEquityPool, method);

    // Run waterfall per SPV
    const spvWaterfalls = [];
    for (const alloc of allocations) {
      const equityEntry = equityTables.find(et => et.entityId === alloc.entityId);
      if (!equityEntry || !equityEntry.entries || equityEntry.entries.length === 0) {
        spvWaterfalls.push({
          entityId: alloc.entityId,
          allocatedAmount: alloc.allocatedAmount,
          allocationPct: alloc.allocationPct,
          waterfall: [],
          warning: 'no_equity_table'
        });
        continue;
      }

      // Years held = from each party's contribution to exit
      const exitDate = periods[eventPeriod] ? periods[eventPeriod].startDate : null;
      const waterfall = runSPVWaterfall(
        alloc.allocatedAmount,
        equityEntry.entries.map(e => ({
          partyName: e.party_name,
          partyType: e.party_type,
          baseEquityPct: Number(e.base_equity_pct),
          carryPct: Number(e.carry_pct) || 0,
          hurdleRateAnnual: Number(e.hurdle_rate_annual) || 0,
          contributedCapital: Number(e.contributed_capital) || 0,
          contributionPeriodIndex: e.contribution_period_index || 0
        })),
        (eventPeriod - (equityEntry.entries[0]?.contribution_period_index || 0)) / 12
      );

      // Compute XIRR per party
      const waterfallWithIRR = waterfall.map(w => {
        const entry = equityEntry.entries.find(e => e.party_name === w.partyName);
        const contribPeriod = entry ? (entry.contribution_period_index || 0) : 0;
        const contribDate = periods[contribPeriod] ? periods[contribPeriod].startDate : model.start_date;

        const cashFlows = [
          { amount: -w.contributedCapital, date: contribDate }
        ];
        if (exitDate && w.totalProceeds > 0) {
          cashFlows.push({ amount: w.totalProceeds, date: exitDate });
        }

        const xirrResult = calculateXIRR(cashFlows);
        return { ...w, irr: xirrResult.irr, moic: xirrResult.moic, irrWarning: xirrResult.warning };
      });

      spvWaterfalls.push({
        entityId: alloc.entityId,
        allocatedAmount: alloc.allocatedAmount,
        allocationPct: alloc.allocationPct,
        waterfall: waterfallWithIRR
      });
    }

    // Roll up per-party across all SPVs
    const partyRollup = {};
    for (const spvW of spvWaterfalls) {
      for (const w of spvW.waterfall) {
        if (!partyRollup[w.partyName]) {
          partyRollup[w.partyName] = {
            partyName: w.partyName,
            partyType: w.partyType,
            totalContributed: 0,
            totalProceeds: 0,
            totalProfit: 0,
            cashFlows: []
          };
        }
        partyRollup[w.partyName].totalContributed += w.contributedCapital;
        partyRollup[w.partyName].totalProceeds += w.totalProceeds;
        partyRollup[w.partyName].totalProfit += w.profit;

        // Collect cash flows for combined XIRR
        const entry = (equityTables.find(et => et.entityId === spvW.entityId)?.entries || [])
          .find(e => e.party_name === w.partyName);
        const contribPeriod = entry ? (entry.contribution_period_index || 0) : 0;
        const contribDate = periods[contribPeriod] ? periods[contribPeriod].startDate : model.start_date;
        const exitDate = periods[eventPeriod] ? periods[eventPeriod].startDate : null;

        partyRollup[w.partyName].cashFlows.push(
          { amount: -w.contributedCapital, date: contribDate }
        );
        if (exitDate && w.totalProceeds > 0) {
          partyRollup[w.partyName].cashFlows.push(
            { amount: w.totalProceeds, date: exitDate }
          );
        }
      }
    }

    // Compute combined XIRR + MOIC per party
    const partyResults = Object.values(partyRollup).map(p => {
      const xirrResult = calculateXIRR(p.cashFlows);
      return {
        partyName: p.partyName,
        partyType: p.partyType,
        totalContributed: p.totalContributed,
        totalProceeds: p.totalProceeds,
        totalProfit: p.totalProfit,
        irr: xirrResult.irr,
        moic: xirrResult.moic,
        irrWarning: xirrResult.warning
      };
    });

    results[c.label] = {
      grossEV,
      txCosts,
      netProceeds,
      totalDebtRepaid: totalRemainingDebt,
      grossEquityPool,
      netEquityPool,
      platformEBITDA,
      exitMultiple: c.multiple,
      spvWaterfalls,
      partyResults
    };
  }

  return {
    exitType: 'full_exit',
    eventName: exitEvent.event_name,
    eventPeriodIndex: eventPeriod,
    platformEBITDA,
    totalRemainingDebt,
    cases: results
  };
}

// ─── 19. computeRecap (internal helper for computeLiquidityEvent) ───
function computeRecap(params) {
  const {
    exitEvent, platformEBITDA, totalRemainingDebt, entityMetrics,
    equityTables, debtSchedules, model, periods, debtByEntity
  } = params;

  const eventPeriod = exitEvent.event_period_index;
  const leverageMultiple = Number(exitEvent.recap_leverage_multiple) || 0;
  const refiCostsPct = Number(exitEvent.recap_refi_costs_pct) || 0.02;
  const newFacilitySize = platformEBITDA * leverageMultiple;
  const refiCosts = newFacilitySize * refiCostsPct;
  const netRecapDividend = newFacilitySize - totalRemainingDebt - refiCosts;

  const warnings = [];
  if (netRecapDividend <= 0) {
    warnings.push('recap_not_accretive');
  }

  const dividendPool = Math.max(0, netRecapDividend);

  // Allocate dividend to SPVs
  const method = exitEvent.ebitda_allocation_method || 'ebitda_contribution';
  const allocations = allocateEVByEBITDA(entityMetrics, dividendPool, method);

  // Run waterfall per SPV on the dividend
  const spvWaterfalls = [];
  for (const alloc of allocations) {
    const equityEntry = equityTables.find(et => et.entityId === alloc.entityId);
    if (!equityEntry || !equityEntry.entries || equityEntry.entries.length === 0) {
      spvWaterfalls.push({
        entityId: alloc.entityId,
        allocatedAmount: alloc.allocatedAmount,
        allocationPct: alloc.allocationPct,
        waterfall: [],
        warning: 'no_equity_table'
      });
      continue;
    }

    const waterfall = runSPVWaterfall(
      alloc.allocatedAmount,
      equityEntry.entries.map(e => ({
        partyName: e.party_name,
        partyType: e.party_type,
        baseEquityPct: Number(e.base_equity_pct),
        carryPct: Number(e.carry_pct) || 0,
        hurdleRateAnnual: Number(e.hurdle_rate_annual) || 0,
        contributedCapital: Number(e.contributed_capital) || 0,
        contributionPeriodIndex: e.contribution_period_index || 0
      })),
      (eventPeriod - (equityEntry.entries[0]?.contribution_period_index || 0)) / 12
    );

    // For recap, XIRR is not computed (not a terminal event) — MOIC only
    const waterfallWithMetrics = waterfall.map(w => ({
      ...w,
      irr: null,
      moic: w.contributedCapital > 0 ? w.totalProceeds / w.contributedCapital : 0,
      irrWarning: 'recap_partial'
    }));

    spvWaterfalls.push({
      entityId: alloc.entityId,
      allocatedAmount: alloc.allocatedAmount,
      allocationPct: alloc.allocationPct,
      waterfall: waterfallWithMetrics
    });
  }

  // Roll up per party
  const partyRollup = {};
  for (const spvW of spvWaterfalls) {
    for (const w of spvW.waterfall) {
      if (!partyRollup[w.partyName]) {
        partyRollup[w.partyName] = {
          partyName: w.partyName,
          partyType: w.partyType,
          totalContributed: 0,
          totalDividend: 0
        };
      }
      partyRollup[w.partyName].totalContributed += w.contributedCapital;
      partyRollup[w.partyName].totalDividend += w.totalProceeds;
    }
  }

  const partyResults = Object.values(partyRollup).map(p => ({
    partyName: p.partyName,
    partyType: p.partyType,
    totalContributed: p.totalContributed,
    totalDividend: p.totalDividend,
    partialMOIC: p.totalContributed > 0 ? p.totalDividend / p.totalContributed : 0,
    irr: null,
    irrWarning: 'recap_partial'
  }));

  // Fork debt state for post-recap projection
  const newFacilityTermMonths = exitEvent.recap_new_facility_term_months || 84;
  const postRecapDebt = {
    newFacilitySize,
    currentDebtRepaid: totalRemainingDebt,
    newFacilityTermMonths,
    effectivePeriod: eventPeriod
  };

  return {
    exitType: 'recapitalization',
    eventName: exitEvent.event_name,
    eventPeriodIndex: eventPeriod,
    platformEBITDA,
    totalRemainingDebt,
    newFacilitySize,
    refiCosts,
    netRecapDividend,
    dividendPool,
    spvWaterfalls,
    partyResults,
    postRecapDebt,
    warnings
  };
}

// ─── 20. computeKeyMetrics ──────────────────────────────────────────
/**
 * Extracts summary metrics from engine runs + waterfall results.
 * Pure function — no DB access.
 *
 * @param {Array} runs - engine result.runs (each has debtSchedules, entityResults, entityBSResults)
 * @param {Array} waterfallResults - array of computeLiquidityEvent outputs
 * @returns {Object} JSONB-friendly summary metrics
 */
function computeKeyMetrics(runs, waterfallResults) {
  // 1. DSCR: scan all runs for debt service coverage
  const dscrValues = [];
  for (const run of (runs || [])) {
    const debtSchedules = run.debtSchedules || [];
    const entityResults = run.entityResults || [];

    // Build per-period EBITDA from entity P&L grids
    const periodEbitda = {};
    for (const er of entityResults) {
      for (const row of (er.grid || [])) {
        const pi = row.periodIndex;
        if (!periodEbitda[pi]) periodEbitda[pi] = 0;
        periodEbitda[pi] += (row.ebitda != null ? row.ebitda : 0);
      }
    }

    // Build per-period debt service from debt schedules
    const periodDebtService = {};
    for (const ds of debtSchedules) {
      for (const row of (ds.schedule || [])) {
        const pi = row.periodIndex;
        if (!periodDebtService[pi]) periodDebtService[pi] = 0;
        periodDebtService[pi] += (Number(row.cashInterest) || 0) + (Number(row.cashPrincipal) || 0);
      }
    }

    // Compute DSCR at each period where there's debt service
    for (const pi of Object.keys(periodDebtService)) {
      const ds = periodDebtService[pi];
      if (ds > 0) {
        const ebitda = periodEbitda[pi] || 0;
        dscrValues.push(ebitda / ds);
      }
    }
  }

  const dscrMin = dscrValues.length > 0 ? Math.min(...dscrValues) : Infinity;
  const dscrAvg = dscrValues.length > 0
    ? dscrValues.reduce((a, b) => a + b, 0) / dscrValues.length
    : Infinity;

  // 2. MOIC/IRR by party: extract from waterfall results
  const moicByParty = {};
  const irrByParty = {};
  for (const wf of (waterfallResults || [])) {
    const cases = wf.cases || {};
    // Use 'base' case if available
    const baseCase = cases.base || cases.low || Object.values(cases)[0];
    if (!baseCase) continue;

    for (const pr of (baseCase.partyResults || [])) {
      moicByParty[pr.partyName] = pr.moic;
      irrByParty[pr.partyName] = pr.irr;
    }
  }

  // 3. Leverage at close: total debt / total equity at period 0
  let leverageAtClose = null;
  if (runs && runs.length > 0) {
    const firstRun = runs[0];
    let totalDebtAtClose = 0;
    let totalEquityAtClose = 0;

    for (const ds of (firstRun.debtSchedules || [])) {
      const firstRow = (ds.schedule || [])[0];
      if (firstRow) totalDebtAtClose += Number(firstRow.newBorrowings) || Number(firstRow.endingBalance) || 0;
    }

    for (const ebs of (firstRun.entityBSResults || [])) {
      const firstRow = (ebs.grid || [])[0];
      if (firstRow && firstRow.totalEquity) totalEquityAtClose += firstRow.totalEquity;
    }

    if (totalEquityAtClose !== 0) {
      leverageAtClose = totalDebtAtClose / totalEquityAtClose;
    }
  }

  return {
    dscrMin,
    dscrAvg,
    moicByParty,
    irrByParty,
    leverageAtClose
  };
}

// ─── computeDSCR ────────────────────────────────────────────────────
/**
 * Compute Debt Service Coverage Ratio over a trailing window.
 *
 * @param {number} periodIndex      - current period (0-based)
 * @param {number} trailingPeriods   - lookback window (e.g. 12 for trailing-12)
 * @param {Array}  entityPLRows      - rows with { periodIndex, ebitda }
 * @param {Array}  debtScheduleRows  - rows with { period_index, cash_interest, cash_principal }
 * @returns {{ portfolioEbitda, debtService, dscr, aboveThreshold, aboveFloor }}
 */
function computeDSCR(periodIndex, trailingPeriods, entityPLRows, debtScheduleRows) {
  const windowStart = Math.max(0, periodIndex - trailingPeriods + 1);

  let portfolioEbitda = 0;
  for (const row of entityPLRows) {
    if (row.periodIndex >= windowStart && row.periodIndex <= periodIndex) {
      portfolioEbitda += Number(row.ebitda) || 0;
    }
  }

  let debtService = 0;
  for (const row of debtScheduleRows) {
    const pi = row.period_index;
    if (pi >= windowStart && pi <= periodIndex) {
      debtService += (Number(row.cash_interest) || 0) + (Number(row.cash_principal) || 0);
    }
  }

  const dscr = debtService === 0 ? Infinity : portfolioEbitda / debtService;

  return {
    portfolioEbitda,
    debtService,
    dscr,
    aboveThreshold: dscr >= 1.25,
    aboveFloor: dscr >= 1.00
  };
}

module.exports = {
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
  calculateModel,
  calculateXIRR,
  allocateEVByEBITDA,
  runSPVWaterfall,
  computeLiquidityEvent,
  computeDSCR,
  computeKeyMetrics
};
