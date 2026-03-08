# Lovable Prompt: Model Builder UI Fixes

## Context
The Model Builder page (`/models/:modelId`) is functional but has three gaps that block the core workflow. The backend APIs for all of these already exist.

---

## Fix 1: Add "Create Target Entity" Flow

### Problem
The "Add Deal to Model" dialog has a "Target Entity (SPV)" dropdown, but it's always empty because there's no way to create target entities in the UI. The 4 singleton entities (Aragon Holdings, MiD Holdings, Intermediate HoldCo, Consolidated) are auto-created on model creation, but acquisition target SPVs must be created by the user before linking deals.

### Backend API
```
POST /api/models/:modelId/entities
Body: { entity_type: "spv", entity_name: "Caprock Creative SPV", close_period_index: 3 }
Response: full entity object

GET /api/models/:modelId/entities
Response: array of all entities (use entity_type filter for dropdowns)

DELETE /api/models/:modelId/entities/:entityId
Response: { success: true }
```

### Suggested UX
**Option A (inline in Add Deal dialog):** Add a "+ New Target Entity" link below the Target Entity dropdown. Clicking it expands an inline form with:
- Entity name (text input, e.g., "Caprock Creative SPV")
- Entity type is auto-set to `spv`
- Close period index (derived from the Close Date picker already in the dialog)
After creation, auto-select the new entity in the dropdown.

**Option B (separate entity management):** Add an "Entities" section to the acquisition timeline area at the top of the page. Show existing entities as cards/chips. Include a "+ Add Entity" button that opens a small dialog:
- Entity name
- Entity type (dropdown: SPV, Target, Intermediate HoldCo)
- Close date (optional, can be set later)

Option A is probably better for the initial flow since the user is already in the "Add Deal" context.

### Important
- Only show entities with `entity_type` in `['spv', 'target']` in the "Target Entity (SPV)" dropdown — exclude aragon, consolidated, mid_holdco, intermediate_holdco.
- The `close_period_index` should be calculated from the Close Date relative to the model's `start_date`. For example, if model starts 2026-05-01 and close date is 2026-08-01, `close_period_index` = 3.

---

## Fix 2: Add Scenario Selectors to Header

### Problem
The model supports multiple capital structure scenarios (e.g., "Base Case", "Conservative") and operating scenarios (e.g., "Downside", "Base", "Upside"). The backend creates these on model creation and the engine runs all combinations. But the UI has no way to select which scenario combo to view — only the granularity dropdown (Monthly) is visible.

### Backend API
Scenarios and operating scenarios are included in the model detail response:
```
GET /api/models/:modelId
Response includes:
  model_scenarios: [{ id, name, is_base_case }]
  model_operating_scenarios: [{ id, name, case_type, is_default }]
```

### Suggested UX
Add two dropdown selectors in the header toolbar, between the model name and the action buttons:
1. **Capital Scenario** dropdown — populated from `model_scenarios`. Default: the one with `is_base_case: true`.
2. **Operating Scenario** dropdown — populated from `model_operating_scenarios`. Default: the one with `is_default: true`.

When either changes, re-fetch the P&L/BS/CF data for that scenario combo. The calculate endpoint accepts `scenarioIds` and `operatingScenarioIds` in the request body, and the output tables (`model_values`, `model_balance_sheet_values`, `model_cf_values`) are keyed by `scenario_id` + `operating_scenario_id`.

Layout suggestion: `[← AEO Roll-up 2026] [Base Case ▾] [Base ▾] [Monthly ▾] [▶ Run Model] [$ Structure] ...`

---

## Fix 3: Populate Target Entity Dropdown in Add Deal Dialog

### Problem
Even after Fix 1 is implemented, the "Target Entity (SPV)" dropdown in the Add Deal dialog needs to be wired up.

### Implementation
When the Add Deal dialog opens:
1. Fetch `GET /api/models/:modelId/entities`
2. Filter to `entity_type` in `['spv', 'target']`
3. Populate the dropdown with `entity_name` as label, `entity.id` as value
4. If no SPV/target entities exist, show a message: "No target entities yet. Create one first." with a link/button to create one (ties into Fix 1).

---

## Summary of Backend Endpoints Already Available
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/models/:modelId/entities` | GET | List all entities |
| `/api/models/:modelId/entities` | POST | Create new entity |
| `/api/models/:modelId/entities/:id` | PATCH | Update entity |
| `/api/models/:modelId/entities/:id` | DELETE | Delete entity |
| `/api/models/:modelId` | GET | Model detail with scenarios + entities |
| `/api/models/:modelId/deal-references` | POST | Link deal to entity |
