-- CUADRIA: integration fixes after merging the audit remediation branches and
-- the adversarial review of the merge (R-01, R-02). Runs after 202610210001
-- (column-level SELECT on movements), 202610210002 (reversals start 'pending'
-- and close_period requires an independent approval) and 202610210003 (only
-- 'verified' receipts count as evidence).

-- 1. Reversals created before 202610210002 (R-02).
-- The previous reverse_movement left the reversal 'pending' and the old UI did
-- not offer to review it, so those rows would now block close_period forever.
-- They are identified exactly: every reversal posted by the current function
-- has a 'reversal.posted' audit event, legacy ones do not. Only legacy
-- reversals still 'pending' are exempted; each exemption is recorded here and
-- audited ('reversal.review_exempted', actor = the reversal's author, since
-- audit_events requires an actor). New reversals always need a second admin.
create table private.reversal_review_exemptions (
 movement_id uuid primary key references public.movements(id),
 reason text not null check(reason='legacy_pre_independent_review'),
 created_at timestamptz not null default now()
);
alter table private.reversal_review_exemptions enable row level security;
revoke all on private.reversal_review_exemptions from public, anon, authenticated;
create trigger immutable_reversal_review_exemptions before update or delete on private.reversal_review_exemptions
 for each row execute function private.immutable_record();
create trigger forbid_truncate_reversal_review_exemptions before truncate on private.reversal_review_exemptions
 for each statement execute function private.immutable_record();
with legacy as (
 select m.id,m.company_id,m.created_by from public.movements m
 where m.kind='reversal' and m.financial_status='posted' and m.review_status='pending'
 and not exists(select 1 from public.audit_events a where a.action='reversal.posted' and a.entity_id=m.id)
), exempted as (
 insert into private.reversal_review_exemptions(movement_id,reason)
 select id,'legacy_pre_independent_review' from legacy returning movement_id
)
insert into public.audit_events(company_id,actor_id,action,entity_id,details)
select l.company_id,l.created_by,'reversal.review_exempted',l.id,
 jsonb_build_object('migration','202610210004','reason','legacy_pre_independent_review')
from legacy l join exempted e on e.movement_id=l.id;

