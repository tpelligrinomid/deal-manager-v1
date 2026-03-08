-- Migration: M&A Financial Modeling Module
-- Description: Phase 1 schema for multi-deal roll-up acquisition modeling
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Extend deal_status enum with 'pipeline'
-- ============================================

ALTER TYPE deal_status ADD VALUE IF NOT EXISTS 'pipeline';

-- ============================================
-- 2. mid_baseline — org-level MiD financial baseline
-- ============================================

CREATE TABLE IF NOT EXISTS mid_baseline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 3. mid_baseline_entities
-- ============================================

CREATE TABLE IF NOT EXISTS mid_baseline_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id UUID NOT NULL REFERENCES mid_baseline(id) ON DELETE CASCADE,
  entity_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. financial_models — top-level model object
-- ============================================

CREATE TABLE IF NOT EXISTS financial_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  period_count INTEGER NOT NULL DEFAULT 120,
  period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type = 'monthly'),
  profit_metric TEXT NOT NULL DEFAULT 'ebitda' CHECK (profit_metric IN ('ebitda', 'sde')),
  presentation_granularity TEXT NOT NULL DEFAULT 'monthly' CHECK (presentation_granularity IN ('monthly', 'quarterly', 'annual')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 5. model_access — multi-user access control
-- ============================================

CREATE TABLE IF NOT EXISTS model_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, profile_id)
);

-- ============================================
-- 6. model_entities — entity tree within a model
-- ============================================

CREATE TABLE IF NOT EXISTS model_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('aragon', 'mid_holdco', 'intermediate_holdco', 'spv', 'target', 'consolidated')),
  entity_name TEXT NOT NULL,
  parent_entity_id UUID REFERENCES model_entities(id) ON DELETE SET NULL,
  close_period_index INTEGER,
  baseline_id UUID REFERENCES mid_baseline(id) ON DELETE SET NULL,
  inherit_baseline BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- Singleton constraint: only one aragon/mid_holdco/intermediate_holdco/consolidated per model
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_entities_singleton
  ON model_entities (model_id, entity_type)
  WHERE entity_type IN ('aragon', 'mid_holdco', 'intermediate_holdco', 'consolidated');

-- ============================================
-- 7. model_scenarios — deal structure scenarios
-- ============================================

CREATE TABLE IF NOT EXISTS model_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_base_case BOOLEAN NOT NULL DEFAULT false,
  -- Facility-level terms
  total_facility_size NUMERIC,
  initial_tranche_amount NUMERIC,
  facility_rate NUMERIC,
  facility_term_months INTEGER,
  facility_io_months INTEGER,
  facility_deferred_months INTEGER,
  facility_pik BOOLEAN DEFAULT false,
  facility_balloon_month INTEGER,
  -- Default per-deal terms
  default_seller_note_rate NUMERIC,
  default_seller_note_term_months INTEGER,
  default_seller_note_io_months INTEGER,
  default_seller_note_deferred_months INTEGER,
  default_seller_note_pik BOOLEAN DEFAULT false,
  default_earnout_is_equity_instrument BOOLEAN DEFAULT false,
  -- Equity at close
  equity_from_investors NUMERIC,
  equity_from_aragon NUMERIC,
  equity_from_other NUMERIC,
  -- Other
  management_fee_monthly NUMERIC,
  exit_transaction_costs_pct NUMERIC DEFAULT 0.04,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(model_id, name)
);

-- ============================================
-- 8. model_operating_scenarios
-- ============================================

CREATE TABLE IF NOT EXISTS model_operating_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  case_type TEXT NOT NULL CHECK (case_type IN ('downside', 'base', 'upside')),
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(model_id, case_type)
);

-- ============================================
-- 9. model_deal_references — junction: models ↔ deals
-- ============================================

CREATE TABLE IF NOT EXISTS model_deal_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id),  -- NO CASCADE: prevent silent model corruption
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  close_date DATE NOT NULL,
  close_period_index INTEGER NOT NULL CHECK (close_period_index >= 0),
  pull_reported_revenue BOOLEAN NOT NULL DEFAULT true,
  pull_reported_ebitda BOOLEAN NOT NULL DEFAULT true,
  pull_asking_price BOOLEAN NOT NULL DEFAULT true,
  seed_overridden BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(model_id, entity_id)
);

-- ============================================
-- 10. model_deal_scenario_terms — per-deal, per-scenario terms
-- ============================================

