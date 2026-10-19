create table public.receipts (
 id uuid primary key default gen_random_uuid(), movement_id uuid not null references public.movements(id),
 uploaded_by uuid not null references auth.users(id), original_name text not null check(length(original_name) between 1 and 180),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),
 object_path text not null unique, created_at timestamptz not null default now()
);
create index receipts_movement on public.receipts(movement_id);
alter table public.receipts enable row level security;
create policy receipt_read on public.receipts for select to authenticated using(exists(select 1 from public.movements m where m.id=movement_id));
revoke all on public.receipts from anon,authenticated;
grant select on public.receipts to authenticated;
create trigger immutable_receipts before update or delete on public.receipts for each row execute function private.immutable_record();
create function public.reserve_receipt(p_movement uuid,p_name text,p_mime text,p_size integer) returns text language plpgsql security definer set search_path='' as $$
 declare m public.movements; r uuid:=gen_random_uuid(); path text;
 begin
 select * into m from public.movements where id=p_movement for update;
 if m.created_by is distinct from auth.uid() or not private.can_write_fund(m.fund_id) or m.financial_status<>'posted' or m.review_status='approved' then raise exception 'FORBIDDEN'; end if;
 path:=m.company_id::text||'/'||m.id::text||'/'||r::text;
 insert into public.receipts(id,movement_id,uploaded_by,original_name,mime_type,size_bytes,object_path) values(r,m.id,auth.uid(),p_name,p_mime,p_size,path);
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(m.company_id,auth.uid(),'receipt.reserved',r);
 return path;
 end;
$$;
create function private.can_read_receipt(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipts r join public.movements m on m.id=r.movement_id where r.object_path=path and (private.can_read_fund(m.fund_id) or private.can_read_fund(m.destination_id)));
$$;
create function private.can_upload_receipt(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipts r join public.movements m on m.id=r.movement_id where r.object_path=path and r.uploaded_by=auth.uid() and m.created_by=auth.uid() and m.financial_status='posted' and m.review_status<>'approved' and private.can_write_fund(m.fund_id));
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('receipts','receipts',false,10485760,array['image/jpeg','image/png','application/pdf']);
create policy receipt_object_read on storage.objects for select to authenticated using(bucket_id='receipts' and private.can_read_receipt(name));
create policy receipt_object_insert on storage.objects for insert to authenticated with check(bucket_id='receipts' and private.can_upload_receipt(name));
-- No UPDATE or DELETE policy: stored documents cannot be silently replaced.
revoke all on function public.reserve_receipt(uuid,text,text,integer) from public,anon,authenticated;
revoke all on function private.can_read_receipt(text),private.can_upload_receipt(text) from public,anon,authenticated;
grant execute on function public.reserve_receipt(uuid,text,text,integer),private.can_read_receipt(text),private.can_upload_receipt(text) to authenticated;
