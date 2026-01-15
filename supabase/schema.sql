-- Aragon Holdings Deal Room - Supabase Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE user_role AS ENUM ('admin', 'team_member', 'seller', 'advisor');
CREATE TYPE deal_status AS ENUM ('active', 'on_hold', 'loi_issued', 'closed_won', 'closed_lost', 'withdrawn');
CREATE TYPE checklist_item_status AS ENUM ('not_requested', 'requested', 'received', 'reviewed', 'flagged');
CREATE TYPE document_category AS ENUM (
  'tax_returns',
  'financial_statements',
  'insurance',
  'payroll',
  'client_contracts',
  'vendor_agreements',
  'org_charts',
  'legal_documents',
  'other'
);

-- ============================================
-- USERS / PROFILES
-- ============================================

-- Extends Supabase auth.users
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'team_member',
  company_name TEXT, -- For sellers
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- DEALS
-- ============================================

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Basic info
  agency_name TEXT NOT NULL,
  dba_name TEXT, -- "Doing business as" if different
  website TEXT,

  -- Location
  city TEXT,
  state TEXT,

  -- Key contacts
  primary_contact_name TEXT,
  primary_contact_email TEXT,
  primary_contact_phone TEXT,

  -- Deal metadata
  status deal_status NOT NULL DEFAULT 'active',
  nda_signed_date DATE,
  source TEXT, -- How we found them: broker, outbound, inbound, referral
  broker_name TEXT,
  broker_email TEXT,

  -- Pipedrive reference (for linking back)
  pipedrive_deal_id TEXT,

  -- Financial summary (high-level, from initial conversations)
  reported_revenue NUMERIC,
  reported_ebitda NUMERIC,
  asking_price NUMERIC,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

-- ============================================
-- DEAL ACCESS (who can see what)
-- ============================================

CREATE TABLE deal_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'full', -- 'full', 'read_only', 'seller'
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID REFERENCES profiles(id),

  UNIQUE(deal_id, user_id)
);

-- ============================================
-- SURVEY RESPONSES
-- ============================================

-- Stores the seller's answers to the agency survey
-- Each row = one question's answer for one deal
CREATE TABLE survey_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Question identification (matches JSON config)
  section_id TEXT NOT NULL,
  question_id TEXT NOT NULL,

  -- The answer (stored as JSONB for flexibility)
  -- Can be: string, number, boolean, array (for multi-select)
  answer JSONB,

  -- Metadata
  answered_at TIMESTAMPTZ,
  answered_by UUID REFERENCES profiles(id),

  -- Internal notes from Aragon team
  internal_notes TEXT,
  flagged BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(deal_id, section_id, question_id)
);

-- Track overall survey progress per deal
CREATE TABLE survey_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE UNIQUE,

  -- Progress tracking
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_questions INTEGER NOT NULL DEFAULT 0,
  completion_percentage NUMERIC(5,2) DEFAULT 0,

  -- Status
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_saved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- DUE DILIGENCE CHECKLIST
-- ============================================

-- Checklist items for each deal (instantiated from template)
CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Item details
  category TEXT NOT NULL, -- Financial, Legal, HR, Clients, Operations, Insurance
  item_name TEXT NOT NULL,
  description TEXT,

  -- Status tracking
  status checklist_item_status NOT NULL DEFAULT 'not_requested',
  requested_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),

  -- Notes
  internal_notes TEXT,
  seller_notes TEXT, -- Notes visible to seller

  -- Ordering
  sort_order INTEGER DEFAULT 0,

  -- Is this required or optional?
  required BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- DOCUMENTS
-- ============================================

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- File info
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Storage path (local or S3)
  file_size INTEGER,
  mime_type TEXT,

  -- Categorization
  category document_category NOT NULL DEFAULT 'other',
  subcategory TEXT, -- e.g., "2023" for tax returns
  description TEXT,

  -- Linked to checklist item (optional)
  checklist_item_id UUID REFERENCES checklist_items(id) ON DELETE SET NULL,

  -- Upload info
  uploaded_by UUID REFERENCES profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Version tracking
  version INTEGER DEFAULT 1,
  replaces_document_id UUID REFERENCES documents(id),

  -- Access control
  seller_visible BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- DEAL NOTES / ACTIVITY LOG
-- ============================================

CREATE TABLE deal_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Note content
  content TEXT NOT NULL,
  note_type TEXT DEFAULT 'general', -- general, call_log, meeting, internal

  -- Author
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_notes ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own profile, admins can read all
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Deals: users can view deals they have access to
CREATE POLICY "Users can view deals they have access to" ON deals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = deals.id AND user_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Team members can create deals" ON deals
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Team members can update deals" ON deals
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

-- Survey responses: sellers can update their own deal's survey, team can view all
CREATE POLICY "Sellers can manage their survey responses" ON survey_responses
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = survey_responses.deal_id
      AND user_id = auth.uid()
      AND access_level = 'seller'
    )
  );

CREATE POLICY "Team can view all survey responses" ON survey_responses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Team can add internal notes" ON survey_responses
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

-- Documents: similar access pattern
CREATE POLICY "Users can view documents for their deals" ON documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = documents.deal_id AND user_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Sellers can upload documents" ON documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = documents.deal_id
      AND user_id = auth.uid()
    )
  );

-- Checklist items
CREATE POLICY "Users can view checklist for their deals" ON checklist_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = checklist_items.deal_id AND user_id = auth.uid()
    )
    OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Team can manage checklist items" ON checklist_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

-- Deal notes (internal only)
CREATE POLICY "Team can manage deal notes" ON deal_notes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to relevant tables
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_survey_responses_updated_at
  BEFORE UPDATE ON survey_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_survey_progress_updated_at
  BEFORE UPDATE ON survey_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_checklist_items_updated_at
  BEFORE UPDATE ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_deal_notes_updated_at
  BEFORE UPDATE ON deal_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'team_member' -- Default role, can be changed
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_deals_status ON deals(status);
CREATE INDEX idx_deals_created_at ON deals(created_at DESC);
CREATE INDEX idx_deal_access_user ON deal_access(user_id);
CREATE INDEX idx_deal_access_deal ON deal_access(deal_id);
CREATE INDEX idx_survey_responses_deal ON survey_responses(deal_id);
CREATE INDEX idx_survey_responses_question ON survey_responses(section_id, question_id);
CREATE INDEX idx_documents_deal ON documents(deal_id);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_checklist_items_deal ON checklist_items(deal_id);
CREATE INDEX idx_checklist_items_status ON checklist_items(status);
CREATE INDEX idx_deal_notes_deal ON deal_notes(deal_id);