CREATE TABLE IF NOT EXISTS model_deal_scenario_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_deal_reference_id UUID NOT NULL REFERENCES model_deal_references(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  purchase_price NUMERIC,
  transaction_costs NUMERIC,
  working_capital_reserve NUMERIC,
  equity_from_target_balance NUMERIC,
  tranche_amount NUMERIC,
  seller_note_amount NUMERIC,
  seller_note_rate NUMERIC,
  seller_note_term_months INTEGER,
  seller_note_io_months INTEGER,
  seller_note_deferred_months INTEGER,
  seller_note_pik BOOLEAN,
  earnout_amount NUMERIC,
  earnout_threshold NUMERIC,
  earnout_cap NUMERIC,
  earnout_period_months INTEGER,
  earnout_is_equity_instrument BOOLEAN,
  seller_equity_rollover_pct NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(model_deal_reference_id, scenario_id)
);

-- ============================================
-- 11. model_segments — revenue segments per entity
-- ============================================

CREATE TABLE IF NOT EXISTS model_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  segment_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 12. model_line_items — P&L / BS / CF line item definitions
-- ============================================

CREATE TABLE IF NOT EXISTS model_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES model_segments(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('revenue', 'cogs', 'expense', 'debt_service', 'earnout')),
  revenue_type TEXT CHECK (revenue_type IN ('client', 'referral', 'management')),
  statement TEXT NOT NULL CHECK (statement IN ('pl', 'bs', 'cf')),
  group_name TEXT NOT NULL,
  item_name TEXT NOT NULL,
  growth_type TEXT CHECK (growth_type IN ('organic', 'inorganic')),
  item_type TEXT NOT NULL CHECK (item_type IN ('fixed', 'growth_rate', 'driver_derived', 'manual')),
  growth_rate NUMERIC,
  base_amount NUMERIC,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_system_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 13. model_drivers — working capital and growth drivers
-- ============================================

CREATE TABLE IF NOT EXISTS model_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  operating_scenario_id UUID REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  driver_type TEXT NOT NULL,
  value NUMERIC NOT NULL,
  period_start INTEGER NOT NULL DEFAULT 0,
  period_end INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  UNIQUE(entity_id, operating_scenario_id, driver_type, period_start)
);

-- ============================================
-- 14. model_values — P&L output per period (reinstated)
-- ============================================

CREATE TABLE IF NOT EXISTS model_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id UUID NOT NULL REFERENCES model_line_items(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL CHECK (period_index >= 0),
  amount NUMERIC NOT NULL DEFAULT 0,
  is_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(line_item_id, scenario_id, operating_scenario_id, period_index)
);

-- ============================================
-- 15. model_debt_corkscrews — per-instrument debt schedule (reinstated)
-- ============================================

CREATE TABLE IF NOT EXISTS model_debt_corkscrews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  instrument_name TEXT NOT NULL,
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('facility', 'seller_note', 'revolver')),
  start_period_index INTEGER NOT NULL DEFAULT 0,
  period_index INTEGER NOT NULL CHECK (period_index >= 0),
  beginning_balance NUMERIC NOT NULL DEFAULT 0,
  new_borrowings NUMERIC NOT NULL DEFAULT 0,
  cash_interest NUMERIC NOT NULL DEFAULT 0,
  pik_interest NUMERIC NOT NULL DEFAULT 0,
  cash_principal NUMERIC NOT NULL DEFAULT 0,
  balloon_payment NUMERIC NOT NULL DEFAULT 0,
  ending_balance NUMERIC NOT NULL DEFAULT 0,
  current_portion NUMERIC NOT NULL DEFAULT 0,
  lt_portion NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, scenario_id, entity_id, instrument_name, period_index)
);

-- ============================================
-- 16. model_balance_sheet_values — wide row per period (reinstated)
-- ============================================

CREATE TABLE IF NOT EXISTS model_balance_sheet_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL CHECK (period_index >= 0),
  -- Assets
  cash NUMERIC NOT NULL DEFAULT 0,
  accounts_receivable NUMERIC NOT NULL DEFAULT 0,
  prepaid_expenses NUMERIC NOT NULL DEFAULT 0,
  other_current_assets NUMERIC NOT NULL DEFAULT 0,
  goodwill NUMERIC NOT NULL DEFAULT 0,
  other_intangibles NUMERIC NOT NULL DEFAULT 0,
  fixed_assets_net NUMERIC NOT NULL DEFAULT 0,
  other_lt_assets NUMERIC NOT NULL DEFAULT 0,
  total_assets NUMERIC NOT NULL DEFAULT 0,
  -- Liabilities
  accounts_payable NUMERIC NOT NULL DEFAULT 0,
  accrued_expenses NUMERIC NOT NULL DEFAULT 0,
  current_portion_ltd NUMERIC NOT NULL DEFAULT 0,
  other_current_liabilities NUMERIC NOT NULL DEFAULT 0,
  long_term_debt NUMERIC NOT NULL DEFAULT 0,
  other_lt_liabilities NUMERIC NOT NULL DEFAULT 0,
  total_liabilities NUMERIC NOT NULL DEFAULT 0,
  -- Equity
  contributed_capital NUMERIC NOT NULL DEFAULT 0,
  retained_earnings NUMERIC NOT NULL DEFAULT 0,
  total_equity NUMERIC NOT NULL DEFAULT 0,
  -- Validation
  is_balanced BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, entity_id, scenario_id, operating_scenario_id, period_index)
);

