-- Migration: Per-User Surveys
-- Description: Allow each seller to have their own survey responses
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. Update survey_responses table
-- ============================================

-- Add user_id column if it doesn't exist
ALTER TABLE survey_responses
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Drop the old unique constraint
ALTER TABLE survey_responses
DROP CONSTRAINT IF EXISTS survey_responses_deal_id_section_id_question_id_key;

-- Create new unique constraint including user_id
ALTER TABLE survey_responses
ADD CONSTRAINT survey_responses_deal_user_section_question_key
UNIQUE (deal_id, user_id, section_id, question_id);

-- Create index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_survey_responses_user_id
ON survey_responses(user_id);

-- Create index for deal + user lookups
CREATE INDEX IF NOT EXISTS idx_survey_responses_deal_user
ON survey_responses(deal_id, user_id);

-- ============================================
-- 2. Update survey_progress table
-- ============================================

-- Add user_id column if it doesn't exist
ALTER TABLE survey_progress
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

-- Drop the old unique constraint (if it exists as primary key or unique)
-- First check if deal_id is the primary key
ALTER TABLE survey_progress
DROP CONSTRAINT IF EXISTS survey_progress_pkey;

ALTER TABLE survey_progress
DROP CONSTRAINT IF EXISTS survey_progress_deal_id_key;

-- Add a new id column as primary key if needed
ALTER TABLE survey_progress
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Set id as primary key if not already
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_progress_pkey'
    AND conrelid = 'survey_progress'::regclass
  ) THEN
    ALTER TABLE survey_progress ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Create new unique constraint for deal + user
ALTER TABLE survey_progress
ADD CONSTRAINT survey_progress_deal_user_key
UNIQUE (deal_id, user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_survey_progress_deal_user
ON survey_progress(deal_id, user_id);

-- ============================================
-- 3. Update RLS policies for survey tables
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view survey responses for deals they have access to" ON survey_responses;
DROP POLICY IF EXISTS "Users can insert survey responses for deals they have access to" ON survey_responses;
DROP POLICY IF EXISTS "Users can update survey responses for deals they have access to" ON survey_responses;

-- Sellers can view/edit only their own responses
-- Team members can view all responses for deals
CREATE POLICY "Sellers can view own survey responses" ON survey_responses
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

CREATE POLICY "Sellers can insert own survey responses" ON survey_responses
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM deal_access
      WHERE deal_id = survey_responses.deal_id
      AND user_id = auth.uid()
      AND access_level = 'seller'
    )
  );

CREATE POLICY "Sellers can update own survey responses" ON survey_responses
  FOR UPDATE USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

-- Survey progress policies
DROP POLICY IF EXISTS "Users can view survey progress" ON survey_progress;
DROP POLICY IF EXISTS "Users can manage survey progress" ON survey_progress;

CREATE POLICY "Users can view survey progress" ON survey_progress
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

CREATE POLICY "Users can manage own survey progress" ON survey_progress
  FOR ALL USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'team_member')
    )
  );

-- ============================================
-- 4. Migrate existing data (if any)
-- ============================================

-- If there are existing responses without user_id,
-- assign them to the first seller with deal access
-- (Run this only if you have existing data to migrate)

/*
UPDATE survey_responses sr
SET user_id = (
  SELECT da.user_id
  FROM deal_access da
  WHERE da.deal_id = sr.deal_id
  AND da.access_level = 'seller'
  ORDER BY da.granted_at ASC
  LIMIT 1
)
WHERE sr.user_id IS NULL;

UPDATE survey_progress sp
SET user_id = (
  SELECT da.user_id
  FROM deal_access da
  WHERE da.deal_id = sp.deal_id
  AND da.access_level = 'seller'
  ORDER BY da.granted_at ASC
  LIMIT 1
)
WHERE sp.user_id IS NULL;
*/

-- ============================================
-- 5. Add access_level to authorized_emails
-- ============================================

-- Add access_level column for deal access type (seller, advisor)
ALTER TABLE authorized_emails
ADD COLUMN IF NOT EXISTS access_level TEXT DEFAULT 'seller';

-- ============================================
-- 6. Update the signup trigger to use access_level
-- ============================================

-- Update trigger to create deal_access with proper access_level
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  invite_record RECORD;
BEGIN
  -- Check if this email was pre-authorized
  SELECT * INTO invite_record
  FROM authorized_emails
  WHERE email = NEW.email
  AND claimed_at IS NULL;

  IF invite_record IS NOT NULL THEN
    -- Create profile with assigned role
    INSERT INTO profiles (id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(invite_record.full_name, NEW.raw_user_meta_data->>'full_name'),
      invite_record.role
    );

    -- Mark invite as claimed
    UPDATE authorized_emails
    SET claimed_at = NOW()
    WHERE id = invite_record.id;

    -- If deal_id was specified, grant deal access with proper access_level
    IF invite_record.deal_id IS NOT NULL THEN
      INSERT INTO deal_access (deal_id, user_id, access_level, granted_by)
      VALUES (
        invite_record.deal_id,
        NEW.id,
        COALESCE(invite_record.access_level, 'seller'),
        invite_record.invited_by
      );
    END IF;
  ELSE
    -- No pre-authorization - create pending profile
    INSERT INTO profiles (id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'full_name',
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Done!
-- ============================================
-- After running this migration:
-- 1. Deploy updated backend code
-- 2. Test survey functionality with a seller account
-- 3. Test inviting an advisor (view-only access)
