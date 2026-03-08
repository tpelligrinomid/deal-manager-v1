-- 008: Remove dependency on service role key in Express backend
-- All DB operations use the user's JWT. This migration:
--   1. Auto-creates model_access owner row via trigger (replaces supabaseAdmin bootstrap)
--   2. Adds editor-level write policies on output tables
--   3. Adds creator INSERT policy on model_access

-- ============================================
-- 1. Auto-bootstrap model_access on model creation
-- ============================================

CREATE OR REPLACE FUNCTION auto_grant_model_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO model_access (model_id, profile_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_grant_model_owner ON financial_models;
CREATE TRIGGER trg_auto_grant_model_owner
  AFTER INSERT ON financial_models
  FOR EACH ROW
  EXECUTE FUNCTION auto_grant_model_owner();

-- ============================================
-- 2. Editor write policies on output tables
-- ============================================

-- model_values: editors can INSERT/UPDATE/DELETE
CREATE POLICY "Editors can manage model values" ON model_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_line_items mli
      JOIN model_entities me ON me.id = mli.entity_id
      JOIN model_access ma ON ma.model_id = me.model_id
      WHERE mli.id = model_values.line_item_id
        AND ma.profile_id = auth.uid()
        AND ma.role IN ('owner', 'editor')
    )
  );

-- model_debt_corkscrews: editors can write
CREATE POLICY "Editors can manage corkscrews" ON model_debt_corkscrews
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_debt_corkscrews.model_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- model_balance_sheet_values: editors can write
CREATE POLICY "Editors can manage BS values" ON model_balance_sheet_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_balance_sheet_values.model_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- model_cf_values: editors can write
CREATE POLICY "Editors can manage CF values" ON model_cf_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_cf_values.model_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- model_calculate_runs: editors can insert
CREATE POLICY "Editors can insert calculate runs" ON model_calculate_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_calculate_runs.model_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- model_calculate_runs: editors can view
CREATE POLICY "Editors can view calculate runs" ON model_calculate_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_calculate_runs.model_id
        AND profile_id = auth.uid()
    )
  );

-- model_published_versions: editors can update (for is_current toggling)
-- The existing "Editors can publish versions" policy covers INSERT.
-- Add UPDATE for toggling is_current:
CREATE POLICY "Editors can update published versions" ON model_published_versions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM model_access
      WHERE model_id = model_published_versions.model_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );

-- model_published_versions: owners can delete
CREATE POLICY "Owners can delete published versions" ON model_published_versions
  FOR DELETE USING (
    is_model_owner(model_id, auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

-- ============================================
-- 3. Allow model creator to delete own model (for rollback on failed create)
-- ============================================

CREATE POLICY "Creator can delete own model" ON financial_models
  FOR DELETE USING (created_by = auth.uid());