-- True unless the movement is an exempted legacy reversal the caller can read
-- (no oracle on movements outside the caller's funds). Used by the
-- SECURITY INVOKER alerts, which cannot read the private table.
create function private.reversal_needs_review(p_movement uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.reversal_review_exemptions x join public.movements m on m.id=x.movement_id
  where x.movement_id=p_movement and (private.can_read_fund(m.fund_id) or private.can_read_fund(m.destination_id)));
$$;

-- close_period: identical to 202610210002 except that exempted legacy
-- reversals do not block the closure.
create or replace function public.close_period(p_fund uuid,p_cutoff date,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
 declare f public.funds; result uuid; initial numeric; inc numeric; exp numeric; transfers numeric; reversals numeric; final numeric; ids uuid[];
 begin
 select * into f from public.funds where id=p_fund for update;
 -- H-48: the approver's own retry returns the stored closure before re-authorizing.
 select id into result from public.period_closures where fund_id=p_fund and cutoff=p_cutoff and approved_by=auth.uid();
 if found then return result;end if;
 if private.company_role(f.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 select id into result from public.period_closures where fund_id=p_fund and cutoff=p_cutoff;
 if found then return result;end if;
 if p_cutoff is null or p_cutoff>(now() at time zone 'America/Bogota')::date or p_cutoff<(f.created_at at time zone 'America/Bogota')::date or p_cutoff<=f.closed_through then raise exception 'INVALID_CUTOFF';end if;
 -- Lock every affected movement in a deterministic order before freezing reviews.
 perform m.id from public.movements m where m.id in (select e.movement_id from public.entries e where e.fund_id=p_fund) and m.operation_date<=p_cutoff order by m.id for update;
 -- Reversals need an independent approval like any posted operation; openings
 -- and legacy reversals exempted above are not reviewed.
 if exists(select 1 from public.movements m join public.entries e on e.movement_id=m.id where e.fund_id=p_fund and m.operation_date<=p_cutoff
  and (f.closed_through is null or m.operation_date>f.closed_through) and m.kind<>'opening' and m.financial_status='posted' and m.review_status<>'approved'
  and not exists(select 1 from private.reversal_review_exemptions x where x.movement_id=m.id)) then raise exception 'UNREVIEWED_MOVEMENTS';end if;
 select coalesce(sum(e.amount) filter(where (f.closed_through is not null and m.operation_date<=f.closed_through) or (f.closed_through is null and m.kind='opening')),0),
 coalesce(sum(e.amount) filter(where m.kind='income' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(-sum(e.amount) filter(where m.kind='expense' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount) filter(where m.kind='transfer' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount) filter(where m.kind='reversal' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount),0),coalesce(array_agg(m.id order by m.id) filter(where f.closed_through is null or m.operation_date>f.closed_through),'{}'::uuid[])
 into initial,inc,exp,transfers,reversals,final,ids
 from public.entries e join public.movements m on m.id=e.movement_id where e.fund_id=p_fund and m.operation_date<=p_cutoff;
 if initial<0 or final<0 then raise exception 'NEGATIVE_CLOSING_BALANCE';end if;
 insert into public.period_closures(company_id,fund_id,cutoff,previous_cutoff,opening_balance,income,expenses,transfers_net,reversals_net,closing_balance,movement_ids,approved_by,note)
 values(f.company_id,p_fund,p_cutoff,f.closed_through,initial,inc,exp,transfers,reversals,final,ids,auth.uid(),coalesce(p_note,'')) returning id into result;
 update public.funds set closed_through=p_cutoff where id=p_fund;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(f.company_id,auth.uid(),'period.closed',result,jsonb_build_object('cutoff',p_cutoff,'balance',final::text));
 return result;
 end;
$$;

-- 2. alerts_snapshot (SECURITY INVOKER, so RLS limits it to the caller's companies):
--   * pending: posted operations awaiting review, reversals included (they block
--     close_period until another admin approves them); openings and exempted
--     legacy reversals excluded.
--   * pending_reversals: the reversals included in `pending`.
--   * observed: posted movements of any kind with an observation.
--   * missing_receipts: posted expenses without a verified receipt.
-- Only columns granted to authenticated on public.movements are referenced.
create or replace function public.alerts_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'pending',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='pending' and m.kind<>'opening'
  and (m.kind<>'reversal' or private.reversal_needs_review(m.id))),
 'pending_reversals',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='pending' and m.kind='reversal'
  and private.reversal_needs_review(m.id)),
 'observed',(select count(m.id) from public.movements m where m.financial_status='posted' and m.review_status='observed'),
 'missing_receipts',(select count(m.id) from public.movements m where m.financial_status='posted' and m.kind='expense'
  and not exists(select 1 from public.receipts r where r.movement_id=m.id and r.status='verified')),
 'funds_with_difference',(select count(*) from public.funds f where (select c.difference<>0 from public.checks c where c.fund_id=f.id order by c.created_at desc,c.id desc limit 1)),
 'unverified_funds',(select count(*) from public.funds f where f.active and not exists(select 1 from public.checks c join public.check_reviews r on r.check_id=c.id where c.fund_id=f.id and r.decision='approved' and c.created_at>=now()-interval '7 days'))
 );
$$;

-- 3. Signed receipt verdict (R-01).
-- confirm_receipt used to trust p_detected_mime/p_size from the caller: an
-- author could upload arbitrary bytes and call it through PostgREST. The
-- Server Action now inspects the bytes and signs its verdict with
-- HMAC-SHA256 over '<receipt>|<detected mime or empty>|<size>|<auth.uid()>'
-- using RECEIPT_VERIFICATION_SECRET; the database reads the same secret from
-- Supabase Vault (name 'cuadria_receipt_verification') and recomputes it with
-- pgcrypto's hmac (schema resolved from the pgcrypto extension, usually
-- `extensions`). Without the secret or pgcrypto it fails closed.
create function private.receipt_verdict_valid(p_receipt uuid,p_detected_mime text,p_size bigint,p_signature text) returns boolean language plpgsql stable security definer set search_path='' as $$
 declare secret text; crypto_schema text; expected bytea; given bytea; diff integer:=0;
 begin
 if to_regclass('vault.decrypted_secrets') is null then raise exception 'RECEIPT_VERIFICATION_NOT_CONFIGURED'; end if;
 select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name='cuadria_receipt_verification' limit 1;
 if secret is null or length(secret)<32 then raise exception 'RECEIPT_VERIFICATION_NOT_CONFIGURED'; end if;
 select n.nspname into crypto_schema from pg_extension x join pg_depend d on d.refobjid=x.oid and d.deptype='e' and d.classid='pg_proc'::regclass
  join pg_proc p on p.oid=d.objid join pg_namespace n on n.oid=p.pronamespace
  where x.extname='pgcrypto' and p.proname='hmac' and pg_get_function_identity_arguments(p.oid)='bytea, bytea, text' limit 1;
 if crypto_schema is null then raise exception 'RECEIPT_VERIFICATION_NOT_CONFIGURED'; end if;
 if auth.uid() is null or p_receipt is null or p_size is null or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then return false; end if;
 execute format('select %I.hmac(convert_to($1,''UTF8''),convert_to($2,''UTF8''),''sha256'')',crypto_schema) into expected
  using p_receipt::text||'|'||coalesce(p_detected_mime,'')||'|'||p_size::text||'|'||auth.uid()::text, secret;
 given:=decode(p_signature,'hex');
 -- Compare every byte (no early exit).
 for i in 0..31 loop diff:=diff | (get_byte(expected,i) # get_byte(given,i)); end loop;
 return diff=0;
 end;
$$;

drop function public.confirm_receipt(uuid,text,bigint);
-- Same verification as 202610210003, preceded by the signed-verdict check.
create function public.confirm_receipt(p_receipt uuid,p_detected_mime text,p_size bigint,p_signature text) returns jsonb language plpgsql security definer set search_path='' as $$
 declare r public.receipts; m public.movements; obj jsonb; meta jsonb; owner_text text; reason text; result text;
 begin
 if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
 if not private.receipt_verdict_valid(p_receipt,p_detected_mime,p_size,p_signature) then raise exception 'RECEIPT_SIGNATURE_INVALID'; end if;
 select * into r from public.receipts where id=p_receipt for update;
 if not found or r.uploaded_by is distinct from auth.uid() then raise exception 'FORBIDDEN'; end if;
 if r.status<>'pending' then return jsonb_build_object('id',r.id,'status',r.status,'reason',r.status_reason); end if;
 select * into m from public.movements where id=r.movement_id;
 if m.created_by is distinct from auth.uid() or not private.can_write_fund(m.fund_id) or m.financial_status<>'posted' or m.review_status='approved' then raise exception 'FORBIDDEN'; end if;
 select to_jsonb(s) into obj from storage.objects s where s.bucket_id='receipts' and s.name=r.object_path limit 1;
 if obj is null then raise exception 'RECEIPT_NOT_UPLOADED'; end if;
 meta:=case when jsonb_typeof(obj->'metadata')='object' then obj->'metadata' end;
 owner_text:=coalesce(obj->>'owner_id',obj->>'owner');
 if p_detected_mime is null or p_detected_mime is distinct from r.mime_type then reason:='content';
 elsif p_size is null or p_size<>r.size_bytes then reason:='size';
 elsif meta ? 'size' and meta->>'size' is distinct from r.size_bytes::text then reason:='metadata_size';
 elsif meta ? 'mimetype' and lower(split_part(meta->>'mimetype',';',1)) is distinct from r.mime_type then reason:='metadata_mime';
 elsif owner_text is not null and owner_text<>auth.uid()::text then reason:='owner';
 end if;
 result:=case when reason is null then 'verified' else 'rejected' end;
 update public.receipts set status=result,status_reason=reason,resolved_at=now() where id=r.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details)
  values(m.company_id,auth.uid(),'receipt.'||result,r.id,jsonb_build_object('movement',m.id,'reason',reason,'signed',true));
 return jsonb_build_object('id',r.id,'status',result,'reason',reason);
 end;
$$;

-- 4. Privileges.
revoke all on function public.alerts_snapshot(),public.close_period(uuid,date,text),public.confirm_receipt(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.alerts_snapshot(),public.close_period(uuid,date,text),public.confirm_receipt(uuid,text,bigint,text) to authenticated;
revoke all on function private.reversal_needs_review(uuid),private.receipt_verdict_valid(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function private.reversal_needs_review(uuid) to authenticated;
do $$
begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  revoke all on private.reversal_review_exemptions from service_role;
  revoke all on function private.reversal_needs_review(uuid),private.receipt_verdict_valid(uuid,text,bigint,text),public.confirm_receipt(uuid,text,bigint,text) from service_role;
 end if;
end $$;
