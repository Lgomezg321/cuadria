-- Drafts have no ledger entries. Submission delegates to the same posting engine.
create table public.drafts (
 id uuid primary key, company_id uuid not null, fund_id uuid not null, destination_id uuid, category_id uuid,
 kind text not null check(kind in ('income','expense','transfer')), amount public.cop not null check(amount>0),
 concept text not null check(length(trim(concept)) between 3 and 500), operation_date date not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0), submitted_movement uuid unique references public.movements(id),
 foreign key(company_id,fund_id) references public.funds(company_id,id),
 foreign key(company_id,destination_id) references public.funds(company_id,id),
 foreign key(company_id,category_id) references public.categories(company_id,id),
 check((kind='transfer')=(destination_id is not null)),check(destination_id is null or destination_id<>fund_id)
);
alter table public.drafts enable row level security;
create policy draft_read on public.drafts for select to authenticated using(created_by=auth.uid() and private.can_read_fund(fund_id));
revoke all on public.drafts from anon,authenticated;
grant select on public.drafts to authenticated;
create index drafts_author on public.drafts(created_by,updated_at desc);

create function public.save_draft(p_id uuid,p_version integer,p_fund uuid,p_destination uuid,p_category uuid,p_kind text,p_amount text,p_concept text,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
 declare c uuid; d public.drafts;
 begin
 if not private.can_write_fund(p_fund) or (p_destination is not null and not private.can_write_fund(p_destination)) then raise exception 'FORBIDDEN';end if;
 if p_amount !~ '^[1-9][0-9]{0,17}$' or p_version is null or p_version<0 then raise exception 'INVALID_MOVEMENT';end if;
 select company_id into c from public.funds where id=p_fund;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,42));
 select * into d from public.drafts where id=p_id for update;
 if found then
 if d.created_by<>auth.uid() or d.submitted_movement is not null then raise exception 'FORBIDDEN';end if;
 if p_version is null or d.version<>p_version then raise exception 'DRAFT_CONFLICT';end if;
 update public.drafts set company_id=c,fund_id=p_fund,destination_id=p_destination,category_id=p_category,kind=p_kind,amount=p_amount::public.cop,concept=trim(p_concept),operation_date=p_date,updated_at=now(),version=version+1 where id=p_id;
 else
 if p_version<>0 then raise exception 'DRAFT_CONFLICT';end if;
 insert into public.drafts(id,company_id,fund_id,destination_id,category_id,kind,amount,concept,operation_date,created_by)
 values(p_id,c,p_fund,p_destination,p_category,p_kind,p_amount::public.cop,trim(p_concept),p_date,auth.uid());
 end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(c,auth.uid(),'draft.saved',p_id);
 return p_id;
 end;
$$;
create function public.submit_draft(p_id uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare d public.drafts; m uuid;
 begin
 select * into d from public.drafts where id=p_id for update;
 if d.created_by is distinct from auth.uid() or not private.can_write_fund(d.fund_id) then raise exception 'FORBIDDEN';end if;
 if d.submitted_movement is not null then return d.submitted_movement;end if;
 if p_version is null or d.version<>p_version then raise exception 'DRAFT_CONFLICT';end if;
 m:=public.post_movement(d.fund_id,d.destination_id,d.category_id,d.kind,d.amount::text,d.concept,d.operation_date,d.id);
 update public.drafts set submitted_movement=m,updated_at=now() where id=d.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(d.company_id,auth.uid(),'draft.submitted',d.id,jsonb_build_object('movement',m));
 return m;
 end;
$$;
create table public.check_reviews (
 id uuid primary key default gen_random_uuid(), check_id uuid not null references public.checks(id),
 reviewer_id uuid not null references auth.users(id),decision text not null check(decision in ('approved','observed')),
 comment text not null check(length(comment)<=2000), created_at timestamptz not null default now()
);
alter table public.check_reviews enable row level security;
create policy check_review_read on public.check_reviews for select to authenticated using(exists(select 1 from public.checks c where c.id=check_id));
revoke all on public.check_reviews from anon,authenticated;
grant select on public.check_reviews to authenticated;
create trigger immutable_check_reviews before update or delete on public.check_reviews for each row execute function private.immutable_record();
create function public.review_check(p_check uuid,p_decision text,p_comment text) returns void language plpgsql security definer set search_path='' as $$
 declare c public.checks;
 begin
 select * into c from public.checks where id=p_check for update;
 if private.company_role(c.company_id) is distinct from 'admin' or c.created_by=auth.uid() then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from public.check_reviews where check_id=c.id and decision='approved') then raise exception 'CHECK_ALREADY_APPROVED';end if;
 insert into public.check_reviews(check_id,reviewer_id,decision,comment) values(c.id,auth.uid(),p_decision,p_comment);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(c.company_id,auth.uid(),'check.reviewed',c.id,jsonb_build_object('decision',p_decision,'comment',p_comment));
 end;
$$;
create table public.period_closures (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,fund_id uuid not null,cutoff date not null,previous_cutoff date,
 opening_balance public.cop not null,income public.cop not null,expenses public.cop not null,transfers_net public.cop not null,reversals_net public.cop not null,closing_balance public.cop not null,
 movement_ids uuid[] not null,approved_by uuid not null references auth.users(id),approved_at timestamptz not null default now(),note text not null check(length(note)<=2000),
 foreign key(company_id,fund_id) references public.funds(company_id,id),unique(fund_id,cutoff),
 check(opening_balance+income-expenses+transfers_net+reversals_net=closing_balance)
);
alter table public.period_closures enable row level security;
create policy closure_read on public.period_closures for select to authenticated using(private.can_read_fund(fund_id));
revoke all on public.period_closures from anon,authenticated;
grant select on public.period_closures to authenticated;
create trigger immutable_closures before update or delete on public.period_closures for each row execute function private.immutable_record();

