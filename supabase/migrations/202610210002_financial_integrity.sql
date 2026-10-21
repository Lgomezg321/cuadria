-- CUADRIA: financial integrity hardening from the independent audit
-- (H-05, H-06, H-23 to H-30, H-48, H-49). Runs after 202610210001; it does not
-- touch membership, invitation, receipt, alert or fund-status functions.

-- 1. Operation-scoped idempotency registry (H-28, H-29, H-48).
-- One key per actor across every money/control RPC. A key is bound to the
-- operation and to its full content: reusing it for another operation or with
-- other content raises IDEMPOTENCY_CONFLICT, and a matching retry returns the
-- original result before any permission check (the actor already owns it).
create table private.operation_requests (
 user_id uuid not null references auth.users(id), key uuid not null,
 operation text not null check(operation in ('create_fund','post_movement','submit_draft','reverse_movement','record_check','review_movement','review_check')),
 payload jsonb not null, result uuid not null, created_at timestamptz not null default now(),
 primary key(user_id,key)
);
alter table private.operation_requests enable row level security;
revoke all on private.operation_requests from public, anon, authenticated;
-- Backfill keys consumed before this migration so they keep their meaning.
insert into private.operation_requests(user_id,key,operation,payload,result)
 select user_id,key,'create_fund',payload,fund_id from private.fund_requests on conflict do nothing;
insert into private.operation_requests(user_id,key,operation,payload,result,created_at)
 select m.created_by,m.idempotency_key,
  case when m.kind='reversal' then 'reverse_movement'
   when exists(select 1 from public.drafts d where d.submitted_movement=m.id) then 'submit_draft'
   else 'post_movement' end,
  m.request_payload,m.id,m.created_at
 from public.movements m where m.kind<>'opening' on conflict do nothing;