-- ============================================
-- 17. model_cf_values — indirect cash flow per period (reinstated)
-- ============================================

CREATE TABLE IF NOT EXISTS model_cf_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL CHECK (period_index >= 0),
  -- Operating activities
  net_income NUMERIC NOT NULL DEFAULT 0,
  depreciation_amortization NUMERIC NOT NULL DEFAULT 0,
  change_in_ar NUMERIC NOT NULL DEFAULT 0,
  change_in_ap NUMERIC NOT NULL DEFAULT 0,
  change_in_prepaid NUMERIC NOT NULL DEFAULT 0,
  change_in_accrued NUMERIC NOT NULL DEFAULT 0,
  other_operating NUMERIC NOT NULL DEFAULT 0,
  cash_from_operations NUMERIC NOT NULL DEFAULT 0,
  -- Investing activities
  capex NUMERIC NOT NULL DEFAULT 0,
  acquisitions NUMERIC NOT NULL DEFAULT 0,
  other_investing NUMERIC NOT NULL DEFAULT 0,
  cash_from_investing NUMERIC NOT NULL DEFAULT 0,
  -- Financing activities
  debt_proceeds NUMERIC NOT NULL DEFAULT 0,
  debt_repayment NUMERIC NOT NULL DEFAULT 0,
  equity_contributions NUMERIC NOT NULL DEFAULT 0,
  dividends NUMERIC NOT NULL DEFAULT 0,
  other_financing NUMERIC NOT NULL DEFAULT 0,
  cash_from_financing NUMERIC NOT NULL DEFAULT 0,
  -- Summary
  net_change_in_cash NUMERIC NOT NULL DEFAULT 0,
  beginning_cash NUMERIC NOT NULL DEFAULT 0,
  ending_cash NUMERIC NOT NULL DEFAULT 0,
  -- Validation
  ties_to_bs BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(model_id, entity_id, scenario_id, operating_scenario_id, period_index)
);

-- ============================================
-- 18. model_spv_equity — per-SPV cap table
-- ============================================

CREATE TABLE IF NOT EXISTS model_spv_equity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  party_name TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('sponsor', 'partner', 'lp', 'seller_rollover')),
  base_equity_pct NUMERIC NOT NULL,
  carry_pct NUMERIC NOT NULL DEFAULT 0,
  hurdle_rate_annual NUMERIC NOT NULL DEFAULT 0,
  contributed_capital NUMERIC NOT NULL DEFAULT 0,
  contribution_period_index INTEGER NOT NULL DEFAULT 0,
  commitment_status TEXT NOT NULL DEFAULT 'soft_circle' CHECK (commitment_status IN ('soft_circle', 'committed', 'funded')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 19. model_holdco_compensation — deal maker salary tiers
-- ============================================

CREATE TABLE IF NOT EXISTS model_holdco_compensation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  party_name TEXT NOT NULL,
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('deal_maker_salary', 'management_fee', 'board_fee')),
  amount_annual NUMERIC NOT NULL,
  period_start INTEGER NOT NULL DEFAULT 0,
  period_end INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 20. model_covenants — covenant definitions
-- ============================================

CREATE TABLE IF NOT EXISTS model_covenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  covenant_name TEXT NOT NULL,
  covenant_type TEXT NOT NULL CHECK (covenant_type IN ('dscr_min', 'leverage_max', 'cash_min', 'fixed_charge_min', 'custom')),
  threshold_value NUMERIC NOT NULL,
  measurement_frequency TEXT NOT NULL DEFAULT 'quarterly' CHECK (measurement_frequency IN ('monthly', 'quarterly', 'annual')),
  measurement_basis TEXT NOT NULL DEFAULT 'trailing_12' CHECK (measurement_basis IN ('trailing_12', 'trailing_3', 'point_in_time')),
  cure_period_days INTEGER DEFAULT 30,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 21. model_covenant_results — engine-written compliance data
