-- Migration: NDA Management
-- Description: Create NDAs table for tracking signed non-disclosure agreements
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Create NDAs table
-- ============================================

CREATE TABLE IF NOT EXISTS ndas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Signer (prospect/seller) information
  signer_company_name TEXT NOT NULL,
  signer_company_address TEXT,
  signer_full_name TEXT NOT NULL,
  signer_title TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_phone TEXT,

  -- Electronic signature details
  signature_text TEXT NOT NULL,          -- Their typed name as signature
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signer_ip_address TEXT,
  signer_user_agent TEXT,

  -- Counter-signature (Aragon Holdings LLC - auto-signed)
  counter_signer_name TEXT NOT NULL DEFAULT 'Tristan Pelligrino',
  counter_signer_title TEXT NOT NULL DEFAULT 'Managing Member',
  counter_signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Generated PDF
  pdf_path TEXT,                          -- Path to stored PDF file
  pdf_generated_at TIMESTAMPTZ,

  -- Deal linking
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ,                -- When NDA was attached to deal
  attached_by UUID REFERENCES profiles(id),

  -- Metadata
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'signed' CHECK (status IN ('signed', 'attached', 'voided')),
  notes TEXT,                             -- Internal notes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique email per NDA (can sign multiple if needed for different deals)
  -- Actually, same person could sign NDA multiple times for different companies
  UNIQUE(signer_email, signer_company_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ndas_signer_email ON ndas(signer_email);
CREATE INDEX IF NOT EXISTS idx_ndas_deal_id ON ndas(deal_id);
CREATE INDEX IF NOT EXISTS idx_ndas_status ON ndas(status);
CREATE INDEX IF NOT EXISTS idx_ndas_signed_at ON ndas(signed_at DESC);

-- ============================================
-- 2. RLS Policies for NDAs
-- ============================================

ALTER TABLE ndas ENABLE ROW LEVEL SECURITY;

-- Team members can view all NDAs
CREATE POLICY "Team can view all NDAs" ON ndas
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

-- Team members can update NDAs (attach to deal, add notes)
CREATE POLICY "Team can update NDAs" ON ndas
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

-- Public can insert NDAs (for the public signing endpoint)
-- Note: The actual insert will be done via service role or public API
CREATE POLICY "Anyone can sign NDA" ON ndas
  FOR INSERT WITH CHECK (true);

-- Only admins can delete NDAs
CREATE POLICY "Admin can delete NDAs" ON ndas
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

-- ============================================
-- 3. Update deals table to track NDA requirement
-- ============================================

-- Add nda_id to deals if not exists (for explicit linking)
ALTER TABLE deals
ADD COLUMN IF NOT EXISTS nda_id UUID REFERENCES ndas(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_deals_nda_id ON deals(nda_id);

-- ============================================
-- 4. Create view for NDA dashboard
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
-- 1. Deploy updated backend code
-- 2. Configure environment variables for company info
-- 3. Set up n8n workflow for NDA emails
