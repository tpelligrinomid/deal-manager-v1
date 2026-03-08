# Lovable Prompt — Models Module (M&A Financial Modeling)

Copy and paste this entire prompt into Lovable. This adds the Models module to the existing Deal Room application.

---

```
## Overview

Add a new top-level "Models" module to the Deal Room application. This module allows Aragon Holdings to build multi-deal acquisition models with three-statement financial projections, staged timelines, debt analysis, equity waterfalls, and an investor-facing publish workflow.

The Models module is completely independent from the Deals module. A model references deals (via a junction table) but is not owned by any single deal.

---

## IMPORTANT: Architecture Rules

1. **All data CRUD goes through the Render backend API** at the existing base URL. Do NOT query Supabase directly for model data. Use the same `apiFetch` pattern as the Deals module.
2. **Only two operations call the Render backend compute endpoints:** `POST /api/models/:modelId/calculate` and `POST /api/models/:modelId/publish`. Everything else is standard CRUD.
3. **Auth:** Use the existing Supabase auth session. Include the JWT in all API calls via the Authorization header. The backend handles RLS enforcement.
4. **Roles in the Models module:** `owner` (full control), `editor` (can edit + calculate + publish), `viewer` (read-only investor access). These come from the `model_access` table, separate from the existing app roles.
5. **Design system:** Use the exact same design tokens already in the app — Playfair Display headings, Inter body, #58B50B green, #ED8C34 orange, #EEEEEE background, 8px radius, existing card shadows. No new design system.

---

## Sidebar Navigation Update

Add "Models" to the sidebar nav between "NDAs" and "Team" (or wherever the current nav ends). Use the `BarChart3` icon from Lucide React. The active state uses the same green left-border + green text pattern as Deals.

```
Deals          ← existing
NDAs           ← existing
Models         ← NEW (BarChart3 icon)
Team           ← existing
Settings       ← existing
```

Only show the Models nav item to users with role `admin` or `team_member`. Investors (viewers) access models via a separate URL structure (`/models/:modelId/view`).

---

## Route Structure

```
/models                              → ModelsList page
/models/baseline                     → MiD Baseline settings page
/models/:modelId                     → ModelBuilder (owner/editor view)
/models/:modelId/view                → InvestorView (viewer view, read-only)
/models/:modelId/view?v=3            → InvestorView at a specific published version
/models/:modelId/compare?a=2&b=3     → VersionCompare view
```

After fetching the user's `model_access` role for a given model, route accordingly:
- `owner` or `editor` → `/models/:modelId` (ModelBuilder)
- `viewer` → `/models/:modelId/view` (InvestorView)

---

## Backend API Endpoints

The Render backend will expose these endpoints. Build the frontend to call them. All require `Authorization: Bearer <token>` header.

### Models CRUD
| Method | Endpoint | Body / Notes |
|--------|----------|-------------|
| GET | `/api/models` | Returns list of models the user has access to |
| POST | `/api/models` | `{ name, description, start_date, period_count, profit_metric, presentation_granularity }` — auto-creates default entities + operating scenarios + model_access(owner) |
| GET | `/api/models/:modelId` | Full model with entities, scenarios, operating scenarios |
| PATCH | `/api/models/:modelId` | Update model fields |
| DELETE | `/api/models/:modelId` | Owner only |

### Entities
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/entities` | All entities for this model, ordered by sort_order |
| PATCH | `/api/models/:modelId/entities/:entityId` | Update entity_name, sort_order |

### Scenarios (Deal Structure)
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/scenarios` | |
| POST | `/api/models/:modelId/scenarios` | All facility + equity fields |
| PATCH | `/api/models/:modelId/scenarios/:id` | |
| DELETE | `/api/models/:modelId/scenarios/:id` | |

### Operating Scenarios
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/operating-scenarios` | |
| POST | `/api/models/:modelId/operating-scenarios` | `{ name, case_type, description, is_default }` |
| PATCH | `/api/models/:modelId/operating-scenarios/:id` | |
| DELETE | `/api/models/:modelId/operating-scenarios/:id` | |

### Deal References
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/deal-references` | Includes deal info (agency_name, financials) |
| POST | `/api/models/:modelId/deal-references` | `{ deal_id, entity_id, close_date }` — backend auto-calculates close_period_index |
| PATCH | `/api/models/:modelId/deal-references/:id` | |
| DELETE | `/api/models/:modelId/deal-references/:id` | |

### Deal Scenario Terms (per-deal, per-scenario)
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/deal-references/:refId/terms` | All scenario terms for this deal ref |
| PUT | `/api/models/:modelId/deal-references/:refId/terms/:scenarioId` | Upsert terms for a specific scenario |

### Line Items
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/entities/:entityId/line-items` | Filtered by ?scenario_id, ?operating_scenario_id |
| POST | `/api/models/:modelId/entities/:entityId/line-items` | |
| PATCH | `/api/models/:modelId/line-items/:id` | |
| DELETE | `/api/models/:modelId/line-items/:id` | |

### Segments
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/entities/:entityId/segments` | |
| POST | `/api/models/:modelId/entities/:entityId/segments` | `{ segment_name, sort_order }` |
| PATCH | `/api/models/:modelId/segments/:id` | |
| DELETE | `/api/models/:modelId/segments/:id` | |

### Drivers
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/entities/:entityId/drivers` | Filtered by ?operating_scenario_id |
| POST | `/api/models/:modelId/entities/:entityId/drivers` | |
| PATCH | `/api/models/:modelId/drivers/:id` | |
| DELETE | `/api/models/:modelId/drivers/:id` | |

### SPV Equity (Cap Table)
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/entities/:entityId/equity` | Filtered by ?scenario_id |
| POST | `/api/models/:modelId/entities/:entityId/equity` | |
| PATCH | `/api/models/:modelId/equity/:id` | |
| DELETE | `/api/models/:modelId/equity/:id` | |

### Holdco Compensation
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/compensation` | |
| POST | `/api/models/:modelId/compensation` | |
| PATCH | `/api/models/:modelId/compensation/:id` | |
| DELETE | `/api/models/:modelId/compensation/:id` | |

### Covenants
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/covenants` | Includes covenant_results if model has been calculated |
| POST | `/api/models/:modelId/covenants` | |
| PATCH | `/api/models/:modelId/covenants/:id` | |
| DELETE | `/api/models/:modelId/covenants/:id` | |

