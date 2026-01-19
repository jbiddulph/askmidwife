-- Diagnostic and fix script for table permissions
-- Run this in Supabase SQL Editor

-- First, check table ownership
SELECT 
    schemaname,
    tablename,
    tableowner
FROM pg_tables 
WHERE tablename LIKE 'askmidwife_%'
ORDER BY tablename;

-- Check current grants one more time
SELECT 
    grantee, 
    table_schema, 
    table_name, 
    privilege_type 
FROM information_schema.table_privileges 
WHERE table_schema = 'public' 
    AND table_name = 'askmidwife_profiles'
    AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- Now forcefully revoke and re-grant to refresh permissions
REVOKE ALL ON TABLE public.askmidwife_profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_provider_availability FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_appointments FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_appointment_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_appointment_payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_payout_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.askmidwife_payout_payments FROM anon, authenticated;

-- Re-grant all permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_provider_availability TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_appointments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_appointment_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_appointment_payments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_payout_requests TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.askmidwife_payout_payments TO anon, authenticated;

-- Verify grants were applied
SELECT 
    grantee, 
    table_schema, 
    table_name, 
    privilege_type 
FROM information_schema.table_privileges 
WHERE table_schema = 'public' 
    AND table_name = 'askmidwife_profiles'
    AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;
