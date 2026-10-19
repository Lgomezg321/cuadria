import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
const company = z.object({ id: z.uuid(), name: z.string(), nit: z.string() });
const fund = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  name: z.string(),
  kind: z.enum(["cash", "bank"]),
  balance: z.string(),
  active: z.boolean(),
});
const movement = z.object({
  id: z.uuid(),
  fund_id: z.uuid(),
  destination_id: z.uuid().nullable(),
  company_id: z.uuid(),
  kind: z.string(),
  amount: z.string(),
  concept: z.string(),
  operation_date: z.string(),
  created_by: z.uuid(),
  financial_status: z.string(),
  review_status: z.string(),
});
const check = z.object({
  id: z.uuid(),
  fund_id: z.uuid(),
  kind: z.string(),
  theoretical: z.string(),
  declared: z.string(),
  difference: z.string(),
  created_at: z.string(),
});
const schema = z.object({
  companies: z.array(company),
  funds: z.array(fund),
  movements: z.array(movement),
  checks: z.array(check),
  categories: z.array(
    z.object({ id: z.uuid(), company_id: z.uuid(), name: z.string() }),
  ),
  memberships: z.array(
    z.object({
      company_id: z.uuid(),
      role: z.enum(["admin", "employee", "auditor"]),
    }),
  ),
});
export type Snapshot = z.infer<typeof schema>;
export const getSnapshot = cache(async (): Promise<Snapshot> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("workspace_snapshot");
  if (error)
    throw new Error(
      "No fue posible consultar los datos. Comprueba la conexión y las migraciones.",
    );
  return schema.parse(data);
});
