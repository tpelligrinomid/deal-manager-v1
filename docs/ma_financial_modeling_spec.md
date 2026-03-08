# M&A Financial Modeling Module
**Technical Specification — Render Backend + Lovable Frontend**
Deal Room by Aragon Holdings | Version 1.6

---

## Changelog

| Version | Changes |
|---|---|
| 1.0 | Initial spec |
| 1.1 | Four-layer cash flow structure, interest vs. principal separation, DSCR logic |
| 1.2 | MiD baseline template system. Lovable architecture questions resolved. |
| 1.3 | Full three-statement model, 120-period default, corkscrew debt with PIK, working capital drivers, segments, intermediate holdco, operating scenario dimension, COA mapping. |
| 1.6 | Added per-SPV equity cap tables with carry/hurdle mechanics. Added two exit types: full exit and recapitalization. Added multiple exit events per model (one-to-many). Added XIRR/IRR calculation per party per SPV. Added deal maker compensation with step-up tiers. Added revenue_type field on model_line_items ('client', 'referral', 'management') — referral income owned by receiving entity, no intercompany flag needed, consolidated top-line = client revenue only. Added covenant tracking module. Added platform-level EBITDA definition for lender reporting. |
| 1.5 | Added point-in-time snapshot system. Snapshots capture sources & uses, DSCR, debt state, and balance sheet at any period index. Two modes: live preview (calculated on demand) and saved snapshot (frozen artifact for lender packages). Snapshot triggers live on the Acquisition Timeline — each deal close marker has a snapshot button, and any period on the timeline can generate a snapshot. Added `model_snapshots` table and `/api/models/:modelId/snapshot` endpoint. Updated Acquisition Timeline and Build Sequence. |
| 1.4 | **Major architecture change:** Models promoted to top-level application module. Models are no longer owned by a single deal — they reference multiple deals via a junction table with close dates. Introduced staged acquisition timeline: each deal reference has a close_date that maps to a period index, determining when that entity's financials activate in the model. Introduced placeholder deal concept for pipeline modeling. Updated nav, routing, and all affected schema. |

---

## 1. Application Module Structure

The Deal Room application is organized into four top-level modules. The Models module is new as of v1.4 and is independent of any single deal.

```
SIDEBAR NAV
───────────
Deals         ← existing module (deals, NDA, checklist, documents, survey, notes)
NDAs          ← existing module
Team          ← existing module
Models        ← NEW top-level module
Settings      ← existing module
```

### 1.1 Deals Module (Existing + Extended)

The Deals module remains unchanged in structure. The only addition is a new deal status value and a lightweight financial fields panel to support placeholder deals.

**Deals can now serve two purposes:**
1. **Active diligence deals** — real targets with NDA, checklist, documents, survey in progress
2. **Placeholder deals** — pipeline targets with estimated financials and a future close date, used as model inputs before diligence begins

Both types are the same `deals` table record. A deal becomes a placeholder simply by having estimated financials entered and being referenced in a model with a future close date.

**New deal status value:** Add `'pipeline'` to the `deal_status` enum alongside existing values. Pipeline deals are placeholders with no NDA required.

### 1.2 Models Module (New)

The Models module is a standalone area of the application with its own navigation, list view, and detail view. It has no required relationship to a specific deal — a model can reference zero, one, or many deals.

**Models module pages:**

```
/models                    → Models list (all models, create new)
/models/:modelId           → Model detail (ModelBuilder — entity tabs, scenarios, grid)
/models/baseline           → MiD Baseline settings (org-level, not deal-specific)
```

---

## 2. Core Concept: Models Reference Deals, Not the Reverse

In v1.3 and earlier, `financial_models.deal_id` made a model a child of a single deal. This is wrong for a roll-up strategy.

**The correct relationship:**

- A **model** represents a full acquisition strategy — potentially multiple targets, phased over time, with a single consolidated exit.
- A **deal** is a target company record. It can be referenced by one or more models.
- The **junction** between them (`model_deal_references`) carries the close date, which determines when that deal's financials activate in the model.

```
DEALS MODULE                    MODELS MODULE
────────────                    ─────────────
Deal: New North (anchor)   ──┐
Deal: Target B (pipeline)  ──┼──► Model: AEO Roll-Up 2025
Deal: Target C (pipeline)  ──┘       ├── MiD Baseline (period 0 → 119)
                                      ├── Intermediate HoldCo
                                      ├── SPV-A: New North    closes period 0
                                      ├── SPV-B: Target B     closes period 12
                                      └── SPV-C: Target C     closes period 18
```

### 2.1 What "Close Date" Means in the Model

Each deal reference has a `close_date` (a calendar date) which maps to a `close_period_index` in the model (calculated as months from `financial_models.start_date`).

The close period index is the moment when, for that entity:

- Sources & uses fires — equity injection, debt drawn, purchase price paid out
- The debt corkscrew begins (period 0 of that instrument = the close period)
- The target entity's revenue and expenses begin flowing into the P&L
- Goodwill and acquisition debt appear on the balance sheet
- The SPV entity becomes active

Before the close period, that entity's contribution to the model is zero — it does not yet exist in the portfolio.

### 2.2 Simultaneous vs. Staged Acquisitions

**Simultaneous (same close date):** Three deals all close at period 0. One tranche drawn from the facility at close. All three targets contribute from period 0.

**Staged (different close dates):** Anchor closes at period 0. Target B closes at period 12. Target C closes at period 18. Each close draws an additional tranche. Debt service steps up at each close. The model automatically shows the portfolio building over time.

This is the expected pattern for a roll-up strategy. Lenders need to see the staggered draw schedule and verify that DSCR remains above threshold at each step-up.

### 2.3 Placeholder Deals

A deal record with status `'pipeline'` serves as a placeholder. It has:
- Estimated `reported_revenue` and `reported_ebitda`
- Estimated `asking_price`
- No NDA, checklist, or documents required
- A future `close_date` when referenced in a model

When diligence advances and real financials become available, you update the deal record. The model automatically inherits the updated seed values on the next calculate run — unless the entity has been manually overridden (same baseline override pattern used for MiD).

---

## 3. Entity Architecture

```
Aragon Holdings  (parent holdco — not a loan party)
    │
    ├── Marketers in Demand  (operating holdco — standalone, no intercompany flows)
    │       └── New North, Motion, Ideometry, etc.
    │
    └── Aragon [Vertical] HoldCo  (intermediate holdco — loan sits here)
            ├── SPV-A / Target A   closes period 0
            ├── SPV-B / Target B   closes period 12
            └── SPV-C / Target C   closes period 18
```

Each SPV/target pair is a single combined entity in the model (one set of line items, one debt corkscrew, one balance sheet). The SPV is the legal acquisition vehicle; the target is the operating business. For modeling purposes they are treated as one entity that activates at close.

---

## 4. Key Design Rules

- Models are top-level objects, not children of deals.
- A model references deals via `model_deal_references` with a close date per reference.
- Each deal reference activates at its close period — zero contribution before that period.
- MiD is always standalone. No intercompany cash flows to any acquisition vehicle.
- Aragon may contribute a one-time equity injection at close as a balance sheet event.
- The Consolidated View (MiD + Intermediate HoldCo group) is read-only for exit sizing.
- All models run 120 monthly periods (10 years) by default.
- The model produces three balanced statements (P&L, BS, CF) every period.
- Multiple models are supported. A Models list view is the entry point.
- MiD financials live in a baseline template managed from the Models module.
- Placeholder deals can be referenced in models before diligence is complete.

---

## 5. Two Scenario Dimensions

*(Unchanged from v1.3)*

### 5.1 Deal Structure Scenarios (`model_scenarios`)

Vary the capital structure — how the deal(s) are financed:
- All Cash
- Seller Note 30%
- IO + Balloon
- Earnout Heavy

When multiple deals are in a model, the deal structure scenario applies at the **intermediate holdco level** — the facility terms, overall leverage, and equity injection at each close date are defined here.

### 5.2 Operating Assumption Scenarios (`model_operating_scenarios`)

Vary business performance assumptions:

| Case | Description | Audience |
|---|---|---|
| **Downside (Flat)** | No growth on any target. Must still cover debt service ≥ 1.00x DSCR. | Lenders — primary stress test |
| **Base (Management)** | Reasonable expected growth per target. | Lenders + equity investors |
| **Upside** | Aggressive growth if all targets outperform. | Equity investors |

### 5.3 Organic vs. Inorganic Growth

- **Organic** — growth from a target's existing clients and service lines
- **Inorganic** — contribution from a new deal reference activating at a future close period

When Target B activates at period 12, that revenue is inorganic from the consolidated model's perspective. The engine labels it automatically based on the close period index.

---

## 6. Three-Statement Model Structure

*(Unchanged from v1.3 — P&L, Balance Sheet, Cash Flow Statement layouts are identical.)*

The only behavioral difference is that entities with a `close_period_index > 0` contribute zero to all three statements before their close period. The engine skips those entities for periods 0 through `close_period_index - 1`.

See v1.3 Section 4 for full statement layouts.

---

## 7. Debt Corkscrew

*(Unchanged from v1.3)*

The corkscrew for each instrument starts at the entity's `close_period_index`. For periods before close, all corkscrew values are zero. The route handler passes `close_period_index` to the engine so the instrument's period 0 maps to the correct model period.

---

## 8. Full Database Schema

### 8.1 deal_status Enum Extension

Add `'pipeline'` to the existing `deal_status` enum:

```sql
ALTER TYPE deal_status ADD VALUE 'pipeline';
```

Pipeline deals are placeholder records. No NDA, checklist, or documents required.

---

### 8.2 mid_baseline

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | e.g. 'MiD 2025 Baseline' |
| `effective_date` | date | |
| `is_active` | boolean | One active baseline at a time |
| `created_by` | uuid | FK → profiles.id |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### 8.3 mid_baseline_entities

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `baseline_id` | uuid | FK → mid_baseline.id, ON DELETE CASCADE |
| `entity_name` | text | 'Marketers in Demand Baseline' |
| `created_at` | timestamptz | |