### MiD Baseline
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/baseline` | Returns all baselines, active one marked |
| POST | `/api/models/baseline` | `{ name, effective_date }` |
| PATCH | `/api/models/baseline/:id` | |
| POST | `/api/models/baseline/:id/activate` | Sets this baseline as active, deactivates others |
| GET | `/api/models/baseline/:id/entities` | |
| POST | `/api/models/baseline/:id/entities` | |

### Calculate + Publish (Render compute)
| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `/api/models/:modelId/calculate` | `{ scenarioIds: [], operatingScenarioIds: [] }` — returns full P&L, BS, CF, corkscrews, DSCR, warnings |
| POST | `/api/models/:modelId/publish` | `{ versionName, versionNotes, featuredScenarioId, featuredOperatingScenarioId, notifyInvestors }` |
| GET | `/api/models/:modelId/versions` | List published versions (metadata only) |
| GET | `/api/models/:modelId/versions/:versionId` | Full published version with JSONB output |

### Snapshots
| Method | Endpoint | Notes |
|--------|----------|-------|
| POST | `/api/models/:modelId/snapshot` | `{ periodIndex, scenarioId, operatingScenarioId, dealReferenceId }` — live preview or save |
| GET | `/api/models/:modelId/snapshots` | List saved snapshots |

### Liquidity Events
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/liquidity-events` | |
| POST | `/api/models/:modelId/liquidity-events` | |
| PATCH | `/api/models/:modelId/liquidity-events/:id` | |
| GET | `/api/models/:modelId/liquidity-event/:scenarioId/:operatingScenarioId` | Computed waterfall results |

### Model Access (Share)
| Method | Endpoint | Notes |
|--------|----------|-------|
| GET | `/api/models/:modelId/access` | List users with access |
| POST | `/api/models/:modelId/access` | `{ email, role }` — invite user |
| PATCH | `/api/models/:modelId/access/:id` | Change role |
| DELETE | `/api/models/:modelId/access/:id` | Revoke access |

---

## Page 1: Models List (`/models`)

A table/card view of all models the user has access to.

**Header:**
- "Models" (H1, Playfair Display)
- "New Model" button (green, right-aligned)
- "MiD Baseline" link (text link, right-aligned, navigates to `/models/baseline`)

**Table columns:**
| Column | Source |
|--------|--------|
| Model Name | `name` — clickable, links to `/models/:modelId` |
| Description | `description` — truncated to 80 chars |
| Start Date | `start_date` — formatted as "Jan 2026" |
| Deals | Count of `model_deal_references` |
| Last Calculated | From most recent `model_calculate_runs.run_at` — "2 hours ago" or "Never" |
| Status | Green dot if last run passed, amber if warnings, red if errors, gray if never run |

**Empty state:** Centered illustration with "No models yet. Create your first acquisition model to get started." and a "New Model" button.

**New Model Modal:**
- Name (text, required) — placeholder "AEO Roll-Up 2025"
- Description (textarea, optional)
- Start Date (date picker, required) — this is Period 0
- Period Count (number, default 120, usually hidden behind an "Advanced" toggle)
- Profit Metric (radio: EBITDA / SDE, default EBITDA)
- Presentation Granularity (radio: Monthly / Quarterly / Annual, default Monthly)
- Cancel + Create buttons

On create, the backend auto-generates:
- 4 singleton entities: Aragon Holdings, Marketers in Demand, Intermediate HoldCo, Consolidated
- 3 default operating scenarios: Downside (Flat), Base (Management), Upside
- 1 model_access row (owner) for the creating user
- Standard covenants (Min DSCR 1.25x, Max Leverage 5.0x, Min Cash $250K, Fixed Charge 1.1x)

After creation, navigate to `/models/:modelId`.

---

## Page 2: MiD Baseline (`/models/baseline`)

Settings page for the Marketers in Demand financial baseline. This is org-level data, not model-specific.

**Header:**
- "MiD Baseline" (H1)
- Back link to `/models`

**Active Baseline Card:**
- Shows the currently active baseline name, effective date
- "Edit" button to modify baseline entities and line items
- Uses the same spreadsheet grid as entity views in ModelBuilder

**Baseline History:**
- List of prior baselines with name, effective date, status (Active / Inactive)
- Each row has an "Activate" button (sets `is_active = true` on this baseline, `false` on all others)
- "New Baseline" button at bottom

**New Baseline Form:**
- Name (text) — e.g., "MiD Q1 2026"
- Effective Date (date picker)
- Create — then opens the spreadsheet grid to enter entities and financials

---

## Page 3: ModelBuilder (`/models/:modelId`)

This is the main workspace. It has four visual zones stacked vertically.

### Zone 1: Top Bar

A horizontal toolbar with:
- **Model name** (editable inline — click to edit, press Enter to save, calls PATCH)
- **Deal Structure Scenario** dropdown (populated from `model_scenarios`). Shows current scenario name.
- **Operating Scenario** dropdown (Downside / Base / Upside from `model_operating_scenarios`)
- **Granularity** toggle (Monthly | Quarterly | Annual — controls column grouping in the grid, client-side only)
- **Run Model** button (green, calls POST `/api/models/:modelId/calculate`). Shows spinner while running (expect 2-5 seconds). On success, updates the grid with returned data.
- **Publish** button (outline, opens Publish Modal)
- **Share** button (outline, opens Share Panel)
- **Covenants** button (outline, opens Covenant Dashboard)

### Zone 2: Acquisition Timeline

A horizontal strip below the top bar showing the model's time range.