-- ============================================

CREATE TABLE IF NOT EXISTS model_covenant_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  covenant_id UUID NOT NULL REFERENCES model_covenants(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL CHECK (period_index >= 0),
  measured_value NUMERIC NOT NULL,
  threshold_value NUMERIC NOT NULL,
  is_compliant BOOLEAN NOT NULL,
  headroom NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 22. model_liquidity_events — exit / recap events
-- ============================================

CREATE TABLE IF NOT EXISTS model_liquidity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  exit_type TEXT NOT NULL DEFAULT 'full_exit' CHECK (exit_type IN ('full_exit', 'recapitalization', 'partial_sale')),
  event_name TEXT,
  event_period_index INTEGER NOT NULL DEFAULT 35,
  profit_metric TEXT CHECK (profit_metric IN ('ebitda', 'sde')),
  trailing_periods INTEGER NOT NULL DEFAULT 12,
  exit_multiple_low NUMERIC,
  exit_multiple_base NUMERIC,
  exit_multiple_high NUMERIC,
  exit_transaction_costs_pct NUMERIC DEFAULT 0.04,
  recap_leverage_multiple NUMERIC,
  recap_refi_costs_pct NUMERIC,
  recap_new_facility_term_months INTEGER,
  ebitda_allocation_method TEXT DEFAULT 'ebitda_contribution' CHECK (ebitda_allocation_method IN ('ebitda_contribution', 'acquisition_cost')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 23. model_snapshots — frozen point-in-time exhibits
-- ============================================

CREATE TABLE IF NOT EXISTS model_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  period_index INTEGER NOT NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('close', 'freeform', 'covenant_certificate')),
  deal_reference_id UUID REFERENCES model_deal_references(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  notes TEXT,
  sources_uses JSONB NOT NULL DEFAULT '{}'::jsonb,
  dscr_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  debt_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  balance_sheet JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version_hash TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 24. coa_imports — chart of accounts mapping
-- ============================================

CREATE TABLE IF NOT EXISTS coa_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES model_entities(id) ON DELETE CASCADE,
  source_account_code TEXT,
  source_account_name TEXT,
  source_account_type TEXT,
  mapped_group_name TEXT,
  mapped_item_name TEXT,
  mapped_segment_id UUID REFERENCES model_segments(id) ON DELETE SET NULL,
  mapped_category TEXT,
  historical_avg_monthly NUMERIC,
  accrual_adjustment_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 25. model_calculate_runs — audit trail
-- ============================================

CREATE TABLE IF NOT EXISTS model_calculate_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES profiles(id),
  scenario_ids UUID[] NOT NULL,
  operating_scenario_ids UUID[] NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  passed BOOLEAN NOT NULL DEFAULT false,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  model_version_hash TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================
-- 26. model_published_versions — immutable investor-facing output
-- ============================================

CREATE TABLE IF NOT EXISTS model_published_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_name TEXT NOT NULL,
  version_notes TEXT,
  published_by UUID NOT NULL REFERENCES profiles(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scenario_id UUID NOT NULL REFERENCES model_scenarios(id) ON DELETE CASCADE,
  operating_scenario_id UUID NOT NULL REFERENCES model_operating_scenarios(id) ON DELETE CASCADE,
  model_inputs_hash TEXT NOT NULL,
  pl_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  bs_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  cf_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  corkscrew_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  covenant_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  waterfall_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  key_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT false,
  investor_visible BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(model_id, version_number)
);

-- ============================================
-- 27. model_version_access — per-version access overrides
-- ============================================

CREATE TABLE IF NOT EXISTS model_version_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES model_published_versions(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES profiles(id),
  UNIQUE(version_id, profile_id)
);

-- ============================================
-- 28. model_access_log — investor engagement tracking
-- ============================================

CREATE TABLE IF NOT EXISTS model_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES financial_models(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  version_id UUID REFERENCES model_published_versions(id) ON DELETE SET NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_spent_seconds INTEGER
);

-- ============================================
-- 29. Row Level Security — enable on all tables
-- ============================================

ALTER TABLE mid_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE mid_baseline_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_operating_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_deal_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_deal_scenario_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_debt_corkscrews ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_balance_sheet_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_cf_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_spv_equity ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_holdco_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_covenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_covenant_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_liquidity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_calculate_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_published_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_version_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_access_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 29a. RLS: mid_baseline — any authenticated user can view
-- ============================================

CREATE POLICY "Team can manage baselines" ON mid_baseline
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Authenticated users can view active baselines" ON mid_baseline
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- 29b. RLS: mid_baseline_entities
-- ============================================

CREATE POLICY "Team can manage baseline entities" ON mid_baseline_entities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Authenticated users can view baseline entities" ON mid_baseline_entities
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- 29c. RLS: financial_models
-- ============================================

CREATE POLICY "Team can manage all models" ON financial_models
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view models they have access to" ON financial_models
  FOR SELECT USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = financial_models.id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own models" ON financial_models
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "Editors can update models" ON financial_models
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = financial_models.id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29d. RLS: model_access
-- ============================================

CREATE POLICY "Team can manage model access" ON model_access
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Model owners can manage access" ON model_access
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access ma
      WHERE ma.model_id = model_access.model_id AND ma.profile_id = auth.uid() AND ma.role = 'owner'
    )
  );

