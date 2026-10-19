import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export const requireUser = cache(async () => {
  if (!supabaseConfig()) redirect("/configuracion");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
});