create function public.close_period(p_fund uuid,p_cutoff date,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
 declare f public.funds; result uuid; initial public.cop; inc public.cop; exp public.cop; transfers public.cop; reversals public.cop; final public.cop; ids uuid[];
 begin
 select * into f from public.funds where id=p_fund for update;
 if private.company_role(f.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 select id into result from public.period_closures where fund_id=p_fund and cutoff=p_cutoff;
 if found then return result;end if;
 if p_cutoff is null or p_cutoff>(now() at time zone 'America/Bogota')::date or p_cutoff<(f.created_at at time zone 'America/Bogota')::date or p_cutoff<=f.closed_through then raise exception 'INVALID_CUTOFF';end if;
 -- Lock every affected movement in a deterministic order before freezing reviews.
 perform m.id from public.movements m where m.id in (select e.movement_id from public.entries e where e.fund_id=p_fund) and m.operation_date<=p_cutoff order by m.id for update;
 if exists(select 1 from public.movements m join public.entries e on e.movement_id=m.id where e.fund_id=p_fund and m.operation_date<=p_cutoff and (f.closed_through is null or m.operation_date>f.closed_through) and m.kind not in ('opening','reversal') and m.financial_status='posted' and m.review_status<>'approved') then raise exception 'UNREVIEWED_MOVEMENTS';end if;
 select coalesce(sum(e.amount) filter(where (f.closed_through is not null and m.operation_date<=f.closed_through) or (f.closed_through is null and m.kind='opening')),0),
 coalesce(sum(e.amount) filter(where m.kind='income' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(-sum(e.amount) filter(where m.kind='expense' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount) filter(where m.kind='transfer' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount) filter(where m.kind='reversal' and (f.closed_through is null or m.operation_date>f.closed_through)),0),
 coalesce(sum(e.amount),0),coalesce(array_agg(m.id) filter(where f.closed_through is null or m.operation_date>f.closed_through),'{}'::uuid[])
 into initial,inc,exp,transfers,reversals,final,ids
 from public.entries e join public.movements m on m.id=e.movement_id where e.fund_id=p_fund and m.operation_date<=p_cutoff;
 insert into public.period_closures(company_id,fund_id,cutoff,previous_cutoff,opening_balance,income,expenses,transfers_net,reversals_net,closing_balance,movement_ids,approved_by,note)
 values(f.company_id,p_fund,p_cutoff,f.closed_through,initial,inc,exp,transfers,reversals,final,ids,auth.uid(),p_note) returning id into result;
 update public.funds set closed_through=p_cutoff where id=p_fund;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(f.company_id,auth.uid(),'period.closed',result,jsonb_build_object('cutoff',p_cutoff,'balance',final::text));
 return result;
 end;
$$;
-- Preserve approvals included in a closed period. Compensatory reversal remains
-- allowed through reverse_movement, which records a new dated operation and audit.
create or replace function public.review_movement(p_movement uuid,p_decision text,p_comment text) returns void language plpgsql security definer set search_path='' as $$
 declare m public.movements;
 begin
 select * into m from public.movements where id=p_movement for update;
 if private.company_role(m.company_id) is distinct from 'admin' or m.created_by=auth.uid() then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from public.entries e join public.funds f on f.id=e.fund_id where e.movement_id=m.id and m.operation_date<=f.closed_through) then raise exception 'PERIOD_CLOSED';end if;
 if m.financial_status<>'posted' or p_decision not in ('approved','observed') then raise exception 'INVALID_REVIEW';end if;
 insert into public.reviews(movement_id,reviewer_id,decision,comment) values(m.id,auth.uid(),p_decision,p_comment);
 update public.movements set review_status=p_decision where id=m.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.reviewed',m.id,jsonb_build_object('decision',p_decision,'comment',p_comment));
 end;
$$;
create function public.controls_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('amount',d.amount::text)) from (select * from public.drafts where submitted_movement is null order by updated_at desc limit 100) d),'[]'::jsonb),
 'closures',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('opening_balance',c.opening_balance::text,'income',c.income::text,'expenses',c.expenses::text,'transfers_net',c.transfers_net::text,'reversals_net',c.reversals_net::text,'closing_balance',c.closing_balance::text)) from (select * from public.period_closures order by approved_at desc limit 100) c),'[]'::jsonb),
 'check_reviews',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.check_reviews order by created_at desc limit 100) r),'[]'::jsonb)
 );
$$;
revoke all on function public.save_draft(uuid,integer,uuid,uuid,uuid,text,text,text,date),public.submit_draft(uuid,integer),public.close_period(uuid,date,text),public.review_check(uuid,text,text),public.controls_snapshot() from public,anon,authenticated;
grant execute on function public.save_draft(uuid,integer,uuid,uuid,uuid,text,text,text,date),public.submit_draft(uuid,integer),public.close_period(uuid,date,text),public.review_check(uuid,text,text),public.controls_snapshot() to authenticated;