**Visual design:**
- A thin horizontal line from Period 0 to Period 119 (or the model's period_count)
- The line has small tick marks at regular intervals (every 12 periods = 1 year)
- Year labels beneath the ticks ("2025", "2026", etc., derived from model start_date)

**Deal markers:**
- Each deal reference appears as a colored dot/flag on the timeline at its `close_period_index`
- Below the marker: deal name (truncated) + formatted close date
- Above the marker: purchase price (from deal scenario terms or deal.asking_price)
- Click a marker → opens the Deal Reference Panel (slide-out from right)
- Color coding: green = funded/active, orange = pipeline placeholder

**Controls:**
- "Add Deal" button at the right end of the timeline → opens a Deal Picker modal
- Small camera/snapshot icon on each deal marker → opens Snapshot Modal at that period

**Deal Picker Modal:**
- Searchable dropdown of all deals (from `/api/deals` — all statuses including pipeline)
- Shows deal name, status badge, reported revenue, reported EBITDA
- Close Date picker (date input)
- Calculated `close_period_index` shown live as user picks date: "April 2026 — Period 15"
- Pull flags: three toggles for "Seed Revenue", "Seed EBITDA", "Seed Purchase Price" (default all on)
- Cancel + Add to Model buttons
- On add, backend creates: model_deal_references row, a new SPV entity, links entity_id

### Zone 3: Entity Tabs + Financial Grid

**Entity tabs** — horizontal tab bar:
```
Marketers in Demand | Intermediate HoldCo | SPV-A: New North | SPV-B: Target B | ... | Consolidated
```
- Tabs ordered by: MiD first, Intermediate HoldCo second, then SPV/target entities sorted by `close_period_index` ascending, Consolidated last
- Each SPV tab shows the close date in smaller text beneath the entity name: "Closes Jan 2026"
- The Consolidated tab has a subtle "read-only" indicator — it shows aggregated data, not editable inputs

**Sub-tabs per entity:** P&L | Balance Sheet | Cash Flow | Drivers | Cap Table (SPV only) | Deal Terms (SPV only)

**SpreadsheetGrid** (P&L, BS, CF tabs):

This is the core data display. It shows the financial output from the last "Run Model" call.

Structure:
- **Left column** (frozen, sticky left: 0): Line item labels grouped by category
- **Column headers** (frozen, sticky top: 0): Period labels (M1, M2, ... or Q1, Q2, ... or Y1, Y2, ...)
- **Data cells**: Numeric values formatted as currency (no decimals for large numbers, 2 decimals for percentages)

P&L row structure (from engine output):
```
▼ REVENUE
  [segment] Client Revenue        $125,000  $128,000  ...
  [segment] Referral Income       $7,000    $7,100    ...    (amber "Referral" badge)
  Total Revenue                   $132,000  $135,100  ...
▼ COGS
  ...
  Gross Profit                    $96,000   $98,500   ...
  Gross Margin %                  72.7%     72.9%     ...
▼ OPERATING EXPENSES
  ...
  EBITDA                          $62,000   $64,000   ...
▼ DEBT SERVICE
  Interest Expense                ($12,000) ($12,000) ...
  EBT                             $50,000   $52,000   ...
  Tax Provision                   ($12,500) ($13,000) ...
  Net Income                      $37,500   $39,000   ...
```

**Pre-close behavior:** For entities with a `close_period_index > 0`, all columns before that period are grayed out with no values. The close period column has a small flag icon in the header. This visually communicates "this entity didn't exist yet."

**Revenue type badges:**
- `'client'` → no badge (standard row)
- `'referral'` → small amber pill badge "Referral"
- `'management'` → small gray pill badge "Mgmt Fee"

**Consolidated entity note:** The Consolidated tab's P&L shows only `revenue_type = 'client'` lines in the Revenue section. Show an info callout above the grid:
> "Platform Revenue reflects external client revenue only. Intercompany referral flows are excluded from the top line and net to zero at the platform level."

**Balance Sheet grid** — wide row format. Same frozen-column structure:
```
ASSETS
  Cash                            $425,000  ...
  Accounts Receivable             $312,500  ...
  Prepaid Expenses                $15,000   ...
  Other Current Assets            $0        ...
  Goodwill                        $8,650,000 ...
  Other Intangibles               $0        ...
  Fixed Assets (Net)              $45,000   ...
  Other LT Assets                 $0        ...
  Total Assets                    $9,447,500 ...
LIABILITIES
  Accounts Payable                $87,500   ...
  Accrued Expenses                $42,000   ...
  Current Portion LTD             $720,000  ...
  Other Current Liabilities       $0        ...
  Long-Term Debt                  $6,305,700 ...
  Other LT Liabilities            $0        ...
  Total Liabilities               $7,155,200 ...
EQUITY
  Contributed Capital             $1,587,500 ...
  Retained Earnings               $704,800  ...
  Total Equity                    $2,292,300 ...
─────────────────────────────────
Total L + E                       $9,447,500 ...    ✓ (green check if balanced)
```

Show a red warning icon on any period where `is_balanced = false`.

**Cash Flow grid** — indirect method:
```
OPERATING ACTIVITIES
  Net Income                      $37,500   ...
  + Depreciation & Amortization   $3,750    ...
  Change in AR                    ($5,200)  ...
  Change in AP                    $1,800    ...
  Change in Prepaid               ($500)    ...
  Change in Accrued               $800      ...
  Other Operating                 $0        ...
  Cash from Operations            $38,150   ...
INVESTING ACTIVITIES
  CapEx                           ($4,500)  ...
  Acquisitions                    $0        ...
  Other Investing                 $0        ...
  Cash from Investing             ($4,500)  ...
FINANCING ACTIVITIES
  Debt Proceeds                   $0        ...
  Debt Repayment                  ($24,000) ...
  Equity Contributions            $0        ...
  Dividends                       $0        ...
  Other Financing                 $0        ...
  Cash from Financing             ($24,000) ...
─────────────────────────────────
Net Change in Cash                $9,650    ...
Beginning Cash                    $415,350  ...
Ending Cash                       $425,000  ...    ✓ (green check if ties_to_bs)
```

Show a red warning if `ties_to_bs = false`.

**Grid performance:** 120 columns x ~50 rows = 6,000 cells. Render all cells as a plain HTML table or CSS grid with sticky positioning. No heavy grid library needed.

**Grid CSS pattern:**
```css
.grid-container {
  overflow-x: auto;
}
.line-item-label {
  position: sticky;
  left: 0;
  background: white;
  z-index: 1;
  border-right: 2px solid #D9D9D9;
  min-width: 240px;
}
.period-header {
  position: sticky;
  top: 0;
  background: white;
  z-index: 2;
}
.corner-cell {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 3;
  background: white;
}
```

**Drivers sub-tab:**
- Table of working capital and growth drivers for the selected entity + operating scenario
- Columns: Driver Type, Value, Period Start, Period End, Notes
- Driver types: ar_days, ap_days, prepaid_pct, accrued_exp_pct, capex_pct_revenue, tax_rate, da_monthly, organic_growth_rate, cogs_pct_revenue, min_cash_balance
- `period_start` is relative to the entity's close period, not the model start. Display both: "Period 3 (Apr 2026)"
- Add / Edit / Delete inline or via modal

**Cap Table sub-tab (SPV entities only):**
- Table of equity parties for this entity in the current deal structure scenario
- Columns: Party Name, Type (sponsor/partner/lp/seller_rollover), Base %, Carry %, Hurdle Rate, Committed Capital, Status (soft_circle/committed/funded)
- Running total of Base % at bottom — must sum to 100%. Show red warning if not 100%.
- Add / Edit / Delete rows

**Deal Terms sub-tab (SPV entities only):**
- Shows per-deal-per-scenario financial terms
- Fields: Purchase Price, Transaction Costs, WC Reserve, Target Cash at Close, Tranche Amount, Seller Note (amount, rate, term, IO months, deferred months, PIK toggle), Earnout (amount, threshold, cap, period, equity instrument toggle), Seller Equity Rollover %
- Sources = Uses calculation shown live at the bottom

### Zone 4: Bottom Status Strip

A thin bar at the bottom of the ModelBuilder showing:
- **Balance Check:** "Balanced ✓" (green) or "UNBALANCED ✗" (red) — from engine validation
- **Min DSCR:** "1.56x" with color (green ≥ 1.25, amber 1.00-1.25, red < 1.00)
- **Facility Utilization:** "87% drawn" with a small progress bar
- **Last Run:** "Calculated 2 min ago" or "Not yet calculated"

This strip only shows data after "Run Model" has been executed at least once.

---

## Page 4: Deal Structure Panel

Accessible from the Deal Structure Scenario dropdown or as a dedicated view. Shows facility-level terms that apply across all deals in the model.

**Facility Terms section:**
- Total Facility Size (currency input)
- Initial Tranche Amount
- Interest Rate (% input)
- Term (months)
- IO Months (interest-only period)
- Deferred Months
- PIK toggle
- Balloon Month

**Default Per-Deal Terms section:**
- Default Seller Note Rate, Term, IO, Deferred, PIK
- Default Earnout Is Equity Instrument toggle

**Equity at Close section:**
- Equity from Investors (currency)
- Equity from Aragon (currency)
- Equity from Other (currency)
- Management Fee Monthly (currency)
- Exit Transaction Costs % (default 4%)

All fields save on blur via PATCH to the scenario endpoint.

---

## Page 5: Holdco Compensation Panel

Accessible from the Intermediate HoldCo entity view or as a settings sub-panel.

**Compensation Tiers table:**
| Party Name | Type | Annual Amount | Period Start | Period End | Notes |
|-----------|------|---------------|-------------|-----------|-------|
| Tristan Pelligrino | Deal Maker Salary | $175,000 | 0 | 11 | 1 acquisition |
| Tristan Pelligrino | Deal Maker Salary | $225,000 | 12 | 17 | 2 acquisitions |
| Tristan Pelligrino | Deal Maker Salary | $275,000 | 18 | 35 | Full portfolio |
| Tristan Pelligrino | Deal Maker Salary | $325,000 | 36 | — | Post-recap |

- Add Tier / Edit / Delete
- Shows monthly equivalent alongside annual amount
- Compensation types: deal_maker_salary, management_fee, board_fee

---

## Page 6: Covenant Dashboard

Opens as a modal or slide-out panel from the ModelBuilder top bar.

**Covenant Definitions table:**
| Covenant | Type | Threshold | Frequency | Basis | Actions |
|----------|------|-----------|-----------|-------|---------|
| Minimum DSCR | dscr_min | ≥ 1.25x | Quarterly | Trailing 12 | Edit / Delete |
| Maximum Leverage | leverage_max | ≤ 5.0x | Quarterly | Point in time | Edit / Delete |
| Minimum Cash | cash_min | ≥ $250,000 | Quarterly | Point in time | Edit / Delete |
| Fixed Charge Coverage | fixed_charge_min | ≥ 1.10x | Quarterly | Trailing 12 | Edit / Delete |

"Add Covenant" button for custom covenants.

**Compliance Grid** (only shown after model has been calculated):

Period-by-period compliance matrix. Rows = covenants, Columns = measurement periods (quarterly if measurement_frequency = quarterly).

Cell colors:
- Green: compliant with > 10% headroom
- Amber: compliant but within 10% of threshold (warning zone)
- Red: breach (measured_value fails threshold)

Each cell shows the measured value. Hover shows headroom.

---

## Page 7: Liquidity Event Panel

Accessible from the ModelBuilder. Shows exit analysis.

**Event List:**
Shows all `model_liquidity_events` for the current scenario combination. Each event is a card:
- Event name ("Month 36 Full Exit")
- Exit type badge (Full Exit / Recapitalization / Partial Sale)
- Period + calendar date
- Exit multiple range (low / base / high)

"Add Exit Event" button — form with all liquidity event fields.

**Comparison Table** (when multiple events exist):

```
                         MONTH 36 RECAP    MONTH 60 EXIT    MONTH 36 EXIT
─────────────────────────────────────────────────────────────────────────
Platform EBITDA          $5.5M             $7.2M            $5.5M
Exit Multiple            5.0x refi         7.0x sale        6.5x sale
Gross EV / New Debt      $27.5M            $50.4M           $35.75M
Net Proceeds             $14.2M            $38.1M           $21.3M

Tristan — Total $        $9.1M             $24.8M           $13.9M
Tristan — MOIC           1.9x              5.2x             2.9x
Tristan — IRR            —                 38%              52%

Partner — Total $        $4.6M             $11.2M           $6.2M
Investor A — Total $     $2.8M             $7.4M            $4.1M
```

This table is the hero output of the entire module. Make it prominent: full width, large text on key metrics, bold numbers. Color code: green = best outcome per row, red = worst.

---

## Page 8: Snapshot Modal

Opens when clicking a snapshot icon on the Acquisition Timeline or from a "Snapshot" button.

**Top section — Controls:**
- Period shown: "January 2027 — Period 12"
- Scenario selectors (pre-filled from ModelBuilder state)
- Name field (auto-filled: "Agency B Close — Jan 2027")
- "Save Snapshot" button
- "Export PDF" button

**Bottom section — Four exhibit tabs:**

1. **Sources & Uses** — formatted table showing Uses (purchase price, transaction costs, WC reserve) vs Sources (facility tranche, seller note, target cash, investor equity). Gap calculation. Cumulative facility utilization.

2. **DSCR** — Portfolio EBITDA, total debt service, DSCR ratio with threshold check. Downside DSCR shown separately.

3. **Debt State** — All instrument balances at this period (facility, seller notes per deal). Total debt.

4. **Balance Sheet** — Frozen BS snapshot at this period.

All exhibit data comes from the snapshot endpoint response. If the model hasn't been calculated yet, show: "Run the model first to generate snapshot data."

---

## Page 9: Publish Modal

Opens from the "Publish" button in the ModelBuilder top bar.

**Form:**
- Version Name (text, required) — "Post-QoE Updated"
- Version Notes (textarea, optional) — "Revised Agency A purchase price based on QoE findings."
- Featured Scenario (dropdown — which deal structure scenario is the default view for investors)
- Featured Operating Scenario (dropdown)
- Notify Investors (checkbox, default checked) — sends email to all viewers

**Publish button** — calls POST `/api/models/:modelId/publish`. Shows loading state "Publishing version N..." (expect 3-8 seconds). On success, shows confirmation with version number.

**What the backend does on publish:**
1. Runs full engine calculate
2. Freezes all output (P&L, BS, CF, corkscrew, covenant, waterfall) as JSONB
3. Freezes all current input values as JSONB (for version comparison)
4. Creates immutable `model_published_versions` row
5. Sets `is_current = true` on new version, `false` on prior
6. Optionally sends notification emails to viewers

---

## Page 10: Share Panel

Slide-out panel from the "Share" button.

**Invite section:**
- Email input
- Role dropdown: Editor / Viewer
- "Invite" button

**Current Access list:**
| User | Role | Status |
|------|------|--------|
| Tristan Pelligrino | Owner | — |
| Business Partner | Editor | Invited Jan 15 |
| Investor A | Viewer | Last viewed Feb 12 |
| Investor B | Viewer | Last viewed Feb 10 |

Each row has a role dropdown (owner can change) and a "Revoke" button.

"Last viewed" data comes from `model_access_log`.

---

## Page 11: Investor View (`/models/:modelId/view`)

A completely different layout from ModelBuilder. Read-only. No editing controls anywhere.

**Top bar:**
- Model name
- Version selector dropdown: "Version 3 — Post-QoE" (populated from published versions)
- Published date + published by
- "Compare Versions" button (if multiple versions exist)
- "History" dropdown showing all published versions

**Two-column summary cards:**

Left card — Platform Summary:
- Portfolio EBITDA
- Number of companies
- Hold period
- Min DSCR

Right card — Your Position (personalized to the viewing investor):
- Entity name (which SPV they're in)
- Stake (base %)
- Committed capital
- MOIC (from waterfall_output)
- IRR (from waterfall_output)

The "Your Position" card reads from `model_spv_equity` to find the viewing investor's equity stake, then reads their return metrics from `waterfall_output` in the published version JSONB.

**Scenario selector:** Read-only dropdowns for deal structure scenario and operating scenario. Investor can switch between scenarios to see different projections but cannot modify them.

**Tabs:**
1. **Summary** — the two summary cards + key charts
2. **P&L Drill-Down** — the full frozen-column spreadsheet grid, reading from `pl_output` JSONB. Same grid component as ModelBuilder but read-only.
3. **Exit Scenarios** — comparison table of exit events showing the investor's specific returns
4. **Documents** — list of saved snapshots (Sources & Uses, Covenant Certificates) with View and PDF download buttons, plus version history

**Grid in Investor View:**
- Same frozen-column CSS pattern as ModelBuilder
- All cells read-only (no hover edit states)
- Reads from published version JSONB, not from live data
- DSCR row: amber background below 1.25x, red below 1.00x
- Pre-close columns grayed out

---

## Page 12: Version Compare (`/models/:modelId/compare?a=2&b=3`)

**Version selector at top:**
```
Compare:  [Version 2 — Revised Lower Price ▾]   vs.   [Version 3 — Post-QoE ▾]
```

**Section 1 — What Changed (input diff):**
Compares `input_snapshot` JSONB between two versions. Show changed fields:
```
ASSUMPTION CHANGES  (Version 2 → Version 3)
──────────────────────────────────────────────────
Agency A Purchase Price         $5,250,000 → $4,800,000   ↓ $450K
Facility Interest Rate               9.50% → 8.75%        ↓ 0.75%
Agency B Close Date               Month 12 → Month 9      earlier by 3mo
```

**Section 2 — What It Means (metric impact):**
Compares `key_metrics` JSONB between two versions:
```
IMPACT ON KEY METRICS
──────────────────────────────────────────────────
                        Version 2    Version 3    Change
Min DSCR                  1.56x        1.71x      ↑ better
Tristan — MOIC            2.9x         3.4x       ↑ better
Investor A — IRR          38%          43%         ↑ better
```

Green arrows for improvements, red for deterioration.

---

## State Management Notes

**After "Run Model":** The calculate endpoint returns the full engine output (P&L grids, BS grids, CF grids, corkscrews, DSCR, warnings, summary). Store this in component state (React context or zustand store). The grids render from this cached response. If the user navigates away and returns, show "Model results not loaded — Run Model to view" with a green "Run Model" button.

**Scenario switching:** When the user changes the deal structure or operating scenario dropdown, filter the cached engine output to show the selected combination. The engine returns results for all requested scenario combinations in a single response — no re-fetch needed for switching.

**Dirty state:** Track whether any model inputs have changed since the last calculate run. If so, show a subtle "Unsaved changes — Run Model to update" indicator near the Run Model button.

---

## Number Formatting

- Currency: `$1,234,567` (no decimals for values > $1,000). `$1.2M` for values > $1M in summary cards.
- Percentages: `72.7%` (1 decimal)
- Multiples: `5.2x` (1 decimal)
- DSCR: `1.56x` (2 decimals)
- Negative values: parentheses `($12,000)` in the grid, minus sign `-$12,000` in summary cards

---

## Loading & Error States

- **Page loading:** Same centered spinner pattern as Deals module
- **Run Model loading:** Green spinner replacing the "Run Model" button text, button disabled. Show elapsed time "Calculating... 3s"
- **Publish loading:** Modal stays open with progress: "Publishing version 4... Running engine... Saving output... Done!"
- **API errors:** Toast notification (bottom-right, auto-dismiss) with error message
- **409 on snapshot:** "Run the model first to generate snapshot data. [Run Model]"
- **Empty grid:** "No data yet. Click 'Run Model' to generate financial projections."
```

---

# User Experience Scenario: End-to-End Walkthrough

This scenario describes the complete user journey through the Models module, from creating a model to sharing it with an investor. It covers what the user sees, what they do, and what the backend does at each step.

---

## Scene 1: Creating a New Model

**Who:** Tristan (admin, team_member)

**What happens:**

Tristan clicks "Models" in the sidebar. The Models List page loads. It's empty — no models exist yet. He sees the empty state: "No models yet. Create your first acquisition model to get started."

He clicks "New Model." A modal appears. He fills in:
- Name: "AEO Roll-Up 2025"
- Description: "Three-agency digital marketing roll-up. Senior facility + seller notes."
- Start Date: January 1, 2025
- Profit Metric: EBITDA (default)
- Granularity: Monthly (default)

He clicks "Create."

**Backend:** POST `/api/models` receives the request. The backend:
1. Creates the `financial_models` row
2. Creates 4 singleton entities: Aragon Holdings (parent), Marketers in Demand (operating holdco), Intermediate HoldCo (loan party), Consolidated (aggregation)
3. Creates 3 operating scenarios: Downside (Flat), Base (Management), Upside
4. Creates 1 `model_access` row with role = 'owner' for Tristan
5. Creates 4 standard covenants (Min DSCR 1.25x, Max Leverage 5.0x, Min Cash $250K, Fixed Charge 1.1x)
6. Returns the full model object with all auto-generated children

**Frontend:** Navigates to `/models/:modelId`. The ModelBuilder loads. The top bar shows "AEO Roll-Up 2025" with empty scenario dropdowns (no deal structure scenarios yet). The Acquisition Timeline is empty. The entity tabs show: Marketers in Demand | Intermediate HoldCo | Consolidated. No SPV tabs yet because no deals have been added.

---

## Scene 2: Adding a Deal Structure Scenario

Tristan needs to define how the deals will be financed. He clicks the Deal Structure Scenario dropdown — it's empty. He clicks "New Scenario."

A form appears (modal or inline panel). He fills in:
- Name: "Senior Debt + Seller Notes"
- Is Base Case: Yes
- Total Facility Size: $8,500,000
- Initial Tranche Amount: $3,500,000
- Rate: 9.25% (0.0925)
- Term: 84 months
- IO Months: 12
- PIK: No
- Default Seller Note Rate: 6%
- Default Seller Note Term: 60 months
- Equity from Investors: $1,500,000
- Equity from Aragon: $500,000
- Management Fee Monthly: $5,000
- Exit Transaction Costs: 4%

He clicks Save. The dropdown now shows "Senior Debt + Seller Notes."

**Backend:** POST `/api/models/:modelId/scenarios` creates the row with all facility terms. Returns the scenario object.

---

## Scene 3: Adding Deal References (Building the Acquisition Timeline)

Now Tristan adds the three target companies to the model. These deals already exist in the Deals module (some with status 'active', one with status 'pipeline').

He clicks "Add Deal" on the Acquisition Timeline. The Deal Picker modal opens.

**Deal 1 — New North (Anchor):**
- He searches "New North" and selects it. The modal shows: New North | Active | Revenue: $3.6M | EBITDA: $1.2M | Asking Price: $4.5M
- Close Date: January 1, 2025 (same as model start)
- The modal calculates and shows: "January 2025 — Period 0"
- Pull flags: all three on (Seed Revenue ✓, Seed EBITDA ✓, Seed Purchase Price ✓)
- He clicks "Add to Model"

**Backend:** POST `/api/models/:modelId/deal-references` with `{ deal_id, close_date: "2025-01-01" }`. The backend:
1. Calculates `close_period_index = 0` (months between model start_date and close_date)
2. Creates a new SPV entity: "SPV-A: New North" with `close_period_index = 0`, `parent_entity_id = intermediate_holdco.id`
3. Creates the `model_deal_references` row linking the deal, model, and new entity
4. Returns the deal reference with the auto-created entity

**Frontend:** A deal marker appears on the timeline at period 0. A new entity tab appears: "SPV-A: New North" with "Closes Jan 2025" beneath it.

**Deal 2 — Target B (Pipeline):**
- He searches "Target B" — it's a pipeline deal with only estimated financials
- Close Date: January 1, 2026
- Shows: "January 2026 — Period 12"
- All pull flags on

**Backend:** Same flow. `close_period_index = 12`. New entity: "SPV-B: Target B."

**Deal 3 — Target C (Pipeline):**
- Close Date: July 1, 2026
- Shows: "July 2026 — Period 18"

**Backend:** `close_period_index = 18`. New entity: "SPV-C: Target C."

The Acquisition Timeline now shows three markers at periods 0, 12, and 18. The entity tabs show:
```
Marketers in Demand | Intermediate HoldCo | SPV-A: New North | SPV-B: Target B | SPV-C: Target C | Consolidated
                                            Closes Jan 2025    Closes Jan 2026    Closes Jul 2026
```

---

## Scene 4: Entering Deal-Specific Financial Terms

Tristan clicks the deal marker for Target B on the timeline. The Deal Reference Panel slides in from the right.

He scrolls to the Deal Terms section. For the "Senior Debt + Seller Notes" scenario:
- Purchase Price: $3,500,000
- Transaction Costs: $105,000
- Working Capital Reserve: $100,000
- Tranche Amount: $2,800,000 (drawn from the senior facility)
- Seller Note Amount: $350,000 at 6% / 60 months / 12 months IO
- Earnout: $200,000 / threshold $400K monthly EBITDA / cap $200K / 24 months

He fills in the Sources & Uses and sees the live calculation at the bottom:
```
USES:    $3,500,000 + $105,000 + $100,000 = $3,705,000
SOURCES: $2,800,000 + $350,000 + $200,000 + $355,000 (equity) = $3,705,000
GAP: $0 ✓ Balanced
```

**Backend:** PUT `/api/models/:modelId/deal-references/:refId/terms/:scenarioId` upserts the terms row.

---

## Scene 5: Entering Line Items and Drivers

Tristan clicks the "SPV-A: New North" entity tab, then the "Drivers" sub-tab.

For the Base (Management) operating scenario, he enters:
- Organic Growth Rate: 2% monthly
- AR Days: 45
- AP Days: 30
- Tax Rate: 25%
- CapEx % Revenue: 1.5%
- D&A Monthly: $3,750
- COGS % Revenue: 28%
- Min Cash Balance: $100,000

He then switches to the Downside operating scenario and enters flat growth (0%), same WC drivers.

He then switches to the P&L sub-tab. The grid is empty because the model hasn't been calculated yet. He sees: "No data yet. Click 'Run Model' to generate financial projections."

He can also add manual line items — clicking "Add Line Item" opens a form for custom revenue or expense lines with category, group, name, item_type, base_amount, growth_rate.

**Backend:** POST/PATCH to the drivers and line-items endpoints. All CRUD, no engine involvement.

---

## Scene 6: Running the Model

Tristan has entered all inputs for three deals, their financial terms, line items, and drivers across all operating scenarios. He clicks "Run Model."

The button shows a spinner: "Calculating... 2s... 3s..."

**Backend:** POST `/api/models/:modelId/calculate` with `{ scenarioIds: ["scenario-uuid"], operatingScenarioIds: ["downside-uuid", "base-uuid", "upside-uuid"] }`.

The backend:
1. Assembles the complete input object: model config, all entities with line items + drivers, all scenarios with deal terms, all operating scenarios
2. For the MiD entity: merges baseline data if `inherit_baseline = true`
3. For each deal reference with `seed_overridden = false`: overwrites base_amount on affected line items with current deal.reported_revenue / 12, deal.reported_ebitda / 12, deal.asking_price
4. Calls the engine pipeline (pure functions, no DB):
   - Generates 120 monthly periods
   - For each entity sorted by close_period_index:
     - Revenue projection per segment from close period onward
     - COGS from drivers
     - OpEx projection
     - Debt corkscrew from close period (facility tranche, seller notes)
     - Interest expense on P&L
     - EBT, tax, net income
     - Working capital from drivers
     - CapEx from drivers
   - Balance sheet roll-forward per period
   - Indirect cash flow per period
   - Balance check (assets = liabilities + equity every period)
   - CF tie check (ending cash = BS cash every period)
   - DSCR calculation per period
   - DSCR step-up check at each close_period_index
   - Covenant compliance evaluation
   - Entity consolidation (client revenue only for top line)
5. Writes output to persistent tables (DELETE + batch INSERT per table):
   - model_values (P&L line item values per period)
   - model_balance_sheet_values (wide row per entity per period)
   - model_cf_values (indirect CF per entity per period)
   - model_debt_corkscrews (per instrument per period)
   - model_covenant_results (compliance per covenant per period)
6. Creates model_calculate_runs row (audit trail with summary + hash)
7. Returns the full output in the API response

The engine returns results for ALL 3 operating scenarios in a single response (1 deal structure scenario × 3 operating scenarios = 3 runs).

**Frontend response handling:** The response includes:
```json
{
  "success": true,
  "runs": [
    {
      "scenarioId": "...",
      "operatingScenarioId": "...",
      "scenarioName": "Senior Debt + Seller Notes",
      "operatingScenarioName": "Base (Management)",
      "passed": true,
      "warnings": [
        {
          "type": "dscr_stepup_warning",
          "periodIndex": 12,
          "entityName": "SPV-B: Target B",
          "value": 1.19,
          "threshold": 1.25,
          "message": "DSCR drops to 1.19x at period 12 when Target B closes"
        }
      ],
      "entities": { ... },  // P&L, BS, CF grids per entity
      "corkscrews": { ... },
      "summary": {
        "min_dscr": 1.19,
        "balance_sheet_balanced": true,
        "cf_ties_to_bs": true,
        "facility_utilization": 0.87
      }
    },
    // ... base + upside runs
  ]
}
```

The frontend caches this entire response in state. The grid immediately renders the Base (Management) run. The bottom strip updates: "Balanced ✓ | DSCR: 1.19x (amber) | Facility: 87% drawn | Calculated just now."

A warning toast appears: "DSCR drops to 1.19x at period 12 when Target B closes."

Tristan can now switch between operating scenarios using the dropdown — the grid re-renders from the cached response without any new API call.

---

## Scene 7: Reviewing the Output

Tristan clicks through the entity tabs:

**SPV-A: New North (P&L tab):** Full 120-period grid with revenue starting at period 0. Revenue grows at 2% monthly. Debt service lines show facility interest + seller note interest. EBITDA row visible. All cells have values from period 0 onward.

**SPV-B: Target B (P&L tab):** Periods 0-11 are grayed out — the entity doesn't exist yet. A small flag icon appears on the Period 12 column header. Revenue begins at period 12, seeded from the deal's reported_revenue / 12. The grid visually communicates the staged acquisition.

**Consolidated (P&L tab):** Shows the platform-level aggregate. The Revenue section only shows `revenue_type = 'client'` lines. An info callout explains: "Platform Revenue reflects external client revenue only." The DSCR row at the bottom shows the blended portfolio DSCR, which dips at period 12 (amber background) and recovers by period 15.

**Intermediate HoldCo (Balance Sheet tab):** Shows the consolidated debt, goodwill from all acquisitions, and equity. A green checkmark on every period confirms the balance sheet is balanced. At period 12, a new step-up in goodwill and debt is visible when Target B closes.

---

## Scene 8: Taking a Snapshot

Tristan wants to freeze the Sources & Uses exhibit for the Agency B close to include in his lender package. He clicks the camera icon on the Target B deal marker (period 12) on the Acquisition Timeline.

The Snapshot Modal opens, pre-populated:
- Period: "January 2026 — Period 12"
- Scenario: Senior Debt + Seller Notes × Base (Management)
- Name: "Target B Close — Jan 2026"

The four exhibit tabs load from the snapshot endpoint:
- **Sources & Uses:** Purchase price, transaction costs, WC reserve vs. facility tranche, seller note, target cash, investor equity. Balanced ✓. Cumulative facility utilization: 74.1%.
- **DSCR:** Portfolio EBITDA $208K/mo, debt service $148K/mo, DSCR 1.40x (above 1.25x ✓). Downside: 1.11x (above 1.00x ✓).
- **Debt State:** Facility balance $6.19M, Seller Note A $487K, Seller Note B $350K, Total $7.03M.
- **Balance Sheet:** Full BS snapshot at period 12.

He clicks "Save Snapshot." A small bookmark icon now appears on the timeline below the Target B marker.

**Backend:** POST `/api/models/:modelId/snapshot` with `{ periodIndex: 12, scenarioId, operatingScenarioId, save: true, name: "Target B Close — Jan 2026" }`. Reads from persisted output tables, assembles exhibit data, writes to `model_snapshots` with JSONB data and a `model_version_hash`.

---

## Scene 9: Setting Up the Cap Table

Tristan clicks the SPV-A entity tab, then the "Cap Table" sub-tab.

He adds equity parties:
1. Tristan Pelligrino — Sponsor — 60% base — 20% carry — 8% hurdle — $739,500 committed — Funded
2. Business Partner — Partner — 40% base — 0% carry — 0% hurdle — $492,500 committed — Funded

The running total shows "100% ✓." He repeats for SPV-B and SPV-C with different ownership splits.

**Backend:** POST to `/api/models/:modelId/entities/:entityId/equity` for each party.

---

## Scene 10: Adding Exit Events

Tristan clicks the Liquidity Event panel (accessible from top bar or sidebar within ModelBuilder).

He adds three events:
1. **Month 36 Full Exit** — exit_type: full_exit, period 35, exit multiples: 6x / 7x / 8x
2. **Month 60 Full Exit** — exit_type: full_exit, period 59, exit multiples: 6.5x / 7x / 7.5x
3. **Month 36 Recap** — exit_type: recapitalization, period 35, recap_leverage_multiple: 5.0x, refi_costs: 2%

The comparison table renders showing all three events side by side with proceeds per party, MOIC, and IRR. This is the hero output — it shows Tristan (and eventually investors) exactly what each exit scenario means for their returns.

**Backend:** POST to create events. GET `/api/models/:modelId/liquidity-event/:scenarioId/:operatingScenarioId` to compute waterfall results. The waterfall calculation runs in memory (no DB writes) and returns per-party results including XIRR.

---

## Scene 11: Publishing for Investors

Tristan is satisfied with the model. He clicks "Publish." The Publish Modal opens.

- Version Name: "Initial Model"
- Version Notes: "Three-agency roll-up. Senior facility $8.5M. Staged closings at months 0, 12, 18."
- Featured Scenario: Senior Debt + Seller Notes
- Featured Operating Scenario: Base (Management)
- Notify Investors: ✓ (checked)

He clicks "Publish." The modal shows progress: "Publishing version 1... Running engine... Saving output... Done!"

**Backend:** POST `/api/models/:modelId/publish`:
1. Runs the full engine (same as calculate)
2. Freezes ALL output as JSONB into `model_published_versions`:
   - `pl_output`: complete P&L for all entities × scenarios × 120 periods
   - `bs_output`: complete balance sheets
   - `cf_output`: complete cash flows
   - `corkscrew_output`: all debt instruments
   - `covenant_output`: compliance data
   - `waterfall_output`: exit event results per party
   - `key_metrics`: summary metrics (DSCR, MOIC, IRR per party)
   - `input_snapshot`: frozen copy of all model inputs (for version diffing)
3. Sets `is_current = true`, prior versions to `false`
4. Creates `model_calculate_runs` row
5. Since notifyInvestors = true, queues notification emails (but there are no viewers yet)

---

## Scene 12: Inviting an Investor

Tristan clicks "Share." The Share Panel slides in.

He enters: investor@familyoffice.com, Role: Viewer, and clicks "Invite."

**Backend:** POST `/api/models/:modelId/access` with `{ email: "investor@familyoffice.com", role: "viewer" }`:
1. Checks if a profile exists for this email
2. If not: creates an `authorized_emails` entry + sends invite email with signup link
3. If yes: creates `model_access` row + sends notification email
4. The email says: "Tristan Pelligrino shared a financial model with you. [View Model →]"

The Share Panel now shows:
```
Tristan Pelligrino     Owner
investor@familyoffice.com    Viewer    Invited just now
```

---

## Scene 13: The Investor Experience

The investor receives the email, clicks the link, signs up (or logs in), and lands on `/models/:modelId/view`.

They see the Investor View:

**Top bar:** "AEO Roll-Up 2025" | Version 1 — Initial Model | Published Mar 7, 2026

**Summary cards:**
- Platform EBITDA: $5.5M | Companies: 3 | Hold: 36mo | Min DSCR: 1.71x
- Your Position: SPV-B | 20% base | $750,000 committed | MOIC: 5.1x | IRR: 43%

**P&L Drill-Down tab:** The full 120-column frozen grid. They can scroll horizontally through all periods. Columns before period 12 for their SPV (Target B) are grayed out. They can switch between entities using tabs above the grid.

**Exit Scenarios tab:** Shows their specific returns across all exit events:
```
                    MONTH 36 EXIT    MONTH 60 EXIT    MONTH 36 RECAP
Your gross return:  $3.85M           $6.65M           $2.05M dividend
Your MOIC:          5.1x             8.9x             2.7x partial
Your IRR:           43%              38%              —
```

**Documents tab:** Shows the saved snapshot ("Target B Close — Jan 2026") with View and PDF download buttons.

Everything the investor sees comes from the published version JSONB — never from live model data. The investor can never see draft state.

---

## Scene 14: Updating and Re-Publishing

Two weeks later, Tristan revises the model. He reduces Agency A's purchase price to $4.8M based on QoE findings and lowers the facility rate to 8.75%.

He makes the changes (PATCH to deal scenario terms and scenario endpoints), then clicks "Run Model" to see the impact. The DSCR improves. He's satisfied.

He clicks "Publish" again:
- Version Name: "Post-QoE Updated"
- Version Notes: "Revised Agency A purchase price to $4.8M. Updated facility rate to 8.75%."
- Notify Investors: ✓

**Backend:** Creates Version 2. Sends notification email to the investor:
```
Subject: Model Updated — AEO Roll-Up 2025 (Version 2)

What changed: "Revised Agency A purchase price..."

Your projected return:
  Previous version: 4.5x MOIC, 38% IRR
  This version:     5.1x MOIC, 43% IRR
```

The investor logs in and sees Version 2 as the default. They click "Compare Versions" to see Version 1 vs Version 2 side by side — the input diff shows the price and rate changes, the metric impact shows improved returns.

---

## Scene 15: Staleness Detection

If Tristan modifies model inputs (changes a line item, updates a driver) but does NOT re-run the model, the UI shows a subtle indicator near the Run Model button: "Inputs changed since last run — Run Model to update."

If he opens a saved snapshot after modifying inputs, the snapshot compares its stored `model_version_hash` against the latest `model_calculate_runs.model_version_hash`. If they differ, a banner appears:
```
Model updated since snapshot saved (March 6, 2026).
This exhibit may no longer reflect current model assumptions.
[ Refresh Snapshot ]  [ Keep As-Is ]
```

"Refresh Snapshot" re-runs the snapshot endpoint and overwrites the JSONB. "Keep As-Is" dismisses the banner.

---

This completes the full user journey. The Models module transforms the Deal Room from a diligence management tool into a complete M&A financial modeling platform — from model creation through investor-facing output.