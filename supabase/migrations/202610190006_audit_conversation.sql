-- Comments provide an immutable response channel; they never change accounting or review status.
create table public.movement_comments (
 id uuid primary key, movement_id uuid not null references public.movements(id),
 author_id uuid not null references auth.users(id), body text not null check(length(trim(body)) between 3 and 2000),
 created_at timestamptz not null default now()
);
create index movement_comments_history on public.movement_comments(movement_id,created_at,id);
alter table public.movement_comments enable row level security;
create policy movement_comment_read on public.movement_comments for select to authenticated using(exists(select 1 from public.movements m where m.id=movement_id));
revoke all on public.movement_comments from anon,authenticated;
grant select on public.movement_comments to authenticated;
create trigger immutable_movement_comments before update or delete on public.movement_comments for each row execute function private.immutable_record();
create function public.comment_movement(p_id uuid,p_movement uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
 declare m public.movements; previous public.movement_comments;
 begin
 select * into m from public.movements where id=p_movement;
 if not found or not (private.can_read_fund(m.fund_id) or private.can_read_fund(m.destination_id)) or
   not (m.created_by=auth.uid() or private.company_role(m.company_id)='admin') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_body is null or length(trim(p_body)) not between 3 and 2000 then raise exception 'INVALID_COMMENT';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into previous from public.movement_comments where id=p_id;
 if found then
   if previous.author_id<>auth.uid() or previous.movement_id<>p_movement or previous.body<>trim(p_body) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return p_id;
 end if;
 insert into public.movement_comments(id,movement_id,author_id,body) values(p_id,m.id,auth.uid(),trim(p_body));
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'movement.commented',m.id,jsonb_build_object('comment_id',p_id));
 return p_id;
 end;
$$;
create function public.movement_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'movement',(to_jsonb(m)-'request_payload')||jsonb_build_object('amount',m.amount::text),
 'reviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at,r.id) from public.reviews r where r.movement_id=m.id),'[]'::jsonb),
 'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.movement_comments c where c.movement_id=m.id),'[]'::jsonb)
 ) from public.movements m where m.id=p_id;
$$;
revoke all on function public.comment_movement(uuid,uuid,text),public.movement_detail(uuid) from public,anon,authenticated;
grant execute on function public.comment_movement(uuid,uuid,text),public.movement_detail(uuid) to authenticated;
