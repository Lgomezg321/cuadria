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
  closed_through: z.string().nullable(),
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
  created_by: z.uuid(),
  company_id: z.uuid(),
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

const controlsSchema = z.object({
  drafts: z.array(
    z.object({
      id: z.uuid(),
      fund_id: z.uuid(),
      destination_id: z.uuid().nullable(),
      category_id: z.uuid().nullable(),
      kind: z.enum(["income", "expense", "transfer"]),
      amount: z.string(),
      concept: z.string(),
      operation_date: z.string(),
      version: z.number(),
    }),
  ),
  closures: z.array(
    z.object({
      id: z.uuid(),
      fund_id: z.uuid(),
      cutoff: z.string(),
      opening_balance: z.string(),
      income: z.string(),
      expenses: z.string(),
      transfers_net: z.string(),
      reversals_net: z.string(),
      closing_balance: z.string(),
      approved_at: z.string(),
    }),
  ),
  check_reviews: z.array(
    z.object({
      id: z.uuid(),
      check_id: z.uuid(),
      decision: z.string(),
      comment: z.string(),
      created_at: z.string(),
    }),
  ),
});
export const getControls = cache(async () => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("controls_snapshot");
  if (error) throw new Error("No fue posible consultar borradores y cierres.");
  return controlsSchema.parse(data);
});

const movementDetailSchema = z.object({
  movement,
  reviews: z.array(
    z.object({
      id: z.uuid(),
      reviewer_id: z.uuid(),
      decision: z.string(),
      comment: z.string(),
      created_at: z.string(),
    }),
  ),
  comments: z.array(
    z.object({
      id: z.uuid(),
      author_id: z.uuid(),
      body: z.string(),
      created_at: z.string(),
    }),
  ),
});
export const getMovementDetail = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) return null;
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("movement_detail", { p_id: id });
  if (error) throw new Error("No fue posible consultar el movimiento.");
  return data ? movementDetailSchema.parse(data) : null;
});
