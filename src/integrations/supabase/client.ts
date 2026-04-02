// src/integrations/supabase/client.ts
// IMPORTANT: This file re-exports the singleton from supabaseClient.ts.
// There must only ever be ONE GoTrueClient instance in the app — having two
// causes session conflicts and "Multiple GoTrueClient instances" warnings.
// Do not call createClient() here directly.

import type { Database } from './types';
import { getSupabase } from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export the singleton as `supabase` so all existing imports continue to work.
// Cast to the typed client for full type safety throughout the app.
export const supabase = getSupabase() as SupabaseClient<Database>;
