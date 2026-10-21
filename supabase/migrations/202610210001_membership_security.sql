-- CUADRIA: gobierno de membresías, invitaciones y privilegios mínimos.
-- Corrige H-04, H-19, H-20, H-21, H-22, H-44, H-45 y H-46 del informe de auditoría.
--
-- Regla de administración de administradores (H-04):
--   * Gestor de administradores de una empresa = admin ACTIVO de esa empresa que además es
--     su creador (companies.created_by) o un propietario de instalación.
--   * Solo un gestor puede otorgar el rol admin (cambio de rol o invitación), cambiar el rol
--     de un admin o desactivar/reactivar a un admin. Los demás admins gestionan empleados y
--     auditores.
--   * La membresía de un propietario de instalación no la modifica nadie por RPC; la del
--     creador solo la modifica un propietario de instalación (que sea admin activo).
--   * Nadie modifica su propia membresía y la empresa conserva al menos un admin activo.
--   * Las altas llegan únicamente por invitación aceptada con correo verificado.
--     assign_member solo cambia el rol de miembros activos existentes y set_member_active
--     es la única vía para desactivar o reactivar.
--   * Al cambiar el rol o desactivar se cierran las asignaciones vigentes de fondo y, si la
--     persona deja de ser admin, se revocan sus invitaciones pendientes. Todo queda auditado.
--
-- Bloqueos (H-45): cada RPC autoriza sin bloquear, después bloquea y vuelve a autorizar.
-- Los cambios de membresía de una empresa se serializan con FOR NO KEY UPDATE sobre la fila
-- de la empresa (no bloquea las inserciones con FK, que solo toman KEY SHARE) y assign_fund
-- toma FOR SHARE sobre la misma fila. Orden: empresa -> fondo -> membresía/invitación.

-- 1. Privilegios por defecto y secuencias (H-44). Las revocaciones por esquema anulan los
-- GRANT por defecto que Supabase define para anon/authenticated en public; EXECUTE a PUBLIC
-- sobre funciones es global y solo se revoca sin esquema.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

-- 2. Creador explícito de la empresa (antes solo constaba en audit_events).
alter table public.companies add column created_by uuid references auth.users(id);
update public.companies c set created_by=(
 select a.actor_id from public.audit_events a where a.company_id=c.id and a.entity_id=c.id and a.action='company.created' order by a.id limit 1
) where c.created_by is null;

-- 3. Invitaciones: estado terminal "rechazada" con motivo (H-19, H-21) e índices para límites (H-22).
alter table public.invitations add column rejected_at timestamptz, add column rejected_reason text;
alter table public.invitations add constraint invitation_rejection check(
 (rejected_at is null)=(rejected_reason is null) and (rejected_reason is null or rejected_reason in ('membership_exists','inviter_not_authorized'))
);
alter table public.invitations add constraint invitation_single_outcome check(num_nonnulls(accepted_at,revoked_at,rejected_at)<=1);
create index invitation_actor_recent on public.invitations(invited_by,created_at);
create index invitation_company_recent on public.invitations(company_id,created_at);

-- 4. Funciones auxiliares privadas (solo se invocan desde RPC SECURITY DEFINER).
create function private.is_installation_owner(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.installation_owners where user_id=u);
$$;
create function private.can_manage_admins(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.company_role(c)='admin',false) and (
 private.is_installation_owner(auth.uid()) or exists(select 1 from public.companies x where x.id=c and x.created_by=auth.uid()));
