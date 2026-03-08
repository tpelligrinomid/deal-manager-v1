-- Migration: External NDA Support
-- Description: Add support for externally signed NDAs that are uploaded manually
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Add source field to distinguish digital vs external NDAs
-- ============================================

ALTER TABLE ndas
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'digital' CHECK (source IN ('digital', 'external'));

-- Add index for filtering by source
CREATE INDEX IF NOT EXISTS idx_ndas_source ON ndas(source);

-- ============================================
-- 2. Make digital-signature-specific fields nullable for external NDAs
-- ============================================

-- signature_text is the typed e-signature - not applicable for external
ALTER TABLE ndas ALTER COLUMN signature_text DROP NOT NULL;

-- signer_title may not always be known for external NDAs
ALTER TABLE ndas ALTER COLUMN signer_title DROP NOT NULL;

-- Counter-signature fields don't apply to external NDAs
ALTER TABLE ndas ALTER COLUMN counter_signer_name DROP NOT NULL;
ALTER TABLE ndas ALTER COLUMN counter_signer_title DROP NOT NULL;
ALTER TABLE ndas ALTER COLUMN counter_signed_at DROP NOT NULL;

-- ============================================
-- 3. Add uploaded_by field to track who uploaded external NDAs
-- ============================================

ALTER TABLE ndas
ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES profiles(id);

-- ============================================
-- 4. Update the nda_dashboard view to include source
-- ============================================

CREATE OR REPLACE VIEW nda_dashboard AS
SELECT
  n.id,
  n.signer_company_name,
  n.signer_full_name,
  n.signer_email,
  n.signer_title,
  n.signed_at,
  n.effective_date,
  n.status,
  n.source,
  n.deal_id,
  n.pdf_path,
  d.agency_name as attached_deal_name,
  d.status as deal_status
FROM ndas n
LEFT JOIN deals d ON n.deal_id = d.id
ORDER BY n.signed_at DESC;

-- ============================================
-- Done!
-- ============================================
-- After running this migration:
-- 1. Deploy updated backend code with /api/nda/upload-external endpoint
-- 2. Update frontend to add external NDA upload UI
