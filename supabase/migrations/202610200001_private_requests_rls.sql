-- Defense in depth: only the owning SECURITY DEFINER RPC may access
-- idempotency requests. No client-facing policies are required.
alter table private.fund_requests enable row level security;
revoke all on private.fund_requests from public, anon, authenticated;