$$;
create function private.guard_member_change(c uuid,target uuid,old_role text,old_active boolean,new_role text,new_active boolean) returns void language plpgsql stable security definer set search_path='' as $$
 begin
 if target=auth.uid() then raise exception 'FORBIDDEN';end if;
 if private.is_installation_owner(target) then raise exception 'PROTECTED_MEMBER';end if;
 if exists(select 1 from public.companies x where x.id=c and x.created_by=target) and not private.is_installation_owner(auth.uid()) then raise exception 'PROTECTED_MEMBER';end if;
 -- Defensa en profundidad: el actor es otro admin activo, pero la regla no depende de ello.
 if old_role='admin' and old_active and (new_role<>'admin' or not new_active)
 and not exists(select 1 from public.memberships m where m.company_id=c and m.user_id<>target and m.role='admin' and m.active) then raise exception 'LAST_ACTIVE_ADMIN';end if;
 if (old_role='admin' or new_role='admin') and not private.can_manage_admins(c) then raise exception 'ADMIN_CHANGE_RESTRICTED';end if;
 end;
$$;
create function private.close_member_access(c uuid,target uuid,reason text,revoke_invitations boolean) returns void language plpgsql security definer set search_path='' as $$
 declare a record; i record;
 begin
 for a in update public.assignments set ended_at=clock_timestamp() where company_id=c and user_id=target and ended_at is null returning id,fund_id loop
 insert into public.audit_events(company_id,actor_id,action,entity_id,details)
 values(c,auth.uid(),'fund.assignment',a.fund_id,jsonb_build_object('user',target,'ended',true,'assignment',a.id,'reason',reason));
 end loop;
 if revoke_invitations then
 for i in update public.invitations set revoked_at=now() where company_id=c and invited_by=target and accepted_at is null and revoked_at is null and rejected_at is null returning id loop
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(c,auth.uid(),'invitation.revoked',i.id,jsonb_build_object('reason',reason));
 end loop;
 end if;
 end;
$$;

-- 5. Empresa: registra el creador.
create or replace function public.create_company(p_name text,p_nit text) returns uuid language plpgsql security definer set search_path='' as $$
 declare c uuid;
 begin
 if not private.is_installation_owner(auth.uid()) then raise exception 'FORBIDDEN';end if;
 insert into public.companies(name,nit,created_by) values(trim(p_name),trim(p_nit),auth.uid()) returning id into c;
 insert into public.memberships(company_id,user_id,role,active) values(c,auth.uid(),'admin',true);
 insert into public.categories(company_id,name) values(c,'General');
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(c,auth.uid(),'company.created',c);
 return c;
 end;
$$;