CREATE POLICY "Users can view own access" ON model_access
  FOR SELECT USING (profile_id = auth.uid());

-- ============================================
-- 29e. RLS: model_entities
-- ============================================

CREATE POLICY "Team can manage model entities" ON model_entities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view entities for accessible models" ON model_entities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_entities.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage entities" ON model_entities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_entities.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29f. RLS: model_scenarios
-- ============================================

CREATE POLICY "Team can manage scenarios" ON model_scenarios
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view scenarios for accessible models" ON model_scenarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_scenarios.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage scenarios" ON model_scenarios
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_scenarios.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29g. RLS: model_operating_scenarios
-- ============================================

CREATE POLICY "Team can manage operating scenarios" ON model_operating_scenarios
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view operating scenarios for accessible models" ON model_operating_scenarios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_operating_scenarios.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage operating scenarios" ON model_operating_scenarios
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_operating_scenarios.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29h. RLS: model_deal_references
-- ============================================

CREATE POLICY "Team can manage deal references" ON model_deal_references
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view deal references for accessible models" ON model_deal_references
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_deal_references.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage deal references" ON model_deal_references
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_deal_references.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29i. RLS: model_deal_scenario_terms
-- ============================================

CREATE POLICY "Team can manage deal scenario terms" ON model_deal_scenario_terms
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view deal scenario terms for accessible models" ON model_deal_scenario_terms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_deal_references mdr
      JOIN model_access ma ON ma.model_id = mdr.model_id
      WHERE mdr.id = model_deal_scenario_terms.model_deal_reference_id AND ma.profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage deal scenario terms" ON model_deal_scenario_terms
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_deal_references mdr
      JOIN model_access ma ON ma.model_id = mdr.model_id
      WHERE mdr.id = model_deal_scenario_terms.model_deal_reference_id AND ma.profile_id = auth.uid() AND ma.role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29j. RLS: model_segments (joins through model_entities)
-- ============================================

CREATE POLICY "Team can manage segments" ON model_segments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view segments for accessible models" ON model_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_segments.entity_id AND ma.profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage segments" ON model_segments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_segments.entity_id AND ma.profile_id = auth.uid() AND ma.role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29k. RLS: model_line_items
-- ============================================

CREATE POLICY "Team can manage line items" ON model_line_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view line items for accessible models" ON model_line_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_line_items.entity_id AND ma.profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage line items" ON model_line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_line_items.entity_id AND ma.profile_id = auth.uid() AND ma.role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29l. RLS: model_drivers (joins through model_entities)
-- ============================================

CREATE POLICY "Team can manage drivers" ON model_drivers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view drivers for accessible models" ON model_drivers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_drivers.entity_id AND ma.profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage drivers" ON model_drivers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_drivers.entity_id AND ma.profile_id = auth.uid() AND ma.role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29m. RLS: model_values (output table — team + model access)
-- ============================================

CREATE POLICY "Team can manage model values" ON model_values
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view values for accessible models" ON model_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_line_items mli
      JOIN model_entities me ON me.id = mli.entity_id
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE mli.id = model_values.line_item_id AND ma.profile_id = auth.uid()
    )
  );

-- ============================================
-- 29n. RLS: model_debt_corkscrews
-- ============================================

CREATE POLICY "Team can manage corkscrews" ON model_debt_corkscrews
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view corkscrews for accessible models" ON model_debt_corkscrews
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_debt_corkscrews.model_id AND profile_id = auth.uid()
    )
  );

-- ============================================
-- 29o. RLS: model_balance_sheet_values
-- ============================================

