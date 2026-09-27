import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://xnvpqkrsfrzknzkhljpm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UMaThSUFrsCBLh8AHzqu5A_n4fjZJz1";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