-- 6. Cambio de rol de miembros existentes (H-04, H-20).
create or replace function public.assign_member(p_company uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 declare target public.memberships;
 begin
 if private.company_role(p_company) is distinct from 'admin' or p_user is null or p_user=auth.uid() then raise exception 'FORBIDDEN';end if;
 if p_role is null or p_role not in ('admin','employee','auditor') then raise exception 'INVALID_ROLE';end if;
 perform 1 from public.companies where id=p_company for no key update;
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 select * into target from public.memberships where company_id=p_company and user_id=p_user for update;
 if not found then raise exception 'MEMBER_NOT_FOUND';end if;
 if not target.active then raise exception 'MEMBER_INACTIVE';end if;
 if target.role=p_role then return;end if;
 perform private.guard_member_change(p_company,p_user,target.role,true,p_role,true);
 update public.memberships set role=p_role where company_id=p_company and user_id=p_user;
 perform private.close_member_access(p_company,p_user,'role_changed',target.role='admin');
 insert into public.audit_events(company_id,actor_id,action,entity_id,details)
 values(p_company,auth.uid(),'membership.role_changed',p_user,jsonb_build_object('previous_role',target.role,'role',p_role));
 end;
$$;

-- 7. Activar/desactivar membresías (H-04).
create function public.set_member_active(p_company uuid,p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
 declare target public.memberships;
 begin
 if private.company_role(p_company) is distinct from 'admin' or p_user is null or p_user=auth.uid() then raise exception 'FORBIDDEN';end if;
 if p_active is null then raise exception 'INVALID_STATUS';end if;
 perform 1 from public.companies where id=p_company for no key update;
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 select * into target from public.memberships where company_id=p_company and user_id=p_user for update;
 if not found then raise exception 'MEMBER_NOT_FOUND';end if;
 if target.active=p_active then return;end if;
 perform private.guard_member_change(p_company,p_user,target.role,target.active,target.role,p_active);
 update public.memberships set active=p_active where company_id=p_company and user_id=p_user;
 if not p_active then perform private.close_member_access(p_company,p_user,'member_deactivated',true);end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details)
 values(p_company,auth.uid(),'membership.status',p_user,jsonb_build_object('active',p_active,'previous_active',target.active,'role',target.role));
 end;
$$;

-- 8. Asignaciones de fondo (H-20, H-45): finalizar no depende del rol actual del miembro.
create or replace function public.assign_fund(p_fund uuid,p_user uuid,p_end boolean default false) returns void language plpgsql security definer set search_path='' as $$
 declare c uuid; ended integer;
 begin
 select company_id into c from public.funds where id=p_fund;
 if private.company_role(c) is distinct from 'admin' or p_user is null then raise exception 'FORBIDDEN';end if;
 perform 1 from public.companies where id=c for share;
 perform 1 from public.funds where id=p_fund for no key update;
 if private.company_role(c) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 if coalesce(p_end,false) then
 update public.assignments set ended_at=clock_timestamp() where fund_id=p_fund and user_id=p_user and ended_at is null;
 get diagnostics ended=row_count;
 if ended=0 then raise exception 'ASSIGNMENT_NOT_FOUND';end if;
 else
 if not exists(select 1 from public.memberships where company_id=c and user_id=p_user and active and role='employee') then raise exception 'INVALID_MEMBER';end if;
 if exists(select 1 from public.assignments where fund_id=p_fund and user_id=p_user and ended_at is null) then raise exception 'ALREADY_ASSIGNED';end if;
 insert into public.assignments(company_id,fund_id,user_id) values(c,p_fund,p_user);
 end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(c,auth.uid(),'fund.assignment',p_fund,jsonb_build_object('user',p_user,'ended',coalesce(p_end,false)));
 end;
$$;

-- 9. Estado del fondo (H-45): autorizar, bloquear y revalidar.
create or replace function public.set_fund_active(p_fund uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
 declare c uuid; f public.funds;
 begin
 select company_id into c from public.funds where id=p_fund;
 if private.company_role(c) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 if p_active is null then raise exception 'INVALID_STATUS';end if;
 select * into f from public.funds where id=p_fund for update;
 if private.company_role(f.company_id) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 if f.active=p_active then return;end if;
 if p_active=false and f.balance<>0 then raise exception 'FUND_HAS_BALANCE';end if;
 update public.funds set active=p_active where id=p_fund;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(f.company_id,auth.uid(),'fund.status',p_fund,jsonb_build_object('active',p_active));
 end;
$$;

-- 10. Invitaciones (H-21, H-22, H-45).
create or replace function public.create_invitation(p_company uuid,p_email text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare
 actor_daily_limit constant integer:=20; -- invitaciones por actor en 24 horas, todas las empresas
 company_daily_limit constant integer:=50; -- invitaciones por empresa en 24 horas
 normalized text:=lower(trim(p_email)); result uuid; previous record;
 begin
 if private.company_role(p_company) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 if p_role is null or p_role not in ('admin','employee','auditor') then raise exception 'INVALID_ROLE';end if;
 if p_role='admin' and not private.can_manage_admins(p_company) then raise exception 'ADMIN_CHANGE_RESTRICTED';end if;
 perform pg_advisory_xact_lock(hashtextextended('invitation-actor:'||auth.uid()::text,12));
 perform 1 from public.companies where id=p_company for no key update;
 if private.company_role(p_company) is distinct from 'admin' or (p_role='admin' and not private.can_manage_admins(p_company)) then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.company_id=p_company and lower(u.email)=normalized) then raise exception 'MEMBERSHIP_EXISTS';end if;
 if exists(select 1 from public.invitations where company_id=p_company and email=normalized and created_at>now()-interval '1 minute') then raise exception 'INVITATION_RATE_LIMIT';end if;
 if (select count(*) from public.invitations where invited_by=auth.uid() and created_at>now()-interval '1 day')>=actor_daily_limit then raise exception 'INVITATION_ACTOR_DAILY_LIMIT';end if;
 if (select count(*) from public.invitations where company_id=p_company and created_at>now()-interval '1 day')>=company_daily_limit then raise exception 'INVITATION_COMPANY_DAILY_LIMIT';end if;
 for previous in update public.invitations set revoked_at=now() where company_id=p_company and email=normalized and accepted_at is null and revoked_at is null and rejected_at is null returning id loop
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(p_company,auth.uid(),'invitation.revoked',previous.id,jsonb_build_object('reason','superseded'));
 end loop;
 insert into public.invitations(company_id,email,role,invited_by) values(p_company,normalized,p_role,auth.uid()) returning id into result;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(p_company,auth.uid(),'invitation.created',result,jsonb_build_object('role',p_role));
 return result;
 end;
$$;

-- H-19 y H-21: una invitación solo queda aceptada si crea la membresía. Si el invitador ya no
-- es admin activo (o ya no puede otorgar admin) o si la persona ya tiene membresía (activa o
-- no) en la empresa, la invitación pasa al estado terminal "rechazada" (rejected_at y
-- rejected_reason = 'inviter_not_authorized' | 'membership_exists') con el evento auditado
-- 'invitation.rejected'. Nunca reactiva ni cambia el rol de una membresía existente.
create or replace function public.accept_invitations() returns integer language plpgsql security definer set search_path='' as $$
 declare email_value text; candidate record; item public.invitations; accepted integer:=0; reason text;
 begin
 select lower(email) into email_value from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if email_value is null then raise exception 'EMAIL_NOT_VERIFIED';end if;
 for candidate in select id,company_id from public.invitations where email=email_value and expires_at>now() and accepted_at is null and revoked_at is null and rejected_at is null order by company_id,id loop
 perform 1 from public.companies where id=candidate.company_id for no key update;
 select * into item from public.invitations where id=candidate.id for update;
 if item.email<>email_value or item.expires_at<=now() or item.accepted_at is not null or item.revoked_at is not null or item.rejected_at is not null then continue;end if;
 reason:=null;
 if not exists(select 1 from public.memberships m where m.company_id=item.company_id and m.user_id=item.invited_by and m.role='admin' and m.active)
 or (item.role='admin' and not private.is_installation_owner(item.invited_by) and not exists(select 1 from public.companies x where x.id=item.company_id and x.created_by=item.invited_by)) then
 reason:='inviter_not_authorized';
 elsif exists(select 1 from public.memberships m where m.company_id=item.company_id and m.user_id=auth.uid()) then
 reason:='membership_exists';
 end if;
 if reason is not null then
 update public.invitations set rejected_at=now(),rejected_reason=reason where id=item.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(item.company_id,auth.uid(),'invitation.rejected',item.id,jsonb_build_object('reason',reason));
 continue;
 end if;
 insert into public.memberships(company_id,user_id,role,active) values(item.company_id,auth.uid(),item.role,true);
 update public.invitations set accepted_by=auth.uid(),accepted_at=now() where id=item.id;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(item.company_id,auth.uid(),'invitation.accepted',item.id,jsonb_build_object('role',item.role));
 accepted:=accepted+1;
 end loop;
 return accepted;
 end;
$$;

create or replace function public.revoke_invitation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
 declare c uuid; invitation public.invitations;
 begin
 select company_id into c from public.invitations where id=p_id;
 if private.company_role(c) is distinct from 'admin' then raise exception 'FORBIDDEN';end if;
 select * into invitation from public.invitations where id=p_id for update;
 if private.company_role(invitation.company_id) is distinct from 'admin' or invitation.accepted_at is not null or invitation.rejected_at is not null then raise exception 'FORBIDDEN';end if;
 if invitation.revoked_at is not null then return;end if;
 update public.invitations set revoked_at=now() where id=p_id;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(invitation.company_id,auth.uid(),'invitation.revoked',p_id);
 end;
$$;

-- 11. Directorio (H-46): los auditores no ven correos de miembros inactivos.
create or replace function public.member_directory(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare r text:=private.company_role(p_company);
 begin
 if r is null or r not in ('admin','auditor') then raise exception 'FORBIDDEN';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',m.user_id,'email',case when r='admin' or m.active then u.email end,'role',m.role,'active',m.active,
 'creator',coalesce(m.user_id=c.created_by,false)
 ) order by m.active desc,case when r='admin' or m.active then u.email end nulls last,m.user_id)
 from public.memberships m join auth.users u on u.id=m.user_id join public.companies c on c.id=m.company_id where m.company_id=p_company),'[]'::jsonb);
 end;