---

### 8.4 financial_models

**Changed from v1.3:** `deal_id` removed. Models are no longer owned by a deal.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK |
| `name` | text | No | e.g. 'AEO Roll-Up 2025', 'Initial Model' |
| `description` | text | Yes | Optional narrative |
| `start_date` | date | No | Period 0 calendar date. All close dates are relative to this. |
| `period_count` | integer | No | Default 120 |
| `period_type` | text | No | 'monthly' only |
| `profit_metric` | text | No | 'ebitda' or 'sde' |
| `presentation_granularity` | text | No | 'monthly', 'quarterly', 'annual' — display only |
| `created_by` | uuid | Yes | FK → profiles.id |
| `created_at` | timestamptz | No | now() |
| `updated_at` | timestamptz | No | now() |

---

### 8.5 model_deal_references

**New table.** Junction between models and deals. Carries the close date and controls how deal data seeds the model entity.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK |
| `model_id` | uuid | No | FK → financial_models.id, ON DELETE CASCADE |
| `deal_id` | uuid | No | FK → deals.id |
| `entity_id` | uuid | No | FK → model_entities.id — which entity in the model this deal feeds |
| `close_date` | date | No | Calendar date this acquisition closes |
| `close_period_index` | integer | No | Calculated: months between model.start_date and close_date. Stored for engine efficiency. |
| `pull_reported_revenue` | boolean | No | Default true — seed entity base_amount from deal.reported_revenue |
| `pull_reported_ebitda` | boolean | No | Default true — seed EBITDA target from deal.reported_ebitda |
| `pull_asking_price` | boolean | No | Default true — seed purchase_price from deal.asking_price |
| `seed_overridden` | boolean | No | Default false. Set true if user has manually overridden seeded values. Prevents future deal updates from overwriting manual inputs. |
| `notes` | text | Yes | |
| `created_at` | timestamptz | No | now() |

**Unique constraint:** `UNIQUE(model_id, entity_id)` — one deal per entity.

**Calculated field note:** `close_period_index` is derived as:
```
close_period_index = months_between(model.start_date, close_date)
```
Store it on insert/update so the engine doesn't recompute it. Validate that `close_period_index >= 0` and `< period_count`.

---

### 8.6 model_operating_scenarios

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `name` | text | 'Downside (Flat)', 'Base (Management)', 'Upside' |
| `case_type` | text | 'downside', 'base', 'upside' |
| `description` | text | Narrative of assumptions |
| `is_default` | boolean | True for 'base' |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(model_id, case_type)`

---

### 8.7 model_scenarios (Deal Structure)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `name` | text | |
| `is_base_case` | boolean | |
| **Facility-Level Terms** | | Applied at intermediate holdco level |
| `total_facility_size` | numeric | Maximum available credit facility |
| `initial_tranche_amount` | numeric | Amount drawn at period 0 close |
| `facility_rate` | numeric | Annual interest rate on facility, decimal |
| `facility_term_months` | integer | |
| `facility_io_months` | integer | |
| `facility_deferred_months` | integer | |
| `facility_pik` | boolean | |
| `facility_balloon_month` | integer | |
| **Per-Deal Terms** | | Stored on model_deal_references or overridden here |
| `default_seller_note_rate` | numeric | Applied to all deal references unless overridden |
| `default_seller_note_term_months` | integer | |
| `default_seller_note_io_months` | integer | |
| `default_seller_note_deferred_months` | integer | |
| `default_seller_note_pik` | boolean | |
| `default_earnout_is_equity_instrument` | boolean | |
| **Equity at Close** | | |
| `equity_from_investors` | numeric | Third-party equity — total across all closes |
| `equity_from_aragon` | numeric | One-time Aragon contribution — total |
| `equity_from_other` | numeric | |
| **Other** | | |
| `management_fee_monthly` | numeric | Charged to intermediate holdco |
| `exit_transaction_costs_pct` | numeric | Default 0.04 |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(model_id, name)`

**Design note:** In a multi-deal model, the acquisition debt is typically a single facility at the intermediate holdco level, not separate loans per SPV. Individual deal terms (seller note, earnout) live on `model_deal_scenario_terms` (see 8.8).

---

### 8.8 model_deal_scenario_terms

**New table.** Per-deal, per-scenario financial terms. Allows different seller note or earnout terms for each deal within the same scenario.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_deal_reference_id` | uuid | FK → model_deal_references.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id, ON DELETE CASCADE |
| `purchase_price` | numeric | Overrides deal.asking_price if set |
| `transaction_costs` | numeric | |
| `working_capital_reserve` | numeric | |
| `equity_from_target_balance` | numeric | Target's own cash at close |
| `tranche_amount` | numeric | Amount drawn from facility for this deal |
| `seller_note_amount` | numeric | |
| `seller_note_rate` | numeric | Overrides scenario default if set |
| `seller_note_term_months` | integer | |
| `seller_note_io_months` | integer | |
| `seller_note_deferred_months` | integer | |
| `seller_note_pik` | boolean | |
| `earnout_amount` | numeric | |
| `earnout_threshold` | numeric | |
| `earnout_cap` | numeric | |
| `earnout_period_months` | integer | |
| `earnout_is_equity_instrument` | boolean | |
| `seller_equity_rollover_pct` | numeric | |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(model_deal_reference_id, scenario_id)`

---

### 8.9 model_entities

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `entity_type` | text | 'aragon', 'mid_holdco', 'intermediate_holdco', 'spv', 'target', 'consolidated' |
| `entity_name` | text | User-editable |
| `parent_entity_id` | uuid | Self-referential FK |
| `close_period_index` | integer | Null for aragon/mid/holdco. Set for spv/target — copied from model_deal_references. |
| `baseline_id` | uuid | FK → mid_baseline.id — mid_holdco only |
| `inherit_baseline` | boolean | Default true |
| `sort_order` | integer | |

**Unique constraint:** `UNIQUE(model_id, entity_type)` — relaxed for spv/target since there can be multiple. Only unique for singleton entity types (aragon, mid_holdco, intermediate_holdco, consolidated).

**Unique constraint (singleton types only):** Enforce via check constraint or trigger that `entity_type IN ('aragon','mid_holdco','intermediate_holdco','consolidated')` has at most one row per model.

---

### 8.10 model_segments

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `entity_id` | uuid | FK → model_entities.id, ON DELETE CASCADE |
| `segment_name` | text | e.g. 'AEO', 'SEO', 'CRO', 'Web Dev' |
| `sort_order` | integer | |
| `created_at` | timestamptz | |

---

### 8.11 model_line_items

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `entity_id` | uuid | FK → model_entities.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id. NULL = all deal scenarios. |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id. NULL = all. |
| `segment_id` | uuid | FK → model_segments.id. NULL = not segment-specific. |
| `category` | text | 'revenue', 'cogs', 'expense', 'debt_service', 'earnout' |
| `statement` | text | 'pl', 'bs', 'cf' |
| `group_name` | text | |
| `item_name` | text | |
| `growth_type` | text | 'organic', 'inorganic', or null |
| `item_type` | text | 'fixed', 'growth_rate', 'driver_derived', 'manual' |
| `growth_rate` | numeric | Monthly % if growth_rate type |
| `base_amount` | numeric | Starting value — seeded from deal.reported_revenue/ebitda if pull flags set |
| `sort_order` | integer | |
| `notes` | text | |
| `is_system_generated` | boolean | |
| `created_at` | timestamptz | |

---

### 8.12 model_values

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `line_item_id` | uuid | FK → model_line_items.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id |
| `period_index` | integer | 0–119. Values only exist for periods ≥ entity.close_period_index. |
| `amount` | numeric | |
| `is_override` | boolean | |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(line_item_id, scenario_id, operating_scenario_id, period_index)`

---

### 8.13 model_debt_corkscrews

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id |
| `entity_id` | uuid | FK → model_entities.id — which SPV/holdco this instrument belongs to |
| `instrument_name` | text | |
| `instrument_type` | text | 'facility', 'seller_note', 'revolver' |
| `start_period_index` | integer | = entity.close_period_index for SPV instruments. 0 for facility. |
| `period_index` | integer | 0–119 |
| `beginning_balance` | numeric | |
| `new_borrowings` | numeric | At start_period_index only |
| `cash_interest` | numeric | |
| `pik_interest` | numeric | |
| `cash_principal` | numeric | |
| `balloon_payment` | numeric | |
| `ending_balance` | numeric | |
| `current_portion` | numeric | |
| `lt_portion` | numeric | |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(model_id, scenario_id, entity_id, instrument_name, period_index)`

---

### 8.14 model_drivers

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `entity_id` | uuid | FK → model_entities.id, ON DELETE CASCADE |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id |
| `driver_type` | text | See Section 9 |
| `value` | numeric | |
| `period_start` | integer | Relative to entity's close_period_index (0 = first active period) |
| `period_end` | integer | NULL = through end of model |
| `notes` | text | |
| `created_at` | timestamptz | |

**Unique constraint:** `UNIQUE(entity_id, operating_scenario_id, driver_type, period_start)`

---

### 8.15 model_balance_sheet_values

*(Schema unchanged from v1.3 — adds `entity_id` scoping, all values zero before close_period_index)*

---

### 8.16 model_cf_values

