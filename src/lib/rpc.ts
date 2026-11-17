import { supabase } from "@/integrations/supabase/client";
/* Untyped helpers for the database functions added in 0001_features.sql.
   Regenerate src/integrations/supabase/types.ts later if you want full typing. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as any).rpc(fn, args) as Promise<{ data: any; error: any }>;
export const table = (name: string) => (supabase as any).from(name);
export const CASE_TYPES = ["criminal", "civil", "academic", "workplace", "other"];