$$;

-- 12. Lectura directa (H-46): un empleado solo ve sus propias asignaciones y nadie lee por
-- PostgREST request_payload ni idempotency_key de movements.
drop policy assignment_read on public.assignments;
create policy assignment_read on public.assignments for select to authenticated
 using(private.can_read_fund(fund_id) and (user_id=auth.uid() or private.company_role(company_id) in ('admin','auditor')));
revoke all on public.movements from anon, authenticated;
grant select(id,company_id,fund_id,destination_id,category_id,kind,amount,concept,operation_date,created_by,created_at,posted_at,financial_status,review_status,reversal_of)
 on public.movements to authenticated;

-- Las funciones SECURITY INVOKER que serializaban la fila completa de movements pasan a
-- columnas explícitas, compatibles con el GRANT por columnas.
create or replace function public.workspace_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'companies',coalesce((select jsonb_agg(to_jsonb(c)) from public.companies c),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from public.memberships m where m.user_id=auth.uid()),'[]'::jsonb),
 'funds',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('balance',f.balance::text)) from public.funds f),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(c)) from public.categories c),'[]'::jsonb),
 'movements',coalesce((select jsonb_agg(jsonb_build_object(
 'id',m.id,'company_id',m.company_id,'fund_id',m.fund_id,'destination_id',m.destination_id,'category_id',m.category_id,'kind',m.kind,
 'amount',m.amount::text,'concept',m.concept,'operation_date',m.operation_date,'created_by',m.created_by,'created_at',m.created_at,
 'posted_at',m.posted_at,'financial_status',m.financial_status,'review_status',m.review_status,'reversal_of',m.reversal_of
 ) order by m.created_at desc) from (
 select x.id,x.company_id,x.fund_id,x.destination_id,x.category_id,x.kind,x.amount,x.concept,x.operation_date,x.created_by,x.created_at,
 x.posted_at,x.financial_status,x.review_status,x.reversal_of from public.movements x order by x.created_at desc limit 100) m),'[]'::jsonb),
 'checks',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('theoretical',c.theoretical::text,'declared',c.declared::text,'difference',c.difference::text)) from (select * from public.checks order by created_at desc limit 100) c),'[]'::jsonb)
 );
$$;
create or replace function public.movement_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'movement',jsonb_build_object(
 'id',m.id,'company_id',m.company_id,'fund_id',m.fund_id,'destination_id',m.destination_id,'category_id',m.category_id,'kind',m.kind,
 'amount',m.amount::text,'concept',m.concept,'operation_date',m.operation_date,'created_by',m.created_by,'created_at',m.created_at,
 'posted_at',m.posted_at,'financial_status',m.financial_status,'review_status',m.review_status,'reversal_of',m.reversal_of),
 'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.reviews r where r.movement_id=m.id),'[]'::jsonb),
 'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.movement_comments c where c.movement_id=m.id),'[]'::jsonb)
 ) from public.movements m where m.id=p_id;
$$;

-- 13. Permisos de ejecución.
revoke all on function private.is_installation_owner(uuid),private.can_manage_admins(uuid),
 private.guard_member_change(uuid,uuid,text,boolean,text,boolean),private.close_member_access(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.set_member_active(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_member_active(uuid,uuid,boolean) to authenticated;
