"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/supabase/config";

let client: SupabaseClient | null | undefined;

/** The browser client, or null when the project is not configured. One per page. */
export function getBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = supabasePublicConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  client = config ? createClient(config.url, config.anonKey) : null;
  return client;
}