CREATE POLICY "Team can manage BS values" ON model_balance_sheet_values
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view BS values for accessible models" ON model_balance_sheet_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_balance_sheet_values.model_id AND profile_id = auth.uid()
    )
  );

-- ============================================
-- 29p. RLS: model_cf_values
-- ============================================

CREATE POLICY "Team can manage CF values" ON model_cf_values
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view CF values for accessible models" ON model_cf_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_cf_values.model_id AND profile_id = auth.uid()
    )
  );

-- ============================================
-- 29q. RLS: model_spv_equity (joins through model_entities)
-- ============================================

CREATE POLICY "Team can manage SPV equity" ON model_spv_equity
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view SPV equity for accessible models" ON model_spv_equity
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_spv_equity.entity_id AND ma.profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage SPV equity" ON model_spv_equity
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_entities me
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE me.id = model_spv_equity.entity_id AND ma.profile_id = auth.uid() AND ma.role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29r. RLS: model_holdco_compensation
-- ============================================

CREATE POLICY "Team can manage holdco compensation" ON model_holdco_compensation
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view holdco compensation for accessible models" ON model_holdco_compensation
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_holdco_compensation.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage holdco compensation" ON model_holdco_compensation
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_holdco_compensation.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29s. RLS: model_covenants
-- ============================================

CREATE POLICY "Team can manage covenants" ON model_covenants
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view covenants for accessible models" ON model_covenants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_covenants.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage covenants" ON model_covenants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_covenants.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29t. RLS: model_covenant_results
-- ============================================

CREATE POLICY "Team can manage covenant results" ON model_covenant_results
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view covenant results for accessible models" ON model_covenant_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_covenants mc
      JOIN model_access ma ON ma.model_id = mc.model_id
      WHERE mc.id = model_covenant_results.covenant_id AND ma.profile_id = auth.uid()
    )
  );

-- ============================================
-- 29u. RLS: model_liquidity_events
-- ============================================

CREATE POLICY "Team can manage liquidity events" ON model_liquidity_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view liquidity events for accessible models" ON model_liquidity_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_liquidity_events.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage liquidity events" ON model_liquidity_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_liquidity_events.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29v. RLS: model_snapshots
-- ============================================

CREATE POLICY "Team can manage snapshots" ON model_snapshots
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view snapshots for accessible models" ON model_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_snapshots.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can create snapshots" ON model_snapshots
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_snapshots.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29w. RLS: coa_imports
-- ============================================

CREATE POLICY "Team can manage COA imports" ON coa_imports
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view COA imports for accessible models" ON coa_imports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = coa_imports.model_id AND profile_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage COA imports" ON coa_imports
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = coa_imports.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================
-- 29x. RLS: model_calculate_runs
-- ============================================

CREATE POLICY "Team can manage calculate runs" ON model_calculate_runs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can view calculate runs for accessible models" ON model_calculate_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_calculate_runs.model_id AND profile_id = auth.uid()
    )
  );

-- ============================================
-- 29y. RLS: model_published_versions
-- ============================================

CREATE POLICY "Team can manage published versions" ON model_published_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Editors can publish versions" ON model_published_versions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_published_versions.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

CREATE POLICY "Users can view published versions for accessible models" ON model_published_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_published_versions.model_id AND profile_id = auth.uid()
    )
    AND (
      investor_visible = true
      OR EXISTS (
        SELECT 1 FROM model_access
        WHERE model_id = model_published_versions.model_id AND profile_id = auth.uid() AND role IN ('owner', 'editor')
      )
    )
  );

-- ============================================
-- 29z. RLS: model_version_access
-- ============================================

CREATE POLICY "Team can manage version access" ON model_version_access
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Owners can manage version access" ON model_version_access
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_published_versions mpv
      JOIN model_access ma ON ma.model_id = mpv.model_id
      WHERE mpv.id = model_version_access.version_id AND ma.profile_id = auth.uid() AND ma.role = 'owner'
    )
  );

CREATE POLICY "Users can view own version access" ON model_version_access
  FOR SELECT USING (profile_id = auth.uid());

-- ============================================
-- 29aa. RLS: model_access_log
-- ============================================

CREATE POLICY "Team can view all access logs" ON model_access_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Users can insert own access log" ON model_access_log
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can view own access log" ON model_access_log
  FOR SELECT USING (profile_id = auth.uid());

-- ============================================
-- 30. Indexes
-- ============================================

-- mid_baseline
CREATE INDEX IF NOT EXISTS idx_mid_baseline_active ON mid_baseline(is_active) WHERE is_active = true;

