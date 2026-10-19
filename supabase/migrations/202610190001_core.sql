-- CUADRIA: all money writes happen inside authorized, atomic RPCs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create domain public.cop as numeric check (value = trunc(value) and abs(value) <= 999999999999999999);
create table public.installation_owners (user_id uuid primary key references auth.users(id));
create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 2 and 120),
 nit text not null unique check(length(nit) between 5 and 20), created_at timestamptz not null default now()
);
create table public.memberships (
 company_id uuid references public.companies(id), user_id uuid references auth.users(id),
 role text not null check(role in ('admin','employee','auditor')), active boolean not null default true,
 primary key(company_id,user_id)
);
create table public.funds (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 2 and 120), kind text not null check(kind in ('cash','bank')),
 currency text not null default 'COP' check(currency='COP'), active boolean not null default true,
 balance public.cop not null default 0 check(balance>=0), closed_through date,
 created_at timestamptz not null default now(), unique(company_id,id)
);
create table public.assignments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, fund_id uuid not null, user_id uuid not null,
 started_at timestamptz not null default now(), ended_at timestamptz,
 foreign key(company_id,fund_id) references public.funds(company_id,id),
 foreign key(company_id,user_id) references public.memberships(company_id,user_id),
 check(ended_at is null or ended_at>=started_at)
);
create unique index assignment_current on public.assignments(fund_id,user_id) where ended_at is null;
create table public.categories (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 2 and 100), unique(company_id,id), unique(company_id,name)
);
create table public.movements (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, fund_id uuid not null,
 destination_id uuid, category_id uuid, kind text not null check(kind in ('opening','income','expense','transfer','reversal')),
 amount public.cop not null check(amount>0), concept text not null check(length(trim(concept)) between 3 and 500),
 operation_date date not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 posted_at timestamptz not null default now(), financial_status text not null default 'posted' check(financial_status in ('posted','reversed')),
 review_status text not null default 'pending' check(review_status in ('pending','approved','observed','rejected')),
 reversal_of uuid unique references public.movements(id), idempotency_key uuid not null, request_payload jsonb not null,
 foreign key(company_id,fund_id) references public.funds(company_id,id),
 foreign key(company_id,destination_id) references public.funds(company_id,id),
 foreign key(company_id,category_id) references public.categories(company_id,id),
 check(destination_id is null or destination_id<>fund_id),
 check((kind='transfer') = (destination_id is not null) or kind='reversal'),
 unique(created_by,idempotency_key), unique(company_id,id)
);
create table public.entries (
 id bigint generated always as identity primary key, company_id uuid not null, movement_id uuid not null, fund_id uuid not null,
 amount public.cop not null check(amount<>0), created_at timestamptz not null default now(),
 foreign key(company_id,movement_id) references public.movements(company_id,id),
 foreign key(company_id,fund_id) references public.funds(company_id,id), unique(movement_id,fund_id)
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), movement_id uuid not null references public.movements(id),
 reviewer_id uuid not null references auth.users(id), decision text not null check(decision in ('approved','observed','rejected')),
 comment text not null default '' check(length(comment)<=2000), created_at timestamptz not null default now()
);
create table public.checks (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, fund_id uuid not null,
 kind text not null check(kind in ('cash_count','bank_reconciliation')), theoretical public.cop not null,
 declared public.cop not null check(declared>=0), difference public.cop generated always as (declared-theoretical) stored,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 note text not null default '' check(length(note)<=2000),
 foreign key(company_id,fund_id) references public.funds(company_id,id)
);
create table public.audit_events (
 id bigint generated always as identity primary key, company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id), action text not null, entity_id uuid not null,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index memberships_user on public.memberships(user_id,company_id) where active;
create index assignments_user on public.assignments(user_id,fund_id) where ended_at is null;
create index movements_fund_date on public.movements(fund_id,operation_date,created_at);
create index entries_fund on public.entries(fund_id,id);
create index checks_fund on public.checks(fund_id,created_at desc);
create index reviews_movement on public.reviews(movement_id,created_at);
create index audit_company on public.audit_events(company_id,created_at);

