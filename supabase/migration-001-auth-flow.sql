-- Migration: Update auth flow to require pre-authorized emails
-- Run this in Supabase SQL Editor AFTER the initial schema

-- Drop the existing trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Create new function that links auth to existing profiles
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if a profile with this email already exists (pre-authorized)
  IF EXISTS (SELECT 1 FROM profiles WHERE email = NEW.email) THEN
    -- Link the auth user ID to the existing profile
    UPDATE profiles
    SET id = NEW.id,
        updated_at = NOW()
    WHERE email = NEW.email;
  ELSE
    -- Create a profile with 'pending' role (no access)
    -- This allows them to log in but see an "awaiting authorization" message
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

-- Add 'pending' to the user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pending';
