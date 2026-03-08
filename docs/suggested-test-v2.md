# Financial Modeling Module — User Test Script (v2)

> **Corrections from backend review (Claude Code, 2026-03-08):**
>
> 1. **Step 12 edge case updated:** The original script expected a "No user found" error when granting access to a non-existent email. The backend now implements an **invite flow** — inserting into `authorized_emails` and firing an n8n webhook with a signup link. The response is `{ success: true, pending: true }`, not a 404. This matches how deal invites already work in the platform.
>
> 2. **Step 13 (Version Compare) clarified:** There is no dedicated backend compare endpoint. The `model_published_versions` table stores full JSONB output per version, so comparison should be implemented client-side by fetching two versions via `GET /api/models/:modelId/versions/:versionId` and diffing the `key_metrics` / statement outputs. The backend fully supports this — it's a frontend-only feature.
>
> 3. **Steps 14–16 added:** The original script omitted testing for PATCH/DELETE on published versions, the `investor_visible` filter for viewer-role users, and auto-incrementing version numbers. These are all backend-supported features that should be exercised.

---

### **Pre-requisite**
Log in as Tristan (admin) → navigate to `/models`

---

### **1. Create a Model**
- Click "New Model" → fill in name, start date, period type (monthly), period count (e.g., 60)
- ✅ Model appears in list → click to open ModelBuilder

### **2. Entity & Timeline Setup**
- Add a HoldCo entity and 1–2 target entities via the Acquisition Timeline
- Set close dates for targets
- ✅ Entities appear in the entity selector; grayed-out pre-close periods in the grid

### **3. Add a Deal Reference**
- Click "Add Deal" → link an existing deal to a target entity
- Set close period, toggle pull flags (revenue/EBITDA/asking price)
- ✅ Deal data seeds into the Sources & Uses panel

### **4. Configure Scenarios**
- Create a base-case capital scenario (facility size, rate, term)
- Add an operating scenario (e.g., "Downside")
- ✅ Scenario selectors in the header update; grid reflects selected combo

### **5. Line Items & Drivers**
- Open P&L tab → add revenue/expense line items for a target entity
- Open Drivers panel → add revenue_growth, gross_margin drivers with period ranges
- ✅ Values populate across periods in the spreadsheet grid

### **6. Deal Structure (Sources & Uses)**
- Open the Deal Structure panel for a target
- Set purchase price, seller note terms, earnout terms
- ✅ S&U table balances (Total Sources = Total Uses)

### **7. Covenant Compliance**
- Open Covenant Dashboard → add a DSCR covenant (e.g., min 1.25x)
- ✅ Compliance indicators show per-period pass/fail

### **8. Financial Statements**
- Switch between P&L / BS / CF / Waterfall tabs
- Toggle granularity: Monthly → Quarterly → Annual
- ✅ Numbers aggregate correctly; BS shows "Balanced ✓"; CF shows "Ties to BS ✓"

### **9. Snapshots**
- Click "Snapshot" → select type (IC Memo), name it, save
- ✅ Snapshot appears in the list with correct data capture

### **10. Liquidity Event**
- Click "Exit" → configure exit multiples (bear/base/bull), trailing periods
- ✅ Waterfall preview shows IRR, MOIC, seller proceeds

### **11. Publish**
- Click "Publish" → enter version name & notes → publish
- ✅ Status bar shows "Published version up to date"
- Change a driver value → ✅ Status bar shows "Stale — republish recommended"
- **How staleness works:** The backend stores a `model_inputs_hash` (SHA-256 of all inputs) on each published version. The frontend should recompute or compare this hash after edits to determine staleness. There is no push notification for this — it's a client-side check.

### **12. Share & Investor View**
- Click "Share" → grant access to an existing user's email
- ✅ User appears in the access list with viewer role
- Grant access to a **non-existent email** →
  - ✅ Response: `{ success: true, message: "Invitation sent", pending: true }`
  - ✅ Invite email is sent via n8n webhook with signup link
  - ✅ **Not** a 404 error — the backend creates an `authorized_emails` entry and sends the invite
- Log in as the granted user → open the model link
- ✅ Read-only InvestorView loads with KPIs and tabbed statements

### **13. Version Compare**
- Publish a second version after changes
- Click "Compare" → select v1 vs v2
- ✅ Metric deltas display with color-coded trend arrows
- **Implementation note:** There is no backend compare endpoint. Fetch both versions via `GET /api/models/:modelId/versions/:versionId` — each contains full `key_metrics`, `pl_output`, `bs_output`, `cf_output`, and `waterfall_output` as JSONB. Diff these client-side.

### **14. Edit & Delete Published Versions**
- Select a published version → edit its name and notes
  - `PATCH /api/models/:modelId/versions/:versionId` with `{ version_name, version_notes }`
  - ✅ Updated metadata reflects immediately
- Toggle `investor_visible` to false on a version
  - ✅ Version disappears from the investor/viewer's list but remains visible to editors/owners
- Delete a published version (owner only)
  - ✅ If the deleted version was `is_current`, the next most recent version is auto-promoted to current

### **15. Version Numbering**
- Publish 3 versions in sequence
- ✅ Version numbers auto-increment: v1, v2, v3
- Delete v2 → publish again → ✅ New version is v4 (numbers never recycle)

### **16. Investor Visibility Filtering**
- As an editor: see all versions (including `investor_visible: false`)
- As a viewer: only see versions where `investor_visible: true`
- ✅ `GET /api/models/:modelId/versions` filters automatically based on the user's role

---

### **Edge Cases to Probe**
- Create a model with 0 entities → try publishing → should fail gracefully (no scenarios/entities)
- Grant access to a non-existent email → ✅ Invite sent (not an error)
- Rapidly toggle granularity while data loads → no crashes
- Publish with `notifyInvestors: true` → verify n8n webhook fires for each viewer
- Delete the only published version → ✅ No version is current (graceful empty state)