create function private.company_role(c uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.memberships where company_id=c and user_id=auth.uid() and active;
$$;
create function private.can_read_fund(f uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.funds x where x.id=f and (
 private.company_role(x.company_id) in ('admin','auditor') or
 (private.company_role(x.company_id)='employee' and exists(select 1 from public.assignments a where a.fund_id=f and a.user_id=auth.uid() and a.ended_at is null))));
$$;
create function private.can_write_fund(f uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.funds x where x.id=f and x.active and (
 private.company_role(x.company_id)='admin' or
 (private.company_role(x.company_id)='employee' and exists(select 1 from public.assignments a where a.fund_id=f and a.user_id=auth.uid() and a.ended_at is null))));
$$;
create function private.immutable_record() returns trigger language plpgsql set search_path='' as $$
 begin raise exception 'IMMUTABLE_RECORD'; end;
$$;
create trigger immutable_entries before update or delete on public.entries for each row execute function private.immutable_record();
create trigger immutable_reviews before update or delete on public.reviews for each row execute function private.immutable_record();
create trigger immutable_checks before update or delete on public.checks for each row execute function private.immutable_record();
create trigger immutable_audit before update or delete on public.audit_events for each row execute function private.immutable_record();

alter table public.installation_owners enable row level security;
alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.funds enable row level security;
alter table public.assignments enable row level security;
alter table public.categories enable row level security;
alter table public.movements enable row level security;
alter table public.entries enable row level security;
alter table public.reviews enable row level security;
alter table public.checks enable row level security;
alter table public.audit_events enable row level security;
create policy company_read on public.companies for select to authenticated using(private.company_role(id) is not null);
create policy membership_read on public.memberships for select to authenticated using(user_id=auth.uid() or private.company_role(company_id) in ('admin','auditor'));
create policy fund_read on public.funds for select to authenticated using(private.can_read_fund(id));
create policy assignment_read on public.assignments for select to authenticated using(private.can_read_fund(fund_id));
create policy category_read on public.categories for select to authenticated using(private.company_role(company_id) is not null);
create policy movement_read on public.movements for select to authenticated using(private.can_read_fund(fund_id) or private.can_read_fund(destination_id));
create policy entry_read on public.entries for select to authenticated using(private.can_read_fund(fund_id));
create policy review_read on public.reviews for select to authenticated using(exists(select 1 from public.movements m where m.id=movement_id));
create policy check_read on public.checks for select to authenticated using(private.can_read_fund(fund_id));
create policy audit_read on public.audit_events for select to authenticated using(private.company_role(company_id) in ('admin','auditor'));
revoke all on all tables in schema public from anon, authenticated;
grant select on public.companies,public.memberships,public.funds,public.assignments,public.categories,public.movements,public.entries,public.reviews,public.checks,public.audit_events to authenticated;

create function public.create_company(p_name text,p_nit text) returns uuid language plpgsql security definer set search_path='' as $$
 declare c uuid;
 begin
 if not exists(select 1 from public.installation_owners where user_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
 insert into public.companies(name,nit) values(trim(p_name),trim(p_nit)) returning id into c;
 insert into public.memberships values(c,auth.uid(),'admin',true);
 insert into public.categories(company_id,name) values(c,'General');
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(c,auth.uid(),'company.created',c);
 return c;
 end;
$$;
create function public.assign_member(p_company uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if private.company_role(p_company) is distinct from 'admin' or p_user=auth.uid() then raise exception 'FORBIDDEN'; end if;
 insert into public.memberships values(p_company,p_user,p_role,true) on conflict(company_id,user_id) do update set role=excluded.role,active=true;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(p_company,auth.uid(),'membership.assigned',p_user,jsonb_build_object('role',p_role));
 end;
$$;
create function public.assign_fund(p_fund uuid,p_user uuid,p_end boolean default false) returns void language plpgsql security definer set search_path='' as $$
 declare c uuid;
 begin
 select company_id into c from public.funds where id=p_fund for update;
 if private.company_role(c) is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.memberships where company_id=c and user_id=p_user and active and role='employee') then raise exception 'INVALID_MEMBER'; end if;
 if p_end then update public.assignments set ended_at=clock_timestamp() where fund_id=p_fund and user_id=p_user and ended_at is null;
 else insert into public.assignments(company_id,fund_id,user_id) values(c,p_fund,p_user); end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(c,auth.uid(),'fund.assignment',p_fund,jsonb_build_object('user',p_user,'ended',p_end));
 end;
$$;
create table private.fund_requests (
 user_id uuid not null references auth.users(id), key uuid not null, payload jsonb not null,
 fund_id uuid not null references public.funds(id), primary key(user_id,key)
);
create function public.create_fund(p_company uuid,p_name text,p_kind text,p_opening text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare f uuid; m uuid; a public.cop; payload jsonb; prior public.movements; req private.fund_requests;
 begin
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_opening !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'INVALID_AMOUNT'; end if;
 a:=p_opening::public.cop;
 payload:=jsonb_build_object('company',p_company,'name',p_name,'kind',p_kind,'opening',p_opening);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into req from private.fund_requests where user_id=auth.uid() and key=p_key;
 if found then if req.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return req.fund_id; end if;
 if exists(select 1 from public.movements where created_by=auth.uid() and idempotency_key=p_key) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 insert into public.funds(company_id,name,kind,balance) values(p_company,trim(p_name),p_kind,a) returning id into f;
 insert into private.fund_requests values(auth.uid(),p_key,payload,f);
 if a>0 then
 insert into public.movements(company_id,fund_id,kind,amount,concept,operation_date,created_by,idempotency_key,request_payload)
 values(p_company,f,'opening',a,'Apertura del fondo',(now() at time zone 'America/Bogota')::date,auth.uid(),p_key,payload) returning id into m;
 insert into public.entries(company_id,movement_id,fund_id,amount) values(p_company,m,f,a);
 end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(p_company,auth.uid(),'fund.opened',f);
 return f;
 end;
$$;
create function public.post_movement(p_fund uuid,p_destination uuid,p_category uuid,p_kind text,p_amount text,p_concept text,p_date date,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare f public.funds; d public.funds; prior public.movements; a public.cop; payload jsonb; m uuid;
 begin
 if not private.can_write_fund(p_fund) or (p_destination is not null and not private.can_write_fund(p_destination)) then raise exception 'FORBIDDEN'; end if;
 if p_kind not in ('income','expense','transfer') or p_key is null or p_amount !~ '^[1-9][0-9]{0,17}$' then raise exception 'INVALID_MOVEMENT'; end if;
 if (p_kind='transfer')<>(p_destination is not null) or p_destination=p_fund then raise exception 'INVALID_DESTINATION'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Bogota')::date then raise exception 'INVALID_DATE'; end if;
 a:=p_amount::public.cop;
 payload:=jsonb_build_object('fund',p_fund,'destination',p_destination,'category',p_category,'kind',p_kind,'amount',p_amount,'concept',p_concept,'date',p_date);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into prior from public.movements where created_by=auth.uid() and idempotency_key=p_key;
 if found then if prior.request_payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return prior.id; end if;
 perform id from public.funds where id in (p_fund,p_destination) order by id for update;
 select * into f from public.funds where id=p_fund;
 if not private.can_write_fund(p_fund) then raise exception 'FORBIDDEN'; end if;
 if p_date<=f.closed_through then raise exception 'PERIOD_CLOSED'; end if;
 if p_destination is not null then
 select * into d from public.funds where id=p_destination;
 if not private.can_write_fund(p_destination) or d.company_id<>f.company_id then raise exception 'INVALID_DESTINATION'; end if;
 if p_date<=d.closed_through then raise exception 'PERIOD_CLOSED'; end if;
 end if;
 if p_kind in ('expense','transfer') and f.balance<a then raise exception 'INSUFFICIENT_FUNDS'; end if;
 insert into public.movements(company_id,fund_id,destination_id,category_id,kind,amount,concept,operation_date,created_by,idempotency_key,request_payload)
 values(f.company_id,p_fund,p_destination,p_category,p_kind,a,trim(p_concept),p_date,auth.uid(),p_key,payload) returning id into m;
 insert into public.entries(company_id,movement_id,fund_id,amount) values(f.company_id,m,p_fund,case when p_kind='income' then a else -a end);
 update public.funds set balance=balance+case when p_kind='income' then a else -a end where id=p_fund;
 if p_kind='transfer' then
 insert into public.entries(company_id,movement_id,fund_id,amount) values(f.company_id,m,p_destination,a);
 update public.funds set balance=balance+a where id=p_destination;
 end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(f.company_id,auth.uid(),'movement.posted',m);
 return m;
 end;
$$;
create function public.review_movement(p_movement uuid,p_decision text,p_comment text) returns void language plpgsql security definer set search_path='' as $$
 declare m public.movements;
 begin
 select * into m from public.movements where id=p_movement for update;
 if private.company_role(m.company_id) is distinct from 'admin' or m.created_by=auth.uid() then raise exception 'FORBIDDEN'; end if;
 if m.financial_status<>'posted' or p_decision not in ('approved','observed') then raise exception 'INVALID_REVIEW'; end if;
 insert into public.reviews(movement_id,reviewer_id,decision,comment) values(m.id,auth.uid(),p_decision,p_comment);
 update public.movements set review_status=p_decision where id=m.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.reviewed',m.id,jsonb_build_object('decision',p_decision,'comment',p_comment));
 end;
$$;
create function public.reverse_movement(p_movement uuid,p_reason text,p_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.movements; r uuid; e record; payload jsonb; prior public.movements;
 begin
 select * into m from public.movements where id=p_movement;
 if private.company_role(m.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN'; end if;
 if p_key is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'INVALID_REASON'; end if;
 payload:=jsonb_build_object('reverse',p_movement,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into prior from public.movements where created_by=auth.uid() and idempotency_key=p_key;
 if found then if prior.request_payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return prior.id; end if;
 -- Consistent lock order across posting, reversing and counting.
 perform id from public.funds where id in (select fund_id from public.entries where movement_id=m.id) order by id for update;
 select * into m from public.movements where id=p_movement for update;
 if m.financial_status<>'posted' or m.kind in ('opening','reversal') then raise exception 'INVALID_REVERSAL'; end if;
 for e in select x.fund_id,x.amount,f.balance,f.closed_through from public.entries x join public.funds f on f.id=x.fund_id where x.movement_id=m.id loop
 if e.balance-e.amount<0 then raise exception 'INSUFFICIENT_FUNDS'; end if;
 if (now() at time zone 'America/Bogota')::date<=e.closed_through then raise exception 'PERIOD_CLOSED'; end if;
 end loop;
 insert into public.movements(company_id,fund_id,destination_id,kind,amount,concept,operation_date,created_by,reversal_of,idempotency_key,request_payload)
 values(m.company_id,m.fund_id,m.destination_id,'reversal',m.amount,trim(p_reason),(now() at time zone 'America/Bogota')::date,auth.uid(),m.id,p_key,payload) returning id into r;
 insert into public.entries(company_id,movement_id,fund_id,amount) select company_id,r,fund_id,-amount from public.entries where movement_id=m.id;
 update public.funds f set balance=f.balance-ledger.amount from public.entries ledger where ledger.movement_id=m.id and ledger.fund_id=f.id;
 update public.movements set financial_status='reversed',review_status='rejected' where id=m.id;
 insert into public.reviews(movement_id,reviewer_id,decision,comment) values(m.id,auth.uid(),'rejected',p_reason);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.reversed',m.id,jsonb_build_object('reversal',r,'reason',p_reason));
 return r;
 end;
$$;
create function public.record_check(p_fund uuid,p_declared text,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
 declare f public.funds; c uuid;
 begin
 if not private.can_write_fund(p_fund) then raise exception 'FORBIDDEN'; end if;
 if p_declared !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'INVALID_AMOUNT'; end if;
 select * into f from public.funds where id=p_fund for update;
 insert into public.checks(company_id,fund_id,kind,theoretical,declared,created_by,note)
 values(f.company_id,f.id,case when f.kind='cash' then 'cash_count' else 'bank_reconciliation' end,f.balance,p_declared::public.cop,auth.uid(),p_note) returning id into c;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(f.company_id,auth.uid(),'check.recorded',c);
 return c;
 end;
$$;
-- Security-invoker JSON RPC: numeric monetary columns are converted to strings before serialization.
create function public.workspace_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'companies',coalesce((select jsonb_agg(to_jsonb(c)) from public.companies c),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.memberships m where m.user_id=auth.uid()),'[]'::jsonb),
 'funds',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('balance',f.balance::text)) from public.funds f),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c)) from public.categories c),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(to_jsonb(m)-'request_payload'||jsonb_build_object('amount',m.amount::text)) from (select * from public.movements order by created_at desc limit 100) m),'[]'::jsonb),
 'checks',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('theoretical',c.theoretical::text,'declared',c.declared::text,'difference',c.difference::text)) from (select * from public.checks order by created_at desc limit 100) c),'[]'::jsonb)
 );
$$;
revoke all on all functions in schema public from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.company_role(uuid),private.can_read_fund(uuid),private.can_write_fund(uuid) to authenticated;
grant execute on function public.create_company(text,text),public.assign_member(uuid,uuid,text),public.assign_fund(uuid,uuid,boolean),public.create_fund(uuid,text,text,text,uuid),public.post_movement(uuid,uuid,uuid,text,text,text,date,uuid),public.review_movement(uuid,text,text),public.reverse_movement(uuid,text,uuid),public.record_check(uuid,text,text),public.workspace_snapshot() to authenticated;
