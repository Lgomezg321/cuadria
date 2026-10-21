-- CUADRIA: integration fixes after merging the audit remediation branches.
-- Runs after 202610210001 (column-level SELECT on movements), 202610210002
-- (reversals start 'pending' and close_period requires an independent approval)
-- and 202610210003 (only 'verified' receipts count as evidence).

-- alerts_snapshot (SECURITY INVOKER, so RLS limits it to the caller's companies):
--   * pending: posted operations awaiting review, without openings or reversals.
--   * pending_reversals: posted reversals awaiting their independent review; a
--     period with any of them cannot be closed (UNREVIEWED_MOVEMENTS).
--   * observed: posted movements of any kind with an observation.
--   * missing_receipts: posted expenses without a verified receipt.
-- Only columns granted to authenticated on public.movements are referenced.
create or replace function public.alerts_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'pending',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='pending' and m.kind not in ('opening','reversal')),
 'pending_reversals',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='pending' and m.kind='reversal'),
 'observed',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='observed'),
 'missing_receipts',(select count(m.id) from public.movements m where m.financial_status='posted' and m.kind='expense'
  and not exists(select 1 from public.receipts r where r.movement_id=m.id and r.status='verified')),
 'funds_with_difference',(select count(*) from public.funds f where (select c.difference<>0 from public.checks c where c.fund_id=f.id order by c.created_at desc,c.id desc limit 1)),
 'unverified_funds',(select count(*) from public.funds f where f.active and not exists(select 1 from public.checks c join public.check_reviews r on r.check_id=c.id where c.fund_id=f.id and r.decision='approved' and c.created_at>=now()-interval '7 days'))
 );
$$;
revoke all on function public.alerts_snapshot() from public,anon,authenticated;
grant execute on function public.alerts_snapshot() to authenticated;
