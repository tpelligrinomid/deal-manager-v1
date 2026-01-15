-- Migration: Invite-only authorization system
-- Run this in Supabase SQL Editor AFTER the initial schema

-- ============================================
-- 1. Create authorized_emails table (the allowlist)
-- ============================================

CREATE TABLE IF NOT EXISTS authorized_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'team_member',
  full_name TEXT,
  company_name TEXT,
  invited_by UUID REFERENCES profiles(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ, -- Set when user signs up
  claimed_by UUID REFERENCES profiles(id) -- Links to the profile that claimed this invite
);

-- Add 'pending' to the user_role enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'pending';
  END IF;
END$$;

-- ============================================
-- 2. Update the auth trigger
-- ============================================

-- Drop the existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Create new function that checks the allowlist
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  authorized_record RECORD;
BEGIN
  -- Check if this email is in the authorized list
  SELECT * INTO authorized_record
  FROM authorized_emails
  WHERE LOWER(email) = LOWER(NEW.email)
  AND claimed_at IS NULL;  -- Not already claimed

  IF FOUND THEN
    -- Create profile with the authorized role
    INSERT INTO profiles (id, email, full_name, role, company_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', authorized_record.full_name, split_part(NEW.email, '@', 1)),
      authorized_record.role,
      authorized_record.company_name
    );

    -- Mark the invitation as claimed
    UPDATE authorized_emails
    SET claimed_at = NOW(),
        claimed_by = NEW.id
    WHERE id = authorized_record.id;
  ELSE
    -- Not on the allowlist - create with 'pending' role (no access)
    INSERT INTO profiles (id, email, full_name, role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- 3. Add RLS to authorized_emails
-- ============================================

ALTER TABLE authorized_emails ENABLE ROW LEVEL SECURITY;

-- Only admins and team members can view/manage invitations
CREATE POLICY "Team can view authorized emails" ON authorized_emails
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'team_member'))
  );

CREATE POLICY "Admins can manage authorized emails" ON authorized_emails
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 4. Add your first admin (REPLACE WITH YOUR EMAIL)
-- ============================================

-- INSERT INTO authorized_emails (email, role, full_name)
-- VALUES ('your-email@example.com', 'admin', 'Your Name');