-- mid_baseline_entities
CREATE INDEX IF NOT EXISTS idx_mid_baseline_entities_baseline ON mid_baseline_entities(baseline_id);

-- financial_models
CREATE INDEX IF NOT EXISTS idx_financial_models_created_by ON financial_models(created_by);
CREATE INDEX IF NOT EXISTS idx_financial_models_created_at ON financial_models(created_at DESC);

-- model_access
CREATE INDEX IF NOT EXISTS idx_model_access_model ON model_access(model_id);
CREATE INDEX IF NOT EXISTS idx_model_access_profile ON model_access(profile_id);

-- model_entities
CREATE INDEX IF NOT EXISTS idx_model_entities_model ON model_entities(model_id);
CREATE INDEX IF NOT EXISTS idx_model_entities_parent ON model_entities(parent_entity_id);
CREATE INDEX IF NOT EXISTS idx_model_entities_baseline ON model_entities(baseline_id);
CREATE INDEX IF NOT EXISTS idx_model_entities_type ON model_entities(model_id, entity_type);

-- model_scenarios
CREATE INDEX IF NOT EXISTS idx_model_scenarios_model ON model_scenarios(model_id);

-- model_operating_scenarios
CREATE INDEX IF NOT EXISTS idx_model_operating_scenarios_model ON model_operating_scenarios(model_id);

-- model_deal_references
CREATE INDEX IF NOT EXISTS idx_model_deal_references_model ON model_deal_references(model_id);
CREATE INDEX IF NOT EXISTS idx_model_deal_references_deal ON model_deal_references(deal_id);
CREATE INDEX IF NOT EXISTS idx_model_deal_references_entity ON model_deal_references(entity_id);

-- model_deal_scenario_terms
CREATE INDEX IF NOT EXISTS idx_model_deal_scenario_terms_ref ON model_deal_scenario_terms(model_deal_reference_id);
CREATE INDEX IF NOT EXISTS idx_model_deal_scenario_terms_scenario ON model_deal_scenario_terms(scenario_id);

-- model_segments
CREATE INDEX IF NOT EXISTS idx_model_segments_entity ON model_segments(entity_id);