create function private.idempotency_begin(p_operation text,p_key uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
 declare req private.operation_requests;
 begin
 if p_key is null then raise exception 'INVALID_REQUEST'; end if;
 -- Same lock namespace as the previous per-RPC implementation.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into req from private.operation_requests where user_id=auth.uid() and key=p_key;
 if found then
  if req.operation<>p_operation or req.payload<>p_payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return req.result;
 end if;
 -- Safety net for keys consumed outside the registry: never reuse them.
 if exists(select 1 from public.movements where created_by=auth.uid() and idempotency_key=p_key)
  or exists(select 1 from private.fund_requests where user_id=auth.uid() and key=p_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return null;
 end;
$$;
create function private.idempotency_finish(p_operation text,p_key uuid,p_payload jsonb,p_result uuid) returns void language sql set search_path='' as $$
 insert into private.operation_requests(user_id,key,operation,payload,result) values(auth.uid(),p_key,p_operation,p_payload,p_result);
$$;

-- 2. Historical overdraft guard (H-05). Callers must already hold the fund row
-- lock. Raises if adding p_delta on p_date leaves the running balance by
-- operation_date negative on any day from p_date through today.
create function private.assert_history_covers(p_fund uuid,p_date date,p_delta numeric) returns void language plpgsql stable set search_path='' as $$
 declare lowest numeric;
 begin
 if p_delta>=0 then return; end if;
 with daily as (
  select m.operation_date d,sum(e.amount) t from public.entries e join public.movements m on m.id=e.movement_id
  where e.fund_id=p_fund group by m.operation_date
 ), points as (
  select d,t from daily union all select p_date,0 where not exists(select 1 from daily where d=p_date)
 ), running as (select d,sum(t) over(order by d) r from points)
 select min(r) into lowest from running where d>=p_date;
 if coalesce(lowest,0)+p_delta<0 then raise exception 'HISTORICAL_OVERDRAFT'; end if;
 end;
$$;
-- No retroactivity window is enforced: closures bound how far back a posting can
-- go, and the running-balance guard keeps every historical day non-negative.

-- 3. Posting engine shared by post_movement and submit_draft (separate
-- idempotency namespaces, so a draft never adopts a prior movement).
create function private.post_movement_core(p_operation text,p_fund uuid,p_destination uuid,p_category uuid,p_kind text,p_amount text,p_concept text,p_date date,p_key uuid) returns uuid language plpgsql set search_path='' as $$
 declare f public.funds; d public.funds; a public.cop; payload jsonb; m uuid; today date:=(now() at time zone 'America/Bogota')::date;
 begin
 if p_kind is null or p_kind not in ('income','expense','transfer') or p_key is null or p_amount is null or p_amount !~ '^[1-9][0-9]{0,17}$' then raise exception 'INVALID_MOVEMENT'; end if;
 if (p_kind='transfer')<>(p_destination is not null) or p_destination=p_fund then raise exception 'INVALID_DESTINATION'; end if;
 if p_date is null or p_date>today then raise exception 'INVALID_DATE'; end if;
 payload:=jsonb_build_object('fund',p_fund,'destination',p_destination,'category',p_category,'kind',p_kind,'amount',p_amount,'concept',trim(p_concept),'date',p_date);
 m:=private.idempotency_begin(p_operation,p_key,payload);
 if m is not null then return m; end if;
 if not private.can_write_fund(p_fund) or (p_destination is not null and not private.can_write_fund(p_destination)) then raise exception 'FORBIDDEN'; end if;
 a:=p_amount::public.cop;
 perform id from public.funds where id in (p_fund,p_destination) order by id for update;
 select * into f from public.funds where id=p_fund;
 if not private.can_write_fund(p_fund) then raise exception 'FORBIDDEN'; end if;
 if p_date<(f.created_at at time zone 'America/Bogota')::date then raise exception 'DATE_BEFORE_FUND_OPENING'; end if;
 if p_date<=f.closed_through then raise exception 'PERIOD_CLOSED'; end if;
 if p_destination is not null then
  select * into d from public.funds where id=p_destination;
  if not private.can_write_fund(p_destination) or d.company_id<>f.company_id then raise exception 'INVALID_DESTINATION'; end if;
  if p_date<(d.created_at at time zone 'America/Bogota')::date then raise exception 'DATE_BEFORE_FUND_OPENING'; end if;
  if p_date<=d.closed_through then raise exception 'PERIOD_CLOSED'; end if;
 end if;
 if p_kind in ('expense','transfer') then
  if f.balance<a then raise exception 'INSUFFICIENT_FUNDS'; end if;
  perform private.assert_history_covers(p_fund,p_date,-a);
 end if;
 insert into public.movements(company_id,fund_id,destination_id,category_id,kind,amount,concept,operation_date,created_by,idempotency_key,request_payload)
 values(f.company_id,p_fund,p_destination,p_category,p_kind,a,trim(p_concept),p_date,auth.uid(),p_key,payload) returning id into m;
 insert into public.entries(company_id,movement_id,fund_id,amount) values(f.company_id,m,p_fund,case when p_kind='income' then a else -a end);
 update public.funds set balance=balance+case when p_kind='income' then a else -a end where id=p_fund;
 if p_kind='transfer' then
  insert into public.entries(company_id,movement_id,fund_id,amount) values(f.company_id,m,p_destination,a);
  update public.funds set balance=balance+a where id=p_destination;
 end if;
 perform private.idempotency_finish(p_operation,p_key,payload,m);
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(f.company_id,auth.uid(),'movement.posted',m);
 return m;
 end;
$$;
create or replace function public.post_movement(p_fund uuid,p_destination uuid,p_category uuid,p_kind text,p_amount text,p_concept text,p_date date,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 begin
 return private.post_movement_core('post_movement',p_fund,p_destination,p_category,p_kind,p_amount,p_concept,p_date,p_key);
 end;
$$;
create or replace function public.submit_draft(p_id uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare d public.drafts; m uuid;
 begin
 select * into d from public.drafts where id=p_id for update;
 if d.created_by is distinct from auth.uid() then raise exception 'FORBIDDEN';end if;
 -- H-48: an already submitted draft returns its movement before re-checking fund access.
 if d.submitted_movement is not null then return d.submitted_movement;end if;
 if not private.can_write_fund(d.fund_id) then raise exception 'FORBIDDEN';end if;
 if p_version is null or d.version<>p_version then raise exception 'DRAFT_CONFLICT';end if;
 m:=private.post_movement_core('submit_draft',d.fund_id,d.destination_id,d.category_id,d.kind,d.amount::text,d.concept,d.operation_date,d.id);
 update public.drafts set submitted_movement=m,updated_at=now() where id=d.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(d.company_id,auth.uid(),'draft.submitted',d.id,jsonb_build_object('movement',m));
 return m;
 end;
$$;
create or replace function public.create_fund(p_company uuid,p_name text,p_kind text,p_opening text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare f uuid; m uuid; a public.cop; payload jsonb;
 begin
 if p_key is null or p_opening is null or p_opening !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'INVALID_AMOUNT'; end if;
 payload:=jsonb_build_object('company',p_company,'name',p_name,'kind',p_kind,'opening',p_opening);
 f:=private.idempotency_begin('create_fund',p_key,payload);
 if f is not null then return f; end if;
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
 a:=p_opening::public.cop;
 insert into public.funds(company_id,name,kind,balance) values(p_company,trim(p_name),p_kind,a) returning id into f;
 -- Legacy registry kept for continuity; operation_requests is authoritative.
 insert into private.fund_requests values(auth.uid(),p_key,payload,f);
 if a>0 then
  insert into public.movements(company_id,fund_id,kind,amount,concept,operation_date,created_by,idempotency_key,request_payload)
  values(p_company,f,'opening',a,'Apertura del fondo',(now() at time zone 'America/Bogota')::date,auth.uid(),p_key,payload) returning id into m;
  insert into public.entries(company_id,movement_id,fund_id,amount) values(p_company,m,f,a);
 end if;
 perform private.idempotency_finish('create_fund',p_key,payload,f);
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(p_company,auth.uid(),'fund.opened',f);
 return f;
 end;
$$;

-- 4. Reversal (H-05, H-06, H-23, H-24, H-48).
-- A reversal is its own dated operation and audit event, never a review: it
-- does not insert into reviews and the reversal movement starts 'pending', so
-- close_period requires an independent approval (reviewer <> reversal author).
create or replace function public.reverse_movement(p_movement uuid,p_reason text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.movements; r uuid; e record; payload jsonb; frozen boolean; today date:=(now() at time zone 'America/Bogota')::date;
 begin
 if p_key is null or p_movement is null or p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'INVALID_REASON'; end if;
 payload:=jsonb_build_object('reverse',p_movement,'reason',trim(p_reason));
 r:=private.idempotency_begin('reverse_movement',p_key,payload);
 if r is not null then return r; end if;
 select * into m from public.movements where id=p_movement;
 if private.company_role(m.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
 -- Consistent lock order across posting, reversing and counting.
 perform id from public.funds where id in (select fund_id from public.entries where movement_id=m.id) order by id for update;
 select * into m from public.movements where id=p_movement for update;
 if m.financial_status<>'posted' or m.kind in ('opening','reversal') then raise exception 'INVALID_REVERSAL'; end if;
 for e in select x.fund_id,x.amount,f.balance,f.closed_through,f.active from public.entries x join public.funds f on f.id=x.fund_id where x.movement_id=m.id order by x.fund_id loop
  if not e.active then raise exception 'FUND_INACTIVE'; end if;
  if today<=e.closed_through then raise exception 'PERIOD_CLOSED'; end if;
  if e.balance-e.amount<0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
  perform private.assert_history_covers(e.fund_id,today,-e.amount);
 end loop;
 frozen:=exists(select 1 from public.entries x join public.funds f on f.id=x.fund_id where x.movement_id=m.id and m.operation_date<=f.closed_through);
 insert into public.movements(company_id,fund_id,destination_id,kind,amount,concept,operation_date,created_by,reversal_of,idempotency_key,request_payload)
 values(m.company_id,m.fund_id,m.destination_id,'reversal',m.amount,trim(p_reason),today,auth.uid(),m.id,p_key,payload) returning id into r;
 insert into public.entries(company_id,movement_id,fund_id,amount) select company_id,r,fund_id,-amount from public.entries where movement_id=m.id;
 update public.funds f set balance=f.balance-ledger.amount from public.entries ledger where ledger.movement_id=m.id and ledger.fund_id=f.id;
 -- H-23: a closure froze this movement's decision; only the financial status changes.
 update public.movements set financial_status='reversed',review_status=case when frozen then review_status else 'rejected' end where id=m.id;
 perform private.idempotency_finish('reverse_movement',p_key,payload,r);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.reversed',m.id,
  jsonb_build_object('reversal',r,'reason',trim(p_reason),'previous_review_status',m.review_status,'review_status_frozen',frozen));
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'reversal.posted',r,jsonb_build_object('original',m.id));
 return r;
 end;
$$;

-- 5. Reviews and checks with idempotency keys (H-25, H-26, H-29, H-48).
drop function public.review_movement(uuid,text,text);
drop function public.record_check(uuid,text,text);
drop function public.review_check(uuid,text,text);
-- H-26: separation of duties is enforced per Auth account (reviewer_id <>
-- created_by). Two accounts controlled by the same person are not detected;
-- membership governance must prevent alias administrators.
create function public.review_movement(p_movement uuid,p_decision text,p_comment text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.movements; payload jsonb; result uuid; note text:=coalesce(p_comment,'');
 begin
 if p_key is null or p_movement is null or p_decision is null or p_decision not in ('approved','observed') or length(note)>2000 then raise exception 'INVALID_REVIEW'; end if;
 payload:=jsonb_build_object('movement',p_movement,'decision',p_decision,'comment',note);
 result:=private.idempotency_begin('review_movement',p_key,payload);
 if result is not null then return result; end if;
 select * into m from public.movements where id=p_movement for update;
 if private.company_role(m.company_id) is distinct from 'admin' or m.created_by=auth.uid() then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from public.entries e join public.funds f on f.id=e.fund_id where e.movement_id=m.id and m.operation_date<=f.closed_through) then raise exception 'PERIOD_CLOSED'; end if;
 if m.financial_status<>'posted' then raise exception 'INVALID_REVIEW'; end if;
 -- H-25: reopening an approval needs an explicit reason.
 if m.review_status='approved' and p_decision='observed' and length(trim(note))<3 then raise exception 'REVIEW_REASON_REQUIRED'; end if;
 insert into public.reviews(movement_id,reviewer_id,decision,comment) values(m.id,auth.uid(),p_decision,note) returning id into result;
 update public.movements set review_status=p_decision where id=m.id;
 perform private.idempotency_finish('review_movement',p_key,payload,result);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.reviewed',m.id,
  jsonb_build_object('decision',p_decision,'comment',note,'previous',m.review_status,'review',result));
 return result;
 end;
$$;
create function public.record_check(p_fund uuid,p_declared text,p_note text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare f public.funds; c uuid; payload jsonb; note text:=coalesce(p_note,'');
 begin
 if p_key is null or p_fund is null then raise exception 'INVALID_REQUEST'; end if;
 if p_declared is null or p_declared !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'INVALID_AMOUNT'; end if;
 payload:=jsonb_build_object('fund',p_fund,'declared',p_declared,'note',note);
 c:=private.idempotency_begin('record_check',p_key,payload);
 if c is not null then return c; end if;
 if not private.can_write_fund(p_fund) then raise exception 'FORBIDDEN'; end if;
 select * into f from public.funds where id=p_fund for update;
 if not private.can_write_fund(p_fund) then raise exception 'FORBIDDEN'; end if;
 -- The theoretical balance is captured under the fund lock; it never adjusts the balance.
 insert into public.checks(company_id,fund_id,kind,theoretical,declared,created_by,note)
 values(f.company_id,f.id,case when f.kind='cash' then 'cash_count' else 'bank_reconciliation' end,f.balance,p_declared::public.cop,auth.uid(),note) returning id into c;
 perform private.idempotency_finish('record_check',p_key,payload,c);
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(f.company_id,auth.uid(),'check.recorded',c);
 return c;
 end;
$$;
create function public.review_check(p_check uuid,p_decision text,p_comment text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare c public.checks; payload jsonb; result uuid; note text:=coalesce(p_comment,'');
 begin
 if p_key is null or p_check is null or p_decision is null or p_decision not in ('approved','observed') or length(note)>2000 then raise exception 'INVALID_REVIEW'; end if;
 payload:=jsonb_build_object('check',p_check,'decision',p_decision,'comment',note);
 result:=private.idempotency_begin('review_check',p_key,payload);
 if result is not null then return result; end if;
 select * into c from public.checks where id=p_check for update;
 if private.company_role(c.company_id) is distinct from 'admin' or c.created_by=auth.uid() then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from public.check_reviews where check_id=c.id and decision='approved') then raise exception 'CHECK_ALREADY_APPROVED';end if;
 insert into public.check_reviews(check_id,reviewer_id,decision,comment) values(c.id,auth.uid(),p_decision,note) returning id into result;
 perform private.idempotency_finish('review_check',p_key,payload,result);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(c.company_id,auth.uid(),'check.reviewed',c.id,jsonb_build_object('decision',p_decision,'comment',note,'review',result));
 return result;
 end;
$$;

-- 6. Closures (H-05, H-24, H-27, H-48). Flow totals use unbounded numeric; balances stay cop.
alter table public.period_closures
 alter column income type numeric, alter column expenses type numeric,
 alter column transfers_net type numeric, alter column reversals_net type numeric;
alter table public.period_closures add constraint period_closures_integral_flows check(
 income=trunc(income) and expenses=trunc(expenses) and transfers_net=trunc(transfers_net) and reversals_net=trunc(reversals_net) and income>=0 and expenses>=0);
-- NOT VALID: closures already frozen remotely may hold negative balances (H-05)
-- and are immutable; the constraint applies to every new closure.
alter table public.period_closures add constraint period_closures_nonnegative_balances check(opening_balance>=0 and closing_balance>=0) not valid;
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
 -- Reversals need an independent approval like any posted operation; openings are exempt.
 if exists(select 1 from public.movements m join public.entries e on e.movement_id=m.id where e.fund_id=p_fund and m.operation_date<=p_cutoff and (f.closed_through is null or m.operation_date>f.closed_through) and m.kind<>'opening' and m.financial_status='posted' and m.review_status<>'approved') then raise exception 'UNREVIEWED_MOVEMENTS';end if;
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

-- 7. Database-level immutability (H-30).
-- Movements only change review/financial status through valid transitions;
-- amounts, funds, dates, authorship and keys never change.
create function private.guard_movement() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_RECORD'; end if;
 if (to_jsonb(new)-'financial_status'-'review_status') is distinct from (to_jsonb(old)-'financial_status'-'review_status') then raise exception 'IMMUTABLE_RECORD'; end if;
 if new.financial_status is distinct from old.financial_status and not (old.financial_status='posted' and new.financial_status='reversed') then raise exception 'INVALID_STATUS_TRANSITION'; end if;
 if new.review_status is distinct from old.review_status then
  if old.financial_status='reversed' or old.review_status='rejected' or new.review_status='pending'
   or (new.review_status='rejected' and new.financial_status<>'reversed') then raise exception 'INVALID_STATUS_TRANSITION'; end if;
  if exists(select 1 from public.entries e join public.funds f on f.id=e.fund_id where e.movement_id=old.id and old.operation_date<=f.closed_through) then raise exception 'PERIOD_CLOSED'; end if;
 end if;
 return new;
 end;
$$;
create trigger guard_movements before update or delete on public.movements for each row execute function private.guard_movement();
create trigger forbid_truncate_entries before truncate on public.entries for each statement execute function private.immutable_record();
create trigger forbid_truncate_movements before truncate on public.movements for each statement execute function private.immutable_record();
create trigger forbid_truncate_period_closures before truncate on public.period_closures for each statement execute function private.immutable_record();
create trigger forbid_truncate_audit_events before truncate on public.audit_events for each statement execute function private.immutable_record();
create trigger forbid_truncate_reviews before truncate on public.reviews for each statement execute function private.immutable_record();
create trigger forbid_truncate_checks before truncate on public.checks for each statement execute function private.immutable_record();
create trigger forbid_truncate_check_reviews before truncate on public.check_reviews for each statement execute function private.immutable_record();

-- 8. Reports: deterministic totals order (H-49). Same signature and grants.
create or replace function public.financial_report(p_company uuid,p_fund uuid,p_from date,p_to date,p_kind text default null,p_review text default null,p_category uuid default null,p_author uuid default null,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
 declare result jsonb;
 begin
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 or p_offset<0 or p_offset>100000 then raise exception 'INVALID_REPORT_RANGE';end if;
 with allowed as (
 select f.id,f.company_id,f.name,c.name company_name from public.funds f join public.companies c on c.id=f.company_id
 where (p_company is null or f.company_id=p_company) and (p_fund is null or f.id=p_fund)
 ), totals as (
 select f.id,f.name,f.company_name,
 coalesce(sum(e.amount) filter(where m.operation_date<p_from),0)::text opening_balance,
 coalesce(sum(e.amount) filter(where m.operation_date between p_from and p_to and m.kind='opening'),0)::text opening_funding,
 coalesce(sum(e.amount) filter(where m.operation_date between p_from and p_to and m.kind='income'),0)::text income,
 coalesce(-sum(e.amount) filter(where m.operation_date between p_from and p_to and m.kind='expense'),0)::text expenses,
 coalesce(sum(e.amount) filter(where m.operation_date between p_from and p_to and m.kind='transfer'),0)::text transfers_net,
 coalesce(sum(e.amount) filter(where m.operation_date between p_from and p_to and m.kind='reversal'),0)::text reversals_net,
 coalesce(sum(e.amount) filter(where m.operation_date<=p_to),0)::text closing_balance
 from allowed f left join public.entries e on e.fund_id=f.id left join public.movements m on m.id=e.movement_id group by f.id,f.name,f.company_name
 ), details as (
 select e.id entry_id,m.id movement_id,f.id fund_id,f.name fund_name,f.company_name,m.operation_date,m.kind,m.concept,m.review_status,m.financial_status,m.created_by,e.amount::text signed_amount
 from allowed f join public.entries e on e.fund_id=f.id join public.movements m on m.id=e.movement_id
 where m.operation_date between p_from and p_to and (p_kind is null or m.kind=p_kind) and (p_review is null or m.review_status=p_review)
 and (p_category is null or m.category_id=p_category) and (p_author is null or m.created_by=p_author)
 ) select jsonb_build_object('from',p_from,'to',p_to,'totals',coalesce((select jsonb_agg(to_jsonb(t) order by t.company_name,t.name,t.id) from totals t),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(d) order by d.operation_date,d.entry_id) from (select * from details order by operation_date,entry_id limit 200 offset p_offset) d),'[]'::jsonb),
 'total_entries',(select count(*) from details),'offset',p_offset) into result;
 return result;
 end;
$$;

-- 9. Privileges. New RPCs: EXECUTE only for authenticated. Helpers: nobody.
revoke all on function public.review_movement(uuid,text,text,uuid),public.record_check(uuid,text,text,uuid),public.review_check(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.review_movement(uuid,text,text,uuid),public.record_check(uuid,text,text,uuid),public.review_check(uuid,text,text,uuid) to authenticated;
revoke all on function private.idempotency_begin(text,uuid,jsonb),private.idempotency_finish(text,uuid,jsonb,uuid),private.assert_history_covers(uuid,date,numeric),
 private.post_movement_core(text,uuid,uuid,uuid,text,text,text,date,uuid),private.guard_movement() from public,anon,authenticated;
-- H-30: the Supabase service_role keeps read access but loses direct writes on
-- financial tables; all money changes go through the audited RPCs above.
do $$
begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  revoke insert,update,delete,truncate,references,trigger on public.funds,public.movements,public.entries,public.reviews,public.checks,public.check_reviews,public.period_closures,public.audit_events from service_role;
  revoke all on private.operation_requests,private.fund_requests from service_role;
  revoke all on function public.review_movement(uuid,text,text,uuid),public.record_check(uuid,text,text,uuid),public.review_check(uuid,text,text,uuid),
   private.idempotency_begin(text,uuid,jsonb),private.idempotency_finish(text,uuid,jsonb,uuid),private.assert_history_covers(uuid,date,numeric),
   private.post_movement_core(text,uuid,uuid,uuid,text,text,text,date,uuid),private.guard_movement() from service_role;
 end if;
end $$;