*(Schema unchanged from v1.3 — all values zero before entity's close_period_index)*

---

### 8.17 model_liquidity_events

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id, ON DELETE CASCADE |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id |
| `event_period_index` | integer | Default 35. Can be any period 0–119. |
| `profit_metric` | text | 'ebitda' or 'sde' override |
| `trailing_periods` | integer | Default 12 |
| `exit_multiple_low` | numeric | |
| `exit_multiple_base` | numeric | |
| `exit_multiple_high` | numeric | |
| `exit_transaction_costs_pct` | numeric | Default 0.04 |
| `notes` | text | |

---

### 8.18 coa_imports

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `entity_id` | uuid | FK → model_entities.id |
| `source_account_code` | text | |
| `source_account_name` | text | |
| `source_account_type` | text | |
| `mapped_group_name` | text | |
| `mapped_item_name` | text | |
| `mapped_segment_id` | uuid | FK → model_segments.id |
| `mapped_category` | text | |
| `historical_avg_monthly` | numeric | Used as base_amount on line item generation |
| `accrual_adjustment_notes` | text | |
| `created_at` | timestamptz | |

**Changed from v1.3:** `deal_id` replaced with `model_id` + `entity_id`. COA mapping is model-level, not deal-level.

---

## 9. Working Capital Driver Types

| driver_type | Description |
|---|---|
| `ar_days` | Days Sales Outstanding |
| `ap_days` | Days Payable Outstanding |
| `prepaid_pct` | Prepaids as % of OpEx |
| `accrued_exp_pct` | Accrued expenses as % of OpEx |
| `capex_pct_revenue` | CapEx as % of revenue |
| `tax_rate` | Effective income tax rate |
| `da_monthly` | Monthly D&A (fixed $) |
| `organic_growth_rate` | Monthly organic revenue growth rate |
| `inorganic_revenue_start` | Period index (relative to close) when inorganic revenue begins |
| `inorganic_revenue_amount` | Monthly inorganic revenue at that period |
| `cogs_pct_revenue` | COGS as % of revenue per segment |
| `min_cash_balance` | Minimum cash the entity must hold |

**Note on driver period_start:** Driver `period_start` is expressed relative to the entity's `close_period_index`. So `period_start = 0` means the first period the entity is active, regardless of when it closes in the model calendar.

---

## 10. Calculation Engine (Render — /lib/modelEngine.js)

### 10.1 Engine Input Contract

The route handler assembles a complete input object before calling the engine. The engine receives no DB connection. Input includes:

```js
{
  model: { start_date, period_count, profit_metric },
  periods: [{ index, label, startDate, endDate }],  // pre-generated
  entities: [
    {
      id, entity_type, entity_name, close_period_index,
      lineItems: [...],   // merged (baseline + overrides for mid_holdco)
      drivers: [...],
      segments: [...]
    }
  ],
  scenarios: [
    {
      id, name,
      facility: { amount, rate, term, io_months, pik, balloon_month },
      dealTerms: [
        {
          deal_reference_id, entity_id, close_period_index,
          purchase_price, tranche_amount, seller_note_amount,
          seller_note_rate, seller_note_term_months, ...
        }
      ]
    }
  ],
  operatingScenarios: [{ id, case_type, ... }]
}
```

### 10.2 Calculation Order (Strict)

```
For each combination of (scenario × operating_scenario):

  1.  Period array (0–119)
  2.  MiD baseline merge (route handler pre-processes before engine call)
  3.  For each entity, sorted by close_period_index ascending:
        a. Skip all periods < entity.close_period_index (contribute zero)
        b. Revenue projection per segment from close_period_index onward
        c. Inorganic revenue injection at specified period (relative to close)
        d. COGS from driver × segment revenue
        e. Gross profit per segment
        f. OpEx projection
        g. EBIT
        h. Debt corkscrew from close_period_index onward:
              → facility tranche drawn at close_period_index
              → seller note corkscrew from close_period_index
        i. Interest expense on P&L
        j. EBT and tax
        k. Net income
        l. Working capital derivation from drivers
        m. CapEx from driver
        n. D&A
  4.  Balance sheet roll-forward per period (all entities consolidated at holdco level)
  5.  Indirect cash flow per period
  6.  Balance check: total_assets = total_liabilities + equity every period
  7.  CF tie check: ending_cash = BS cash every period
  8.  DSCR per period at intermediate_holdco level (blended across all active SPVs)
  9.  DSCR step-up check: verify DSCR stays ≥ 1.25x at each new close_period_index
  10. SPV self-sufficiency tests
  11. Earnout accrual per deal
  12. Write all outputs to output tables
```

### 10.3 DSCR Step-Up Check

Each time a new deal closes (a new `close_period_index`), debt service increases. The engine checks DSCR at every step-up period specifically:

```
At each close_period_index n:
  DSCR[n] = Blended EBITDA from all active entities[n]
            ÷ Total debt service from all instruments[n]

If DSCR[n] < 1.25x → warning
If DSCR[n] < 1.00x → critical warning
```

This tells you whether each incremental acquisition is additive (improves or holds DSCR) or dilutive (degrades DSCR below threshold).

### 10.4 Seeding from Deal Records

When `pull_reported_revenue = true` on a deal reference and `seed_overridden = false`, the engine seeds line item `base_amount` values from the deal record:

```
Total Revenue base_amount    ← deal.reported_revenue / 12  (monthly)
EBITDA target                ← deal.reported_ebitda / 12
purchase_price               ← deal.asking_price
```

If `seed_overridden = true` (user has manually entered values), the engine uses the stored `base_amount` values on `model_line_items` and ignores the deal record. This allows placeholder deals to be updated without disrupting a model that has been manually refined.

### 10.5 Self-Sufficiency Tests

| Test | Pass Condition | On Failure |
|---|---|---|
| Sources = Uses (per deal close) | equity + tranche = purchase_price + costs + WC at each close | Block, validation error |
| Total facility not exceeded | sum(all tranches) ≤ total_facility_size | Block, validation error |
| DSCR ≥ 1.25x | All periods ≥ 1.25x | Flag in warnings |
| DSCR at each step-up ≥ 1.25x | DSCR at each close_period_index ≥ 1.25x | Flag with step-up label |
| Downside DSCR ≥ 1.00x | Downside case never below 1.00x | Critical warning |
| Balance sheet balanced | total_assets = total_liabilities + equity every period | Error |
| CF ties to BS | ending_cash = BS cash every period | Error |
| Exit covers all debt | Gross proceeds > all remaining debt at exit period | Flag as underwater |

---

## 11. Render Backend — API Contract

### 11.1 Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/models/:modelId/calculate` | Full three-statement engine run. |
| GET | `/api/models/:modelId/liquidity-event/:scenarioId/:operatingScenarioId` | Exit waterfall. |

### 11.2 Calculate Request

```json
{
  "scenarioIds": ["uuid"],
  "operatingScenarioIds": ["uuid", "uuid", "uuid"],
  "forceRecalculate": false
}
```

### 11.3 Calculate Response

```json
{
  "success": true,
  "runs": [
    {
      "scenarioId": "...",
      "operatingScenarioId": "...",
      "scenarioName": "Seller Note 30%",
      "operatingScenarioName": "Base (Management)",
      "passed": true,
      "warnings": [
        {
          "type": "dscr_stepup_warning",
          "severity": "warning",
          "periodIndex": 12,
          "entityName": "SPV-B: Target B",
          "value": 1.19,
          "threshold": 1.25,
          "message": "DSCR drops to 1.19x at period 12 when Target B closes"
        }
      ],
      "validation_errors": [],
      "summary": {
        "spv_self_sufficient": true,
        "min_dscr": 1.19,
        "min_dscr_downside": 1.04,
        "dscr_at_each_close": [
          { "periodIndex": 0, "entityName": "SPV-A: New North", "dscr": 1.82 },
          { "periodIndex": 12, "entityName": "SPV-B: Target B", "dscr": 1.19 },
          { "periodIndex": 18, "entityName": "SPV-C: Target C", "dscr": 1.31 }
        ],
        "periods_below_125": [12, 13, 14],
        "periods_below_100": [],
        "balance_sheet_balanced": true,
        "cf_ties_to_bs": true,
        "facility_utilization": 0.87
      }
    }
  ]
}
```

---

## 12. Frontend — Lovable Component Specifications

### 12.1 Models List Page (`/models`)

- Table of all models: name, description, start date, # of deals referenced, last calculated date
- 'New Model' button — opens create modal (name, description, start date, profit metric)
- Each row links to `/models/:modelId`
- MiD Baseline link at top right — opens `/models/baseline`

### 12.2 MiD Baseline Page (`/models/baseline`)

- Single page for managing the org-level MiD financial baseline
- Same SpreadsheetGrid interface as entity views
- 'Activate Baseline' button — sets `is_active = true`, deactivates prior baseline
- Baseline history list — prior baselines with effective dates

### 12.3 ModelBuilder (`/models/:modelId`)

**Top bar:**
- Model name (editable inline)
- Deal structure scenario switcher
- Operating scenario switcher (Downside / Base / Upside)
- Presentation granularity toggle (Monthly / Quarterly / Annual)
- 'Run Model' button
- 'Compare' button

**Acquisition Timeline strip** (new, below top bar):
- Visual horizontal timeline showing model start → model end (120 periods)
- Each deal reference shown as a marker at its `close_period_index`
- Marker shows deal name and purchase price
- Click marker to open deal reference detail panel
- 'Add Deal' button — opens deal picker

**Entity tabs:**
```
Marketers in Demand | [Intermediate HoldCo] | [SPV-A: New North] | [SPV-B: Target B] | ... | Consolidated
```
SPV tabs appear in order of `close_period_index`. Each tab shows the close date beneath the entity name.

**Sub-tabs per entity:** P&L | Balance Sheet | Cash Flow

**Bottom strip:** Balance check status, DSCR summary, facility utilization %

### 12.4 Deal Reference Panel

Opens when clicking a deal marker on the Acquisition Timeline or from 'Add Deal':

- Deal search/select from existing deals (all statuses including pipeline)
- Close date picker
- `close_period_index` shown calculated live as user picks date
- Pull flags: toggles for revenue, EBITDA, asking price seeding
- Seed override warning: if values have been manually overridden, shows "Manual overrides active — deal updates will not re-seed this entity"
- Link to the deal record in the Deals module

### 12.5 SpreadsheetGrid

**P&L, Balance Sheet, and Cash Flow views** — unchanged from v1.3.

**Additional behavior for staged entities:**
- Columns before `close_period_index` are grayed out with a "Pre-close" label
- The close period column has a marker indicator (e.g., a small flag icon) showing acquisition close
- Revenue in the first active period is labeled with deal name for traceability

### 12.6 DriversPanel

Unchanged from v1.3. Note that `period_start` in drivers is relative to entity close, not model start. The UI should display both the relative index and the calendar date for clarity.

### 12.7 DealStructurePanel

Updated for multi-deal model:

- **Facility Terms section** — total facility size, initial tranche, rate, term, IO, PIK, balloon
- **Per-Deal Terms section** — table of all deal references, one row per deal, columns for tranche amount, seller note, earnout terms
- **Equity at Close section** — investor equity, Aragon equity, total equity check
- Running sources = uses check per deal close, plus total facility utilization

### 12.8 LiquidityEventPanel, ScenarioComparison

Unchanged from v1.3.

---

## 13. Build Sequence

| Phase | What to Build | Validation |
|---|---|---|
| 1 — Schema | All migrations. `deal_status` enum extension. New tables: `model_deal_references`, `model_deal_scenario_terms`. All updated constraints and cascades. | Tables visible. Enum updated. |
| 2 — MiD Baseline | `/models/baseline` page. Populate with current MiD financials. | Baseline rows queryable. |
| 3 — Models List | `/models` list page. Create model flow (name, start date, profit metric). | Model creates with all entities auto-generated. |
| 4 — Deal Reference Flow | Deal picker. Close date entry. `close_period_index` calculation. Seed flags. | Add three deals with different close dates. Verify period indices calculated correctly. |
| 5 — Engine: P&L with staged entities | Per-entity activation at close_period_index. Revenue by segment from close onward. Organic/inorganic labeling. | Entity contributing zero before close period. First active period seeded from deal record. |
| 6 — Engine: Debt Corkscrew | Facility at holdco level (starts period 0). Per-deal seller notes starting at close_period_index. | Facility corkscrew starts period 0. Seller note corkscrew starts at deal close. |
| 7 — Engine: Working Capital + Three-Statement Tie | BS roll-forward, indirect CF, balance and tie checks. | BS balances every period including step-up periods. |
| 8 — Engine: DSCR Step-Up Check | Check DSCR at every close_period_index. Return in response summary. | Warning fires correctly when DSCR drops below threshold at a step-up. |
| 9 — Calculate Route | Wire engine. Write all output tables. | Full Postman run: 3 deals, 2 close dates, 3 operating scenarios. All outputs correct. |
| 10 — Liquidity Event | Exit calculator across all scenario combinations. | Known inputs produce expected IRR/MOIC. |
| 11 — Acquisition Timeline UI | Visual timeline strip in ModelBuilder. Deal markers. Deal reference panel. | Three deals shown at correct period indices on timeline. |
| 12 — Entity Tabs | Tabs generated dynamically from model_entities. Close date beneath tab name. Pre-close columns grayed. | Tabs appear in close_period_index order. |
| 13 — P&L Grid | Full row structure with pre-close columns grayed. | Pre-close periods show no values. Active periods show seeded data. |
| 14 — BS + CF Grid | Balance sheet and CF views. | Red flag on any period where statements don't tie. |
| 15 — Deal Structure Panel | Multi-deal facility terms + per-deal terms table. | Sources = uses per deal. Facility utilization shown. |
| 16 — Drivers, COA Import | From v1.3 — unchanged. | |
| 17 — Scenario Comparison | Grid across both scenario dimensions. | |

---

## 14. Implementation Notes

### For Render Backend Developer

- `close_period_index` is pre-computed and stored on `model_deal_references` and `model_entities`. The engine never computes it — it reads it from the input object assembled by the route handler.
- Entity calculation order must follow `close_period_index` ascending. An entity that closes at period 12 must not be calculated before an entity that closes at period 0, because the balance sheet roll-forward is cumulative.
- Facility debt (at intermediate holdco) starts at period 0 regardless of individual deal close dates. The facility is established at model start; tranches are drawn at each deal close.
- Seeding logic: route handler checks `seed_overridden` on each deal reference. If false, it overwrites `base_amount` on affected line items with current deal record values before passing to engine. If true, stored `base_amount` values are used as-is.
- DSCR step-up check is a separate pass after the main calculation loop. It reads the DSCR values already computed and checks them specifically at each `close_period_index`.
- Balance check and CF tie are hard errors. A model with broken statements cannot be presented to a lender.
- All output tables upserted on each run — idempotent.

### For Lovable Frontend Developer

- The Models module is entirely new and sits at the top level of the app alongside Deals, NDAs, Team, Settings. Add 'Models' to the sidebar nav.
- The Acquisition Timeline strip is the key new UI element. It should be a simple horizontal bar with labeled markers — not a complex Gantt chart. Each marker is clickable and opens the Deal Reference Panel.
- Entity tabs are generated dynamically from `model_entities` ordered by `close_period_index`. Do not hardcode tab order or count.
- Pre-close columns (period_index < entity.close_period_index) should render as grayed-out cells with no values. Use a distinct visual treatment so users understand these periods are inactive, not empty.
- The close date picker in the Deal Reference Panel should show both the calendar date and the calculated period index (e.g., "April 2026 — Period 15") so users can reason about timing.
- `seed_overridden` should be surfaced clearly in the Deal Reference Panel — if true, a warning chip: "Manual overrides active. Changes to this deal will not update the model."
- All CRUD direct Supabase. Only call Render for `/calculate` and `/liquidity-event`.
- URL: `?model=modelId&dealScenario=scenarioId&opScenario=operatingScenarioId`

---

## 15. Profit Metric Reference: EBITDA vs. SDE

| Metric | Definition | When to Use |
|---|---|---|
| EBITDA | Revenue − COGS − OpEx (market-rate management salary included) | Platform exits to PE or strategic. Deals $2M+. |
| SDE | EBITDA + owner salary + owner perks + non-recurring adjustments | Owner-operated targets, sub-$2M. Common at acquisition entry. |

**At exit:** Always default to EBITDA. PE/strategic buyers underwrite on EBITDA.

**The return arbitrage:** Buying individual targets on SDE multiples, selling the consolidated platform on EBITDA multiple, is a core return driver surfaced in the liquidity event output.

---

## 16. Lender Package Checklist

- [ ] Executive summary and investment thesis
- [ ] Org chart: entity structure and collateral perimeter
- [ ] Background on principals and track record
- [ ] Buy box definition
- [ ] Acquisition timeline showing close dates and tranche draws
- [ ] Target company overview per deal reference
- [ ] Historical financials (3 years, accrual basis) per target
- [ ] Chart of accounts mapping (cash-to-accrual conversion documented)
- [ ] Three-statement projection model — all operating scenarios × base deal structure
- [ ] Facility debt schedule and corkscrew
- [ ] Per-deal seller note corkscrews
- [ ] DSCR analysis — step-up DSCR at each acquisition close shown explicitly
- [ ] Downside case: DSCR ≥ 1.00x at all periods including step-ups
- [ ] Sources & uses per acquisition close
- [ ] Capitalization table
- [ ] Exit / liquidity event analysis — proceeds waterfall per party
- [ ] Earnout / equity rollover instrument summary

---

## 17. Point-in-Time Snapshot System

### 17.1 Concept

A snapshot is a frozen, named record of the model's state at a specific period index. It captures the sources & uses exhibit, DSCR, debt schedule balances, and balance sheet at that moment — independent of any future changes to the model.

Two modes:

| Mode | Description | Use Case |
|---|---|---|
| **Live Preview** | Calculated on demand, not saved. Always reflects current model state. | Working view while building the model |
| **Saved Snapshot** | Written to `model_snapshots` table with a name and timestamp. Immutable once saved. | Lender package artifacts, investor exhibits, version history |

The distinction matters: once you've sent a lender a sources & uses exhibit, a model update should not silently change it. Saved snapshots are the versioned artifacts that go into external packages.

### 17.2 Snapshot Triggers on the Acquisition Timeline

The Acquisition Timeline strip (Section 12.3) has two snapshot entry points:

**1. Deal close markers** — each deal marker on the timeline has a small camera/snapshot icon. Clicking it opens the Snapshot Modal pre-loaded for that close period. This is the most common trigger — "show me the sources & uses at the Agency B close."

**2. Free-form period picker** — a subtle "+" or scrubber handle on the timeline lets you select any period, not just close dates. Useful for mid-hold snapshots: "what does the balance sheet look like at month 24?"

Both entry points open the same Snapshot Modal.

### 17.3 Snapshot Modal

The modal has two sections:

**Top section — Snapshot Controls:**
- Period shown: calendar date + period index (e.g., "January 2027 — Period 12")
- Scenario selectors: deal structure scenario + operating scenario
- Name field (pre-filled with e.g., "Agency B Close — Jan 2027")
- 'Save Snapshot' button
- 'Export PDF' button (saves first if unsaved)

**Bottom section — Snapshot Exhibits (tabs):**

*Sources & Uses tab:*
```
SOURCES & USES — Agency B Close (Period 12)
Scenario: Senior Debt + Seller Notes × Base (Management)
─────────────────────────────────────────────────────────
USES
  Purchase Price                    $3,500,000
  Transaction Costs (3%)              $105,000
  Working Capital Reserve             $100,000
  ───────────────────────────────────────────
  Total Uses                        $3,705,000

SOURCES
  Senior Facility Tranche           $2,800,000    75.6% of uses
  Seller Note (10% of price)          $350,000     9.4%
  Target Cash at Close                $200,000     5.4%
  Investor Equity                     $355,000     9.6%
  ───────────────────────────────────────────
  Total Sources                     $3,705,000
  Gap                                       $0    ✓ Balanced

CUMULATIVE FACILITY UTILIZATION
  Prior draws (Period 0)            $3,500,000
  This draw (Period 12)             $2,800,000
  ───────────────────────────────────────────
  Total drawn                       $6,300,000
  Facility size                     $8,500,000
  Remaining headroom                $2,200,000    25.9% available
```

*DSCR tab:*
```
DSCR AT CLOSE — Period 12
  Portfolio EBITDA (monthly)          $208,333    ($2.5M/yr — Agencies A+B combined)
  Total Debt Service (monthly)        $148,500    (facility P+I at this draw level)
  ───────────────────────────────────────────
  DSCR                                    1.40x   ✓ Above 1.25x threshold

  Downside DSCR (flat scenario)           1.11x   ✓ Above 1.00x floor
```

*Debt State tab:*
```
DEBT BALANCES AT PERIOD 12
  Facility — beginning balance      $3,500,000    (after 12 months of P payments)
  This tranche drawn                $2,800,000
  Facility — ending balance         $6,188,500    (after tranche + amortization)

  Seller Note — Agency A               $487,200    (after 12 months IO, principal intact)
  Seller Note — Agency B               $350,000    (new, IO starts now)
  ───────────────────────────────────────────
  Total Debt                        $7,025,700
```

*Balance Sheet tab:*
```
BALANCE SHEET SNAPSHOT — Period 12
  Cash                                $425,000
  Accounts Receivable                 $312,500
  Goodwill (net)                    $8,650,000    (both acquisitions combined)
  Total Assets                      $9,612,500
  ───────────────────────────────────────────
  Accounts Payable                     $87,500
  Current Portion LTD                 $720,000
  Long-Term Debt                    $6,305,700
  Total Liabilities                  $7,113,200
  ───────────────────────────────────────────
  Contributed Capital               $1,587,500
  Retained Earnings                   $911,800
  Total Equity                      $2,499,300
  ───────────────────────────────────────────
  Total Liabilities + Equity        $9,612,500    ✓ Balanced
```

### 17.4 Schema: model_snapshots

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK |
| `model_id` | uuid | No | FK → financial_models.id, ON DELETE CASCADE |
| `scenario_id` | uuid | No | FK → model_scenarios.id |
| `operating_scenario_id` | uuid | No | FK → model_operating_scenarios.id |
| `period_index` | integer | No | The period this snapshot captures |
| `snapshot_type` | text | No | 'close' (at a deal close) or 'freeform' (any period) |
| `deal_reference_id` | uuid | Yes | FK → model_deal_references.id — set if snapshot_type = 'close' |
| `name` | text | No | User-provided name, e.g. 'Agency B Close — Jan 2027' |
| `notes` | text | Yes | Optional narrative for the lender package |
| `sources_uses` | jsonb | No | Frozen sources & uses data at save time |
| `dscr_data` | jsonb | No | Frozen DSCR values at save time |
| `debt_state` | jsonb | No | Frozen debt balances at save time |
| `balance_sheet` | jsonb | No | Frozen balance sheet at save time |
| `model_version_hash` | text | No | Hash of model inputs at save time — shows if model has changed since snapshot |
| `created_by` | uuid | Yes | FK → profiles.id |
| `created_at` | timestamptz | No | now() |

**Why JSONB for the exhibit data:** The snapshot is a point-in-time freeze. Storing it as JSONB means it never changes even if the underlying model is recalculated. The `model_version_hash` lets the UI show a staleness indicator if the model has since been updated.

### 17.5 Render Endpoint

Add one endpoint to generate snapshot data on demand (used for both live preview and save):

```
POST /api/models/:modelId/snapshot
```

**Request body:**
```json
{
  "periodIndex": 12,
  "scenarioId": "uuid",
  "operatingScenarioId": "uuid",
  "dealReferenceId": "uuid"   // optional — enriches the S&U with this deal's terms
}
```

**Response:**
```json
{
  "periodIndex": 12,
  "calendarDate": "2027-01-01",
  "label": "Agency B Close — Period 12",
  "sourcesUses": {
    "uses": { "purchasePrice": 3500000, "transactionCosts": 105000, "wcReserve": 100000, "total": 3705000 },
    "sources": { "facilityTranche": 2800000, "sellerNote": 350000, "targetCash": 200000, "investorEquity": 355000, "total": 3705000 },
    "gap": 0,
    "balanced": true,
    "cumulativeFacilityDrawn": 6300000,
    "facilitySize": 8500000,
    "facilityHeadroom": 2200000
  },
  "dscr": {
    "portfolioEbitdaMonthly": 208333,
    "debtServiceMonthly": 148500,
    "dscr": 1.40,
    "dscrDownside": 1.11,
    "aboveThreshold": true,
    "aboveFloor": true
  },
  "debtState": { ... },
  "balanceSheet": { ... }
}
```

The route handler reads from already-computed output tables (`model_balance_sheet_values`, `model_debt_corkscrews`) for the specified period. If the model hasn't been calculated yet, it returns a 409 with `{ error: "model_not_calculated" }` and the UI prompts the user to run the model first.

### 17.6 Snapshot List

Saved snapshots are accessible from two places:

**1. On the Acquisition Timeline** — saved snapshots for close periods appear as a second marker layer below the deal markers (e.g., a small bookmark icon). Clicking opens the Snapshot Modal in read-only mode showing the saved data.

**2. In a Snapshots panel** — a collapsible list accessible from the ModelBuilder top bar showing all saved snapshots for the model, sorted by period index. Columns: name, period, scenario, created date, staleness indicator (if model has changed since save). Actions: view, rename, delete, export PDF.

### 17.7 Staleness Indicator

When a saved snapshot is viewed, the UI computes a current `model_version_hash` and compares it to the one stored at save time. If they differ, a banner appears:

```
⚠ Model updated since snapshot saved (March 6, 2026).
  This exhibit may no longer reflect current model assumptions.
  [ Refresh Snapshot ]  [ Keep As-Is ]
```

"Refresh Snapshot" re-runs the snapshot endpoint and overwrites the stored JSONB data. "Keep As-Is" dismisses and leaves the frozen artifact intact.

---

## 18. Build Sequence (Updated)

| Phase | What to Build | Validation |
|---|---|---|
| 1 — Schema | All migrations including `model_snapshots`. | Tables visible. |
| 2–10 | Unchanged from v1.4 | |
| 11 — Snapshot Endpoint | `POST /api/models/:modelId/snapshot`. Reads from output tables. Returns full exhibit JSON. | Postman: request snapshot at period 0 and period 12. Correct S&U, DSCR, debt state returned. 409 if model not yet calculated. |
| 12 — Acquisition Timeline UI | Timeline with deal markers + snapshot trigger icons. Free-form period picker. | Click deal marker → Snapshot Modal opens pre-loaded for that close period. |
| 13 — Snapshot Modal | Four exhibit tabs. Live preview on open. Save button writes to `model_snapshots`. | Save → row in table. Reopen → reads frozen JSONB not live calculation. |
| 14 — Staleness Indicator | Hash comparison on modal open. Banner if stale. Refresh + keep-as-is actions. | Change a model input → open saved snapshot → staleness banner appears. |
| 15 — Snapshots Panel | Collapsible list in ModelBuilder. View, rename, delete, export. | All saved snapshots visible. Delete removes row. |
| 16–17 | Remaining phases from v1.4 build sequence | |

---

## 19. Lender Package Checklist (Updated)

- [ ] Executive summary and investment thesis
- [ ] Org chart: entity structure and collateral perimeter
- [ ] Background on principals and track record
- [ ] Buy box definition
- [ ] Acquisition timeline showing close dates and tranche draws
- [ ] **Sources & uses snapshot per acquisition close** ← generated from snapshot system
- [ ] Target company overview per deal reference
- [ ] Historical financials (3 years, accrual basis) per target
- [ ] Chart of accounts mapping (cash-to-accrual conversion documented)
- [ ] Three-statement projection model — all operating scenarios × base deal structure
- [ ] Facility debt schedule and corkscrew
- [ ] Per-deal seller note corkscrews
- [ ] DSCR analysis — step-up DSCR at each acquisition close shown explicitly
- [ ] **DSCR snapshot at each close period** ← from snapshot system
- [ ] Downside case: DSCR ≥ 1.00x at all periods including step-ups
- [ ] Capitalization table
- [ ] Exit / liquidity event analysis — proceeds waterfall per party
- [ ] Earnout / equity rollover instrument summary

---

*Deal Room by Aragon Holdings | M&A Financial Modeling Module | v1.5*

---

## 18. Revenue Type and Platform Revenue Model

### 18.1 The Two-Cohort Revenue Structure

The platform has two types of entities with fundamentally different revenue relationships:

**Cohort 1 — Vertical Full-Service Agencies**
Own the client relationship. Bill the client directly. Pay referral fees to service line agencies for specialist delivery. Earn their margin on strategy, account management, and relationship ownership.

**Cohort 2 — Horizontal Service Line Engines**
Deliver specialist services (AEO/SEO, paid media). Receive client revenue directly from external clients plus referral income from vertical agencies for shared clients. Earn their margin on delivery.

Each entity owns its economics completely. No netting. No intercompany flags. The referral fee is a real operating expense on the vertical agency's P&L and real revenue on the service line agency's P&L.

### 18.2 revenue_type Field on model_line_items

Add `revenue_type` to `model_line_items`:

| value | Description |
|---|---|
| `'client'` | Direct billing to an external client |
| `'referral'` | Income received from another platform entity for a referred client |
| `'management'` | Management fee received from holdco |
| `null` | Non-revenue line items (expenses, debt service, earnout) |

This field is only populated on `category = 'revenue'` lines.

### 18.3 How Referral Economics Work

```
MANUFACTURING AGENCY — client paying $25,000/mo
  Client Revenue (revenue_type: 'client'):     $25,000/mo
  Referral Fee Paid to SEO (expense):          −$7,000/mo
  Net retained:                                $18,000/mo
  Less delivery costs and OpEx:                −$6,000/mo
  ────────────────────────────────────────────────────────
  Manufacturing Agency EBITDA contribution:    $12,000/mo

AEO/SEO AGENCY — same client
  Referral Income (revenue_type: 'referral'):   $7,000/mo
  Less SEO delivery costs:                     −$2,800/mo
  Less allocated OpEx:                         −$1,200/mo
  ────────────────────────────────────────────────────────
  SEO Agency EBITDA contribution:               $3,000/mo

PLATFORM CONSOLIDATED — same client
  External client revenue:                     $25,000/mo  ← client lines only
  Total delivery + OpEx:                       −$10,000/mo
  ────────────────────────────────────────────────────────
  Platform EBITDA from this client:            $15,000/mo
  
  Manufacturing share:    $12,000   80%
  SEO share:               $3,000   20%
```

The referral fee expense ($7,000) and referral income ($7,000) cancel naturally in the consolidated sum without any special handling. The consolidated top line shows only external client revenue — what a lender or buyer would recognize as real platform revenue.

### 18.4 Engine Consolidation Rule

In the consolidated entity calculation:

```
Consolidated Revenue  = sum of all revenue lines WHERE revenue_type = 'client'
                        (referral and management lines excluded from top line)

Consolidated EBITDA   = sum of all entity EBITDAs
                        (referral income and expense wash out naturally)

Lender-reported Revenue = Consolidated Revenue (client lines only)
Lender-reported EBITDA  = Consolidated EBITDA
```

This means the consolidated P&L presented to a lender shows clean external revenue only — no inflation from intercompany flows — while EBITDA is accurate because the referral expense and income net to zero across entities.

### 18.5 EBITDA Contribution for Exit Allocation

At the liquidity event, gross EV is allocated across SPVs by EBITDA contribution. The referral economics are preserved at the entity level:

```
Platform TTM EBITDA:        $5,500,000
Exit multiple (base 7x):    ×7
Gross EV:                   $38,500,000

EBITDA Contribution:
  Manufacturing Agency:     $1,200,000   21.8%  → allocated EV: $8,393,000
  Second Vertical:          $1,000,000   18.2%  → allocated EV: $7,000,000
  AEO/SEO Agency:           $1,800,000   32.7%  → allocated EV: $12,593,000
  Paid Media Agency:        $1,100,000   20.0%  → allocated EV: $7,700,000
  MiD (consolidated only):    $400,000    7.3%  → allocated EV: $2,814,000
                            ──────────
  Total:                    $5,500,000  100%   → $38,500,000
```

The SEO agency's EBITDA includes its referral income — correctly so, because it earned that margin by delivering results. The manufacturing agency's EBITDA reflects its kept margin after paying the referral fee — also correctly, because it earned that by owning the client relationship. Both contributions are real.

---

## 19. Per-SPV Equity Cap Tables

### 19.1 Concept

Every SPV has its own equity table. Cap tables are negotiated deal by deal. The same party can have different ownership percentages, different hurdles, and different carry arrangements across different SPVs.

The platform may look like this:

```
SPV-A (Manufacturing Agency):
  Tristan Pelligrino:    60%  base  +  20% carry above 8% hurdle
  Business Partner:      40%  base

SPV-B (Second Vertical):
  Tristan Pelligrino:    75%  base  +  20% carry above 8% hurdle
  Outside Investor A:    25%  base  (LP, passive)

SPV-C (AEO/SEO Agency):
  Tristan Pelligrino:    65%  base  +  20% carry above 8% hurdle
  Business Partner:      20%  base
  Outside Investor B:    15%  base

SPV-D (Paid Media Agency):
  Tristan Pelligrino:    80%  base  +  20% carry above 8% hurdle
  Outside Investor A:    20%  base
```

### 19.2 Schema: model_spv_equity

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid | No | PK |
| `entity_id` | uuid | No | FK → model_entities.id, ON DELETE CASCADE |
| `scenario_id` | uuid | No | FK → model_scenarios.id — equity terms can vary by deal structure scenario |
| `party_name` | text | No | e.g. 'Tristan Pelligrino', 'Business Partner', 'Investor A' |
| `party_type` | text | No | 'sponsor', 'partner', 'lp', 'seller_rollover' |
| `base_equity_pct` | numeric | No | Base ownership %, decimal (e.g. 0.60) |
| `carry_pct` | numeric | No | Promoted interest %. 0 if not a sponsor. (e.g. 0.20) |
| `hurdle_rate_annual` | numeric | No | Annual preferred return before carry activates (e.g. 0.08). 0 if no hurdle. |
| `contributed_capital` | numeric | No | Cash in at close — drives IRR calculation |
| `contribution_period_index` | integer | No | Period when capital was contributed. Usually = entity close_period_index. |
| `commitment_status` | text | No | 'soft_circle', 'committed', 'funded' |
| `notes` | text | Yes | e.g. 'Seller rollover — 24mo lockup' |
| `created_at` | timestamptz | No | now() |

### 19.3 Carry / Promote Structure

The promoted interest is a standard GP carry structure. For each SPV at exit:

```
STEP 1 — Return of contributed capital
  Each party receives their contributed_capital back
  Pro rata at base_equity_pct if insufficient proceeds

STEP 2 — Preferred return to all equity holders
  Each party receives annual hurdle_rate on contributed_capital
  Calculated from contribution_period_index to exit_period_index
  Example: $739,500 × 8% × 3 years = $177,480

STEP 3 — Sponsor catch-up
  Sponsor (Tristan) receives distributions until his effective return
  equals base return + carry_pct of total profit above hurdle
  This "catches up" the sponsor to their promote percentage

STEP 4 — Remaining proceeds
  Split at base_equity_pct among all parties
```

**Carry only activates above the hurdle.** If a deal exits below the hurdle rate, carry is zero. Base equity holders receive everything pro rata.

### 19.4 XIRR Calculation Per Party Per SPV

IRR is calculated using the XIRR method — cash flows weighted by actual calendar dates, not just period counts. This is the correct method because contributions and distributions happen at specific dates with variable timing.

Cash flow inputs per party:

```
Cash flows (negative = out, positive = in):
  − contributed_capital     at contribution_period_index date
  − any subsequent calls    at their respective dates
  + distributions received  at exit_period_index date
  + recap dividends         at recap_period_index date (if applicable)
```

XIRR solved iteratively to find the rate where NPV of cash flows = 0.

MOIC = total distributions received ÷ total capital contributed.

**Engine implementation:** Use Newton-Raphson iteration capped at 100 iterations. If no solution converges (edge cases with unusual cash flow patterns), return null and flag in warnings.

### 19.5 Investor Tracking Panel

In the Deal Reference Panel, a new "Cap Table" tab shows all equity parties for that SPV:

```
PARTY           TYPE      BASE %  CARRY %  HURDLE  COMMITTED   STATUS
─────────────────────────────────────────────────────────────────────
Tristan P.      sponsor   60%     20%      8%      $739,500    funded
Business P.     partner   40%     —        —       $492,500    funded
```

'Add Party' button opens a form. Status dropdown: soft circle → committed → funded. The total base equity must sum to 100% — the UI validates this before saving.

---

## 20. Exit Events

### 20.1 Multiple Exit Events Per Model

The spec previously allowed one liquidity event per scenario combination. This is insufficient — you need to model multiple potential exit moments in the same model.

`model_liquidity_events` is now one-to-many per model. Examples in a single model:

```
Event 1: Month 36 Recapitalization    — partial liquidity, stay in
Event 2: Month 60 Full Exit           — sell the platform
Event 3: Month 36 Full Exit           — alternative, compare to recap
```

This allows side-by-side comparison: "if we exit at month 36 vs. month 60, what does each party make?"

### 20.2 Exit Type Field

Add `exit_type` to `model_liquidity_events`:

| value | Description |
|---|---|
| `'full_exit'` | Sale of the platform. All debt repaid. Equity distributed per waterfall. |
| `'recapitalization'` | Refinance at higher leverage. Dividend to equity. Platform continues. |
| `'partial_sale'` | Sale of one or more SPVs, platform continues. |

### 20.3 Updated model_liquidity_events Schema

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id |
| `exit_type` | text | 'full_exit', 'recapitalization', 'partial_sale' |
| `event_name` | text | e.g. 'Month 36 Recap', 'Month 60 Full Exit' |
| `event_period_index` | integer | Period of exit event |
| `profit_metric` | text | 'ebitda' or 'sde' override for this event |
| `trailing_periods` | integer | Default 12 (TTM) |
| `exit_multiple_low` | numeric | Bear case |
| `exit_multiple_base` | numeric | Base case |
| `exit_multiple_high` | numeric | Bull case |
| `exit_transaction_costs_pct` | numeric | Default 0.04 for full exit, 0.02 for recap |
| `recap_leverage_multiple` | numeric | For recaps: lender will lend X× EBITDA at refinance |
| `recap_refi_costs_pct` | numeric | For recaps: refinancing costs % of new facility |
| `recap_new_facility_term_months` | integer | Term of new facility post-recap |
| `ebitda_allocation_method` | text | 'ebitda_contribution' or 'acquisition_cost' |
| `notes` | text | |

### 20.4 Full Exit Waterfall

```
PLATFORM LEVEL
  Gross Enterprise Value        = Platform TTM EBITDA × exit_multiple
  − Transaction costs           = GEV × exit_transaction_costs_pct
  = Net Proceeds

  Debt repayment (senior, in order):
    − Facility remaining balance
    − Seller notes remaining (all SPVs)
  = Gross Equity Pool

  Earnout settlement:
    − Earnout liabilities (equity instrument type)
  = Net Equity Pool

PER-SPV ALLOCATION
  Each SPV allocated share      = Net Equity Pool × (SPV EBITDA ÷ Platform EBITDA)
  [or acquisition cost method]

PER-SPV WATERFALL (run independently for each SPV)
  Step 1: Return of contributed capital  (pro rata at base %)
  Step 2: Preferred return               (hurdle × capital × years held)
  Step 3: Sponsor catch-up               (carry_pct on profit above hurdle)
  Step 4: Remaining proceeds             (base_equity_pct split)

ROLL-UP PER PARTY
  Sum each party's proceeds across all SPVs they participate in
  Calculate XIRR per party using contribution dates and exit date
  Calculate MOIC per party
```

### 20.5 Recapitalization Waterfall

```
PLATFORM LEVEL
  Platform TTM EBITDA           = trailing EBITDA at recap_period_index
  New facility size             = EBITDA × recap_leverage_multiple
  Current debt outstanding      = sum of all remaining debt balances
  − Refi costs                  = new facility × recap_refi_costs_pct
  = Net Recap Dividend          = new facility − current debt − refi costs

  If Net Recap Dividend ≤ 0:    return warning — recap not accretive at this period

PER-SPV ALLOCATION
  Same EBITDA contribution method as full exit

PER-PARTY DISTRIBUTION
  Run same waterfall steps 1-4 on each SPV's allocated dividend
  But: equity is NOT transferred. Parties retain their ownership %
       for the eventual full exit.

POST-RECAP MODEL
  New facility balance replaces old facility balance from recap_period_index onward
  New facility terms applied to corkscrew from recap_period_index onward
  Equity pool resets to zero (dividend distributed)
  IRR calculation includes recap dividend as a partial cash-in at that date
       plus the eventual full exit proceeds
```

### 20.6 Partial Sale

One SPV sold independently while the platform continues:

```
  SPV sale price                = SPV EBITDA × exit_multiple
  − SPV transaction costs
  − SPV remaining debt (seller note, earnout)
  = SPV equity proceeds
  
  Run SPV waterfall independently
  Remove SPV from platform model from sale_period_index onward
  Platform EBITDA reduced by sold SPV's contribution
  Remaining facility balance unchanged (lender consent required in practice)
```

### 20.7 Exit Event Comparison View

In the LiquidityEventPanel, when multiple exit events exist for the same scenario combination, show a comparison table:

```
                        MONTH 36 RECAP    MONTH 60 EXIT    MONTH 36 EXIT
──────────────────────────────────────────────────────────────────────────
Platform EBITDA         $5.5M             $7.2M            $5.5M
Exit / Recap Multiple   5.0× refi         7.0× sale        6.5× sale
Gross EV / New Debt     $27.5M            $50.4M           $35.75M
Net Dividend / Proceeds $14.2M            $38.1M           $21.3M

Tristan — Total $       $9.1M partial     $24.8M           $13.9M
Tristan — MOIC          1.9× (partial)    5.2×             2.9×
Tristan — IRR           —                 38%              52%

Partner — Total $       $4.6M partial     $11.2M           $6.2M
Investor A — Total $    $2.8M partial     $7.4M            $4.1M
```

The recap shows partial liquidity — Tristan gets $9.1M out at month 36 but still owns his equity for the month 60 exit. The IRR on the recap is left blank because it's not a terminal event — it's captured in the combined cash flow sequence ending at the full exit.

---

## 21. Deal Maker Compensation

### 21.1 Concept

The deal maker salary is paid by the intermediate holdco as a legitimate operating expense. It is compensation for sourcing deals, managing lender relationships, overseeing portfolio companies, and running the M&A process. It is separate from and in addition to any MiD salary.

It does not reduce equity. It does not affect carry calculations. It is an operating expense that reduces holdco EBITDA and therefore flows through to DSCR — which is why it must be sized appropriately.

### 21.2 Step-Up Structure

Compensation steps up as the portfolio grows and the job gets bigger:

```
Periods 0–11    (1 acquisition operating):      $175,000/yr   $14,583/mo
Periods 12–17   (2 acquisitions operating):     $225,000/yr   $18,750/mo
Periods 18–35   (full portfolio operating):     $275,000/yr   $22,917/mo
Periods 36+     (post-recap / growth phase):    $325,000/yr   $27,083/mo
```

This is defensible to both lenders ("below market rate for a GP managing a $10M+ platform") and investors ("he's taking below-market cash comp while building equity value").

### 21.3 Schema: model_holdco_compensation

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `entity_id` | uuid | FK → model_entities.id — must be intermediate_holdco entity |
| `party_name` | text | 'Tristan Pelligrino' |
| `compensation_type` | text | 'deal_maker_salary', 'management_fee', 'board_fee' |
| `amount_annual` | numeric | Annual compensation amount |
| `period_start` | integer | Period from which this tier applies |
| `period_end` | integer | NULL = through end of model |
| `notes` | text | |
| `created_at` | timestamptz | |

**Multiple rows per model** to handle step-up tiers. Engine reads all rows, applies correct tier per period.

### 21.4 Engine Treatment

Deal maker compensation is treated as an operating expense on the intermediate holdco entity:

- Appears on holdco P&L as `category: 'expense'`, `group_name: 'Deal Maker Compensation'`
- Reduces holdco EBITDA
- Reduces holdco cash flow
- Included in DSCR denominator consideration (reduces numerator EBITDA)
- **Not** included in SPV EBITDA contribution calculations for exit allocation
- **Not** included in carry/waterfall calculations

The engine auto-generates the holdco expense line from `model_holdco_compensation` rows — same pattern as system-generated debt service lines. User cannot override these lines directly; they change the compensation record instead.

### 21.5 DSCR Sensitivity to Compensation

At $275K/yr deal maker salary against $5M portfolio EBITDA, the DSCR impact is:

```
Portfolio EBITDA:           $5,000,000
Deal maker salary:           −$275,000
Holdco opex (legal, acctg):  −$180,000
Adjusted EBITDA for DSCR:   $4,545,000

DSCR at $7.8M facility:
  Without compensation:    1.71x
  With compensation:       1.56x   ← still well above 1.25x threshold
```

Immaterial to DSCR at platform scale. Worth monitoring at single-agency stage.

---

## 22. Covenant Tracking Module

### 22.1 Concept

Lenders require quarterly covenant certificates proving the borrower is operating within agreed parameters. Breaches trigger either a waiver request (expensive and relationship-damaging) or an event of default (catastrophic). The model should generate covenant compliance data automatically so there are no surprises.

### 22.2 Schema: model_covenants

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `model_id` | uuid | FK → financial_models.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id |
| `covenant_name` | text | e.g. 'Minimum DSCR', 'Maximum Leverage', 'Minimum Cash' |
| `covenant_type` | text | 'dscr_min', 'leverage_max', 'cash_min', 'fixed_charge_min', 'custom' |
| `threshold_value` | numeric | The covenant level (e.g. 1.25 for DSCR) |
| `measurement_frequency` | text | 'monthly', 'quarterly', 'annual' |
| `measurement_basis` | text | 'trailing_12', 'trailing_3', 'point_in_time' |
| `cure_period_days` | integer | Days to cure before technical default (typically 30) |
| `notes` | text | Exact language from credit agreement |
| `created_at` | timestamptz | |

### 22.3 Schema: model_covenant_results

Written by engine on each calculate run.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `covenant_id` | uuid | FK → model_covenants.id, ON DELETE CASCADE |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id |
| `period_index` | integer | |
| `measured_value` | numeric | What the model calculates for this covenant at this period |
| `threshold_value` | numeric | The covenant level (copied from covenant at calculate time) |
| `is_compliant` | boolean | True if measured_value passes threshold |
| `headroom` | numeric | measured_value − threshold_value (negative = breach) |
| `created_at` | timestamptz | |

### 22.4 Standard Covenant Set

When a model is created, auto-generate these standard covenants (user can edit thresholds):

| Covenant | Type | Default Threshold | Basis |
|---|---|---|---|
| Minimum DSCR | `dscr_min` | 1.25× | Trailing 12 months |
| Minimum DSCR (downside) | `dscr_min` | 1.00× | Trailing 12, downside scenario only |
| Maximum Total Leverage | `leverage_max` | 5.0× EBITDA | Point in time |
| Minimum Cash | `cash_min` | $250,000 | Point in time |
| Fixed Charge Coverage | `fixed_charge_min` | 1.10× | Trailing 12 |

### 22.5 Covenant Dashboard

New panel in ModelBuilder (accessible from top bar): **Covenants**

Displays a period-by-period compliance grid:

```
COVENANT COMPLIANCE — Base (Management) Scenario
                    Threshold   P0    P3    P6    P9    P12   P15
─────────────────────────────────────────────────────────────────
Min DSCR (1.25×)    ≥1.25      1.82  1.79  1.76  1.73  1.65  1.68
Max Leverage (5×)   ≤5.0×      4.2×  4.1×  4.0×  3.8×  4.3×  4.1×
Min Cash ($250K)    ≥$250K     $412K $387K $398K $421K $318K $344K
Fixed Charge (1.1×) ≥1.10      1.54  1.52  1.49  1.47  1.40  1.42
─────────────────────────────────────────────────────────────────
STATUS              —          ✓     ✓     ✓     ✓     ✓     ✓
```

Green = compliant. Amber = within 10% of threshold (warning zone). Red = breach.

Downside scenario covenant view shows separately — this is the stress test the lender actually cares about.

**Covenant Certificate button:** Generates a formatted PDF exhibit showing covenant compliance for a specified quarter. Feeds directly into the lender package. Uses the snapshot system — creates a `model_snapshots` record with `snapshot_type: 'covenant_certificate'`.

---

## 23. Platform EBITDA Definition for Lender Reporting

### 23.1 Two EBITDA Numbers

The model produces two distinct EBITDA figures at the consolidated level:

**Consolidated EBITDA (internal)**
Sum of all entity EBITDAs including referral income and management fees. Used for internal management, EBITDA contribution calculations, and exit allocation. Referral fees wash out naturally (expense on one entity, income on the other — net zero at platform level).

**Platform EBITDA (lender-reported)**
Consolidated EBITDA adjusted for:
- Intercompany referral flows already net to zero — no adjustment needed
- Deal maker compensation added back if structured as a personal holdco expense rather than an operating expense (ask your accountant — some lenders accept this addback)
- One-time transaction costs added back
- Normalized owner compensation (QoE adjustment)

In practice for this model, Platform EBITDA ≈ Consolidated EBITDA because the referral flows net to zero. The distinction matters most when explaining the revenue figure to lenders:

```
WHAT LENDERS SEE:
  Gross Revenue:          $12.4M   (client revenue only — revenue_type = 'client')
  Platform EBITDA:         $5.5M
  EBITDA Margin:           44.4%

WHAT WOULD CONFUSE LENDERS:
  Gross Revenue:          $14.1M   (inflated by intercompany referral flows counted twice)
  Platform EBITDA:         $5.5M
  EBITDA Margin:           39.0%   (looks worse without context)
```

Always present lender-reported revenue as client revenue only. The margin story is cleaner and more defensible.

### 23.2 Engine Implementation

The consolidated entity P&L is assembled as:

```js
// Revenue: only client lines
consolidatedRevenue = entities
  .flatMap(e => e.lineItems)
  .filter(li => li.category === 'revenue' && li.revenue_type === 'client')
  .sum(period)

// EBITDA: all entities summed (referral flows net to zero)
consolidatedEBITDA = entities
  .sum(e => e.ebitda[period])

// Margin on client revenue
consolidatedMargin = consolidatedEBITDA / consolidatedRevenue
```

---

## 24. Updated model_line_items Schema

Full updated column list reflecting all v1.6 additions:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `entity_id` | uuid | FK → model_entities.id, ON DELETE CASCADE |
| `scenario_id` | uuid | FK → model_scenarios.id. NULL = all. |
| `operating_scenario_id` | uuid | FK → model_operating_scenarios.id. NULL = all. |
| `segment_id` | uuid | FK → model_segments.id. NULL = not segment-specific. |
| `category` | text | 'revenue', 'cogs', 'expense', 'debt_service', 'earnout' |
| `revenue_type` | text | 'client', 'referral', 'management'. NULL if not revenue. |
| `statement` | text | 'pl', 'bs', 'cf' |
| `group_name` | text | |
| `item_name` | text | |
| `growth_type` | text | 'organic', 'inorganic', or null |
| `item_type` | text | 'fixed', 'growth_rate', 'driver_derived', 'manual' |
| `growth_rate` | numeric | Monthly % if growth_rate type |
| `base_amount` | numeric | |
| `sort_order` | integer | |
| `notes` | text | |
| `is_system_generated` | boolean | |
| `created_at` | timestamptz | |

**New in v1.6:** `revenue_type`

---

## 25. Complete Build Sequence (v1.6)

| Phase | What to Build | Validation |
|---|---|---|
| 1 — Schema | All migrations including new tables: `model_spv_equity`, `model_holdco_compensation`, `model_covenants`, `model_covenant_results`. Updated `model_liquidity_events` with exit_type, recap fields. `revenue_type` added to `model_line_items`. | All tables present. Constraints enforced. |
| 2 — MiD Baseline | `/models/baseline` settings page. | Baseline queryable. |
| 3 — Models List | `/models` list + create flow. | Model creates with all entities. |
| 4 — Deal Reference Flow | Deal picker, close date, close_period_index, seed flags. | Three deals, different close dates, period indices correct. |
| 5 — Engine: P&L with staged entities | Per-entity activation. Revenue by type (client/referral/management). Referral fee expense auto-generation from driver. | Referral income on SEO agency, referral expense on vertical agency, net zero at consolidated level. |
| 6 — Engine: Debt Corkscrew | Facility at holdco. Per-deal seller notes. PIK, IO, balloon. | Correct amortization on all instruments. |
| 7 — Engine: Working Capital + Three-Statement Tie | BS roll-forward, CF indirect, balance check, CF tie. | BS balances every period. |
| 8 — Engine: Deal Maker Compensation | Step-up comp from model_holdco_compensation applied as holdco expense. | Compensation shows as holdco expense. DSCR reflects it. |
| 9 — Engine: DSCR + Covenant Results | DSCR per period. Step-up check at each close. All covenant types calculated. Write to model_covenant_results. | Covenant breach flagged correctly. Downside scenario shows amber/red where expected. |
| 10 — Engine: Per-SPV Equity Waterfall | Full exit waterfall: capital return → preferred return → catch-up → split. XIRR per party per SPV. Roll-up across SPVs per party. | Known inputs produce correct MOIC and IRR. Carry only activates above hurdle. |
| 11 — Engine: Recapitalization | New facility sizing, dividend calculation, post-recap corkscrew, combined IRR across recap + future exit. | Negative recap dividend returns warning. Post-recap model continues correctly. |
| 12 — Calculate Route | Wire engine. All output tables written. Per-run summaries include covenant compliance. | Full Postman run: 4 SPVs, simultaneous close, 3 operating scenarios, full exit + recap events. |
| 13 — Liquidity Event Route | Exit waterfall per event per scenario combination. | Correct proceeds per party. IRR matches manual XIRR calculation. |
| 14 — Models List UI | `/models` page. MiD Baseline link. | Clean list, create flow works. |
| 15 — Acquisition Timeline | Deal markers. Snapshot triggers. Free-form period picker. | Three deals shown at correct period indices. |
| 16 — Cap Table Panel | Per-SPV equity table in Deal Reference Panel. Party add/edit. Commitment status. | Total base equity validates to 100%. |
| 17 — Deal Structure Panel | Facility terms + per-deal terms. Referral fee driver input. Equity raise tracker. | Sources = uses per close. Facility utilization shown. |
| 18 — P&L Grid | Full row structure. revenue_type badge on referral lines. Pre-close columns grayed. Granularity toggle. | Client vs. referral vs. management revenue visually distinct. |
| 19 — BS + CF Grid | Engine output views. Balance check indicators. | Red flag on any period statements don't tie. |
| 20 — Deal Maker Comp Panel | Step-up salary entry. Engine auto-generates holdco expense. | Salary change flows through to DSCR on next Run Model. |
| 21 — Covenant Dashboard | Period-by-period compliance grid. Amber/red flagging. Covenant Certificate button. | Breach periods highlighted correctly. Certificate PDF generated. |
| 22 — Exit Event Panel | Multiple exit events per model. Full exit vs. recap. Comparison table across events. | Recap dividend calculates correctly. Full exit waterfall correct. IRR per party shown. |
| 23 — Snapshot System | From v1.5 — add covenant_certificate type. | Covenant certificate snapshot saved and retrievable. |
| 24 — Drivers + COA Import | From v1.3/v1.4 — unchanged. referral_fee_pct driver type added. | Referral fee driver auto-generates both expense and income lines on respective entities. |

---

## 26. Lender Package Checklist (Final)

- [ ] Executive summary and investment thesis
- [ ] Org chart: entity structure and collateral perimeter
- [ ] Background on principals and track record
- [ ] Buy box definition and vertical focus rationale
- [ ] Platform narrative: two-cohort structure (vertical agencies + service line engines)
- [ ] Acquisition timeline: close dates, tranche draws, DSCR at each close
- [ ] Sources & uses snapshot per acquisition close ← snapshot system
- [ ] Target company overview per deal reference
- [ ] Historical financials (3 years, accrual basis) per target
- [ ] Chart of accounts mapping (cash-to-accrual conversion documented)
- [ ] Three-statement projection model — all operating scenarios × base deal structure
- [ ] Platform EBITDA bridge: client revenue only, margin explanation
- [ ] Referral fee structure explanation (vertical agency → service line economics)
- [ ] Facility debt schedule and corkscrew
- [ ] Per-deal seller note corkscrews
- [ ] DSCR analysis — step-up at each close, downside case ≥ 1.00× at all periods
- [ ] Covenant compliance table — base and downside scenarios ← covenant dashboard
- [ ] Deal maker compensation schedule ← holdco comp table
- [ ] Capitalization table per SPV
- [ ] Exit / liquidity event analysis — full exit and recap comparison
- [ ] Proceeds waterfall per party per scenario ← exit event panel
- [ ] Earnout / equity rollover instrument summary

---

## 27. Implementation Notes — Final

### For Render Backend Developer

Complete list of engine outputs written on each calculate run:

1. `model_values` — P&L line item values per period per entity per scenario combination
2. `model_debt_corkscrews` — per-instrument corkscrew per period
3. `model_balance_sheet_values` — BS per period per entity
4. `model_cf_values` — CF statement per period per entity
5. `model_covenant_results` — covenant compliance per period per scenario

Additional outputs written by the liquidity event route:
6. Waterfall results returned in response (not stored — computed on demand)
7. XIRR/MOIC per party returned in response

All five output tables are upserted on each run. Idempotent.

Calculation order for the revenue_type logic:
- When processing a vertical agency entity, if a `referral_fee_pct` driver exists, auto-generate two line items if not already present:
  - On the vertical agency: `category: 'expense'`, `group_name: 'Referral Fees'`, `item_name: '[SEO Agency] Referral Fee'`
  - On the target service line entity: `category: 'revenue'`, `revenue_type: 'referral'`, `group_name: 'Referral Income'`, `item_name: '[Vertical Agency] Referral'`
- These are system-generated lines (`is_system_generated: true`) — user cannot directly edit them, only the driver value.

### For Lovable Frontend Developer

The `revenue_type` field should be visually distinct in the P&L grid:
- `'client'` — standard row, no badge
- `'referral'` — small amber badge labeled "Referral"
- `'management'` — small gray badge labeled "Mgmt Fee"

This helps users understand which revenue is external vs. intercompany at a glance without cluttering the grid.

The consolidated entity P&L tab should show a callout box explaining the revenue figure:

```
ℹ Platform Revenue ($12.4M) reflects external client revenue only.
  Intercompany referral flows are excluded from the top line
  and net to zero at the platform level.
```

The cap table panel must enforce that sum of `base_equity_pct` across all parties for a given entity + scenario = exactly 1.0 (100%). Show a running total and block save if not 100%. This is a hard constraint — a cap table that doesn't sum to 100% is legally meaningless.

Exit event comparison table (Section 20.7) should be the hero view of the LiquidityEventPanel — the most important output of the entire model. Give it prominence: full-width table, large text on key metrics, color coding (green = best outcome per row, red = worst).

---

*Deal Room by Aragon Holdings | M&A Financial Modeling Module | v1.6 — Complete*