-- model_line_items
CREATE INDEX IF NOT EXISTS idx_model_line_items_entity ON model_line_items(entity_id);
CREATE INDEX IF NOT EXISTS idx_model_line_items_scenario ON model_line_items(scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_line_items_op_scenario ON model_line_items(operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_line_items_segment ON model_line_items(segment_id);
CREATE INDEX IF NOT EXISTS idx_model_line_items_category ON model_line_items(entity_id, category);

-- model_drivers
CREATE INDEX IF NOT EXISTS idx_model_drivers_entity ON model_drivers(entity_id);
CREATE INDEX IF NOT EXISTS idx_model_drivers_op_scenario ON model_drivers(operating_scenario_id);

-- model_values
CREATE INDEX IF NOT EXISTS idx_model_values_line_item ON model_values(line_item_id);
CREATE INDEX IF NOT EXISTS idx_model_values_scenario ON model_values(scenario_id, operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_values_period ON model_values(line_item_id, period_index);

-- model_debt_corkscrews
CREATE INDEX IF NOT EXISTS idx_model_corkscrews_model ON model_debt_corkscrews(model_id);
CREATE INDEX IF NOT EXISTS idx_model_corkscrews_scenario ON model_debt_corkscrews(model_id, scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_corkscrews_entity ON model_debt_corkscrews(entity_id);
CREATE INDEX IF NOT EXISTS idx_model_corkscrews_period ON model_debt_corkscrews(model_id, scenario_id, period_index);

-- model_balance_sheet_values
CREATE INDEX IF NOT EXISTS idx_model_bs_model ON model_balance_sheet_values(model_id);
CREATE INDEX IF NOT EXISTS idx_model_bs_entity ON model_balance_sheet_values(model_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_model_bs_scenario ON model_balance_sheet_values(model_id, scenario_id, operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_bs_period ON model_balance_sheet_values(model_id, entity_id, period_index);

-- model_cf_values
CREATE INDEX IF NOT EXISTS idx_model_cf_model ON model_cf_values(model_id);
CREATE INDEX IF NOT EXISTS idx_model_cf_entity ON model_cf_values(model_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_model_cf_scenario ON model_cf_values(model_id, scenario_id, operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_cf_period ON model_cf_values(model_id, entity_id, period_index);

-- model_spv_equity
CREATE INDEX IF NOT EXISTS idx_model_spv_equity_entity ON model_spv_equity(entity_id);
CREATE INDEX IF NOT EXISTS idx_model_spv_equity_scenario ON model_spv_equity(scenario_id);

-- model_holdco_compensation
CREATE INDEX IF NOT EXISTS idx_model_holdco_comp_model ON model_holdco_compensation(model_id);
CREATE INDEX IF NOT EXISTS idx_model_holdco_comp_entity ON model_holdco_compensation(entity_id);

-- model_covenants
CREATE INDEX IF NOT EXISTS idx_model_covenants_model ON model_covenants(model_id);
CREATE INDEX IF NOT EXISTS idx_model_covenants_scenario ON model_covenants(scenario_id);

-- model_covenant_results
CREATE INDEX IF NOT EXISTS idx_model_covenant_results_covenant ON model_covenant_results(covenant_id);
CREATE INDEX IF NOT EXISTS idx_model_covenant_results_op_scenario ON model_covenant_results(operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_covenant_results_period ON model_covenant_results(covenant_id, period_index);

-- model_liquidity_events
CREATE INDEX IF NOT EXISTS idx_model_liquidity_model ON model_liquidity_events(model_id);
CREATE INDEX IF NOT EXISTS idx_model_liquidity_scenario ON model_liquidity_events(model_id, scenario_id);

-- model_snapshots
CREATE INDEX IF NOT EXISTS idx_model_snapshots_model ON model_snapshots(model_id);
CREATE INDEX IF NOT EXISTS idx_model_snapshots_scenario ON model_snapshots(model_id, scenario_id, operating_scenario_id);
CREATE INDEX IF NOT EXISTS idx_model_snapshots_period ON model_snapshots(model_id, period_index);

-- coa_imports
CREATE INDEX IF NOT EXISTS idx_coa_imports_model ON coa_imports(model_id);
CREATE INDEX IF NOT EXISTS idx_coa_imports_entity ON coa_imports(entity_id);

-- model_calculate_runs
CREATE INDEX IF NOT EXISTS idx_model_calc_runs_model ON model_calculate_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_model_calc_runs_latest ON model_calculate_runs(model_id, run_at DESC);

-- model_published_versions
CREATE INDEX IF NOT EXISTS idx_model_pub_versions_model ON model_published_versions(model_id);
CREATE INDEX IF NOT EXISTS idx_model_pub_versions_current ON model_published_versions(model_id, is_current) WHERE is_current = true;

-- model_version_access
CREATE INDEX IF NOT EXISTS idx_model_version_access_version ON model_version_access(version_id);
CREATE INDEX IF NOT EXISTS idx_model_version_access_profile ON model_version_access(profile_id);

-- model_access_log
CREATE INDEX IF NOT EXISTS idx_model_access_log_model ON model_access_log(model_id);
CREATE INDEX IF NOT EXISTS idx_model_access_log_profile ON model_access_log(profile_id);
CREATE INDEX IF NOT EXISTS idx_model_access_log_viewed ON model_access_log(model_id, viewed_at DESC);

-- ============================================
-- 31. Triggers — updated_at auto-update
-- ============================================
-- Reuses existing update_updated_at() function from schema.sql

CREATE TRIGGER update_mid_baseline_updated_at
  BEFORE UPDATE ON mid_baseline
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_financial_models_updated_at
  BEFORE UPDATE ON financial_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_entities_updated_at
  BEFORE UPDATE ON model_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_scenarios_updated_at
  BEFORE UPDATE ON model_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_operating_scenarios_updated_at
  BEFORE UPDATE ON model_operating_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_deal_references_updated_at
  BEFORE UPDATE ON model_deal_references
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_deal_scenario_terms_updated_at
  BEFORE UPDATE ON model_deal_scenario_terms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_line_items_updated_at
  BEFORE UPDATE ON model_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_drivers_updated_at
  BEFORE UPDATE ON model_drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_spv_equity_updated_at
  BEFORE UPDATE ON model_spv_equity
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_holdco_compensation_updated_at
  BEFORE UPDATE ON model_holdco_compensation
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_model_covenants_updated_at
  BEFORE UPDATE ON model_covenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Done!
-- ============================================
-- After running this migration:
-- 1. Verify all tables: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE 'model_%' OR table_name IN ('financial_models', 'mid_baseline', 'mid_baseline_entities', 'coa_imports'));
-- 2. Verify enum: SELECT enum_range(NULL::deal_status);
-- 3. Verify RLS: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'model_%';
-- 4. Test singleton constraint: INSERT two 'aragon' entities for same model → should fail
-- 5. Test FK restrict: DELETE a deal referenced by model_deal_references → should fail
