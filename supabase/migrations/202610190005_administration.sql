create table public.invitations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 email text not null check(email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email)<=254),
 role text not null check(role in ('employee','auditor','admin')),invited_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',accepted_by uuid references auth.users(id),accepted_at timestamptz,revoked_at timestamptz
);
alter table public.invitations enable row level security;
create policy invitation_read on public.invitations for select to authenticated using(private.company_role(company_id)='admin');
revoke all on public.invitations from anon,authenticated;
grant select on public.invitations to authenticated;
create index invitation_email on public.invitations(email) where accepted_at is null and revoked_at is null;
create function public.create_invitation(p_company uuid,p_email text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||lower(trim(p_email)),12));
 if exists(select 1 from public.invitations where company_id=p_company and email=lower(trim(p_email)) and created_at>now()-interval '1 minute') then raise exception 'INVITATION_RATE_LIMIT';end if;
 update public.invitations set revoked_at=now() where company_id=p_company and email=lower(trim(p_email)) and accepted_at is null and revoked_at is null;
 insert into public.invitations(company_id,email,role,invited_by) values(p_company,lower(trim(p_email)),p_role,auth.uid()) returning id into result;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(p_company,auth.uid(),'invitation.created',result);
 return result;
 end;
$$;
create function public.accept_invitations() returns integer language plpgsql security definer set search_path='' as $$
 declare email_value text; item public.invitations; accepted integer:=0;
 begin
 select lower(email) into email_value from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if email_value is null then raise exception 'EMAIL_NOT_VERIFIED';end if;
 for item in select * from public.invitations where email=email_value and expires_at>now() and accepted_at is null and revoked_at is null order by id for update loop
 insert into public.memberships(company_id,user_id,role) values(item.company_id,auth.uid(),item.role) on conflict do nothing;
 update public.invitations set accepted_by=auth.uid(),accepted_at=now() where id=item.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(item.company_id,auth.uid(),'invitation.accepted',item.id);
 accepted:=accepted+1;
 end loop;
 return accepted;
 end;
$$;
create function public.revoke_invitation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
 declare invitation public.invitations;
 begin
 select * into invitation from public.invitations where id=p_id for update;
 if private.company_role(invitation.company_id) is distinct from 'admin' or invitation.accepted_at is not null then raise exception 'FORBIDDEN';end if;
 update public.invitations set revoked_at=now() where id=p_id;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(invitation.company_id,auth.uid(),'invitation.revoked',p_id);
 end;
$$;
create function public.create_category(p_company uuid,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 insert into public.categories(company_id,name) values(p_company,trim(p_name)) returning id into result;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(p_company,auth.uid(),'category.created',result);
 return result;
 end;
$$;
create function public.set_fund_active(p_fund uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
 declare f public.funds;
 begin
 select * into f from public.funds where id=p_fund for update;
 if private.company_role(f.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 if p_active=false and f.balance<>0 then raise exception 'FUND_HAS_BALANCE';end if;
 update public.funds set active=p_active where id=p_fund;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(f.company_id,auth.uid(),'fund.status',p_fund,jsonb_build_object('active',p_active));
 end;
$$;
create function public.member_directory(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
 begin
 if private.company_role(p_company) not in ('admin','auditor') or private.company_role(p_company) is null then raise exception 'FORBIDDEN';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'email',u.email,'role',m.role,'active',m.active)) from public.memberships m join auth.users u on u.id=m.user_id where m.company_id=p_company),'[]'::jsonb);
 end;
$$;
create function public.alerts_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'pending',(select count(*) from public.movements where financial_status='posted' and review_status='pending' and kind not in ('opening','reversal')),
 'observed',(select count(*) from public.movements where financial_status='posted' and review_status='observed'),
 'missing_receipts',(select count(*) from public.movements m where m.financial_status='posted' and m.kind='expense' and not exists(select 1 from public.receipts r join storage.objects o on o.name=r.object_path and o.bucket_id='receipts' where r.movement_id=m.id)),
 'funds_with_difference',(select count(*) from public.funds f where (select difference<>0 from public.checks c where c.fund_id=f.id order by c.created_at desc,c.id desc limit 1)),
 'unverified_funds',(select count(*) from public.funds f where f.active and not exists(select 1 from public.checks c join public.check_reviews r on r.check_id=c.id where c.fund_id=f.id and r.decision='approved' and c.created_at>=now()-interval '7 days'))
 );
$$;
revoke all on function public.create_invitation(uuid,text,text),public.accept_invitations(),public.revoke_invitation(uuid),public.create_category(uuid,text),public.set_fund_active(uuid,boolean),public.member_directory(uuid),public.alerts_snapshot() from public,anon,authenticated;
grant execute on function public.create_invitation(uuid,text,text),public.accept_invitations(),public.revoke_invitation(uuid),public.create_category(uuid,text),public.set_fund_active(uuid,boolean),public.member_directory(uuid),public.alerts_snapshot() to authenticated;
