-- CUADRIA: receipt reservations become a verified state machine (H-07, H-18, H-29, H-33).
--
-- Flow:
--   1. reserve_receipt (idempotent by actor+key) creates a `pending` reservation for an
--      eligible movement and returns the server-generated object path.
--   2. The application signs an upload URL with the user's session (storage INSERT policy
--      only allows fresh `pending` reservations of the same author) and the browser uploads
--      the bytes directly to Storage. No file travels through a Server Action.
--   3. The application downloads the object with the user's session, checks signature,
--      structure, real size and MIME, and calls confirm_receipt, which compares the
--      reservation against storage.objects (metadata size/mimetype and owner when available)
--      and marks it `verified` or `rejected`.
-- Only `verified` receipts count as evidence (alerts, viewer, /comprobantes). Pending
-- reservations expire instead of being deleted; receipt rows are never deleted.

-- Status columns. The old immutability trigger is replaced by a transition guard below.
drop trigger immutable_receipts on public.receipts;
alter table public.receipts
 add column status text not null default 'pending' check(status in ('pending','verified','rejected','expired')),
 add column status_reason text check(status_reason is null or length(status_reason)<=40),
 add column resolved_at timestamptz,
 add column idempotency_key uuid,
 add column request_payload jsonb,
 add constraint receipts_request_unique unique(uploaded_by,idempotency_key),
 add constraint receipts_resolution check((status='pending')=(resolved_at is null));
create index receipts_movement_status on public.receipts(movement_id,status);

-- Legacy reservations (created before this migration by the old Server Action, which
-- checked the signature in the application). Objects whose stored metadata matches the
-- reservation become `verified`; mismatches are `rejected`; reservations without an
-- object are `expired`. Metadata is read through to_jsonb so the statement also works
-- when the column is unavailable (it then relies on the object's existence).
update public.receipts r set
 status=x.status, status_reason=x.reason, resolved_at=now()
from (
 select r2.id,
  case when o.obj is null then 'expired'
   when o.obj->'metadata' is null or jsonb_typeof(o.obj->'metadata')<>'object' then 'verified'
   when (o.obj->'metadata' ? 'size' and o.obj->'metadata'->>'size' is distinct from r2.size_bytes::text)
    or (o.obj->'metadata' ? 'mimetype' and lower(split_part(o.obj->'metadata'->>'mimetype',';',1)) is distinct from r2.mime_type) then 'rejected'
   else 'verified' end as status,
  case when o.obj is null then 'legacy_missing' else 'legacy' end as reason
 from public.receipts r2
 left join lateral (select to_jsonb(s) as obj from storage.objects s where s.bucket_id='receipts' and s.name=r2.object_path limit 1) o on true
) x
where x.id=r.id;

create function private.guard_receipt_transition() returns trigger language plpgsql set search_path='' as $$
 begin
 if tg_op<>'UPDATE' then raise exception 'IMMUTABLE_RECORD'; end if;
 if old.status<>'pending' or new.status not in ('verified','rejected','expired')
  or (new.id,new.movement_id,new.uploaded_by,new.original_name,new.mime_type,new.size_bytes,new.object_path,new.created_at,new.idempotency_key,new.request_payload)
   is distinct from (old.id,old.movement_id,old.uploaded_by,old.original_name,old.mime_type,old.size_bytes,old.object_path,old.created_at,old.idempotency_key,old.request_payload)
 then raise exception 'IMMUTABLE_RECORD'; end if;
 return new;
 end;
$$;
create trigger receipt_transition before update or delete on public.receipts for each row execute function private.guard_receipt_transition();
revoke all on function private.guard_receipt_transition() from public,anon,authenticated;

-- Other members only see verified receipts; the author also sees their own attempts.
drop policy receipt_read on public.receipts;
create policy receipt_read on public.receipts for select to authenticated using(
 (status='verified' or uploaded_by=auth.uid()) and exists(select 1 from public.movements m where m.id=movement_id)
);

-- Reservation with idempotency (same semantics as post_movement: advisory lock per
-- actor+key, unique(actor,key) and payload comparison) and per-movement limits.
drop function public.reserve_receipt(uuid,text,text,integer);
create function public.reserve_receipt(p_movement uuid,p_name text,p_mime text,p_size integer,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare m public.movements; prior public.receipts; payload jsonb; r uuid:=gen_random_uuid(); path text; pending_count integer; verified_count integer; total_count integer;
 begin
 if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
 if p_key is null or p_movement is null or p_name is null or length(trim(p_name)) not between 1 and 180 or p_name ~ '[[:cntrl:]/\\]'
  or p_mime is null or p_mime not in ('image/jpeg','image/png','application/pdf') or p_size is null or p_size not between 1 and 10485760 then
  raise exception 'INVALID_RECEIPT';
 end if;
 payload:=jsonb_build_object('movement',p_movement,'name',trim(p_name),'mime',p_mime,'size',p_size);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into prior from public.receipts where uploaded_by=auth.uid() and idempotency_key=p_key;
 if found then
  if prior.request_payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('id',prior.id,'path',prior.object_path,'mime',prior.mime_type,'status',prior.status,'created_at',prior.created_at,'replayed',true);
 end if;
 select * into m from public.movements where id=p_movement for update;
 if m.created_by is distinct from auth.uid() or not private.can_write_fund(m.fund_id) or m.financial_status<>'posted' or m.review_status='approved' then raise exception 'FORBIDDEN'; end if;
 -- Pending reservations older than the signing window plus the signed-URL lifetime expire.
 update public.receipts set status='expired',status_reason='timeout',resolved_at=now()
  where movement_id=m.id and status='pending' and created_at<now()-interval '3 hours';
 select count(*) filter(where status='pending'),count(*) filter(where status='verified'),count(*)
  into pending_count,verified_count,total_count from public.receipts where movement_id=m.id;
 if pending_count>=5 or pending_count+verified_count>=20 or total_count>=50 then raise exception 'RECEIPT_LIMIT'; end if;
 path:=m.company_id::text||'/'||m.id::text||'/'||r::text;
 insert into public.receipts(id,movement_id,uploaded_by,original_name,mime_type,size_bytes,object_path,idempotency_key,request_payload)
 values(r,m.id,auth.uid(),trim(p_name),p_mime,p_size,path,p_key,payload);
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(m.company_id,auth.uid(),'receipt.reserved',r,jsonb_build_object('movement',m.id,'mime',p_mime,'size',p_size));
 return jsonb_build_object('id',r,'path',path,'mime',p_mime,'status','pending','created_at',now(),'replayed',false);
 end;
$$;

-- Confirmation: only the author, only while the movement still accepts receipts.
-- p_detected_mime is the MIME the application derived from the bytes (null when the
-- signature or structure is invalid); p_size is the real downloaded size.
create function public.confirm_receipt(p_receipt uuid,p_detected_mime text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
 declare r public.receipts; m public.movements; obj jsonb; meta jsonb; owner_text text; reason text; result text;
 begin
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
  values(m.company_id,auth.uid(),'receipt.'||result,r.id,jsonb_build_object('movement',m.id,'reason',reason));
 return jsonb_build_object('id',r.id,'status',result,'reason',reason);
 end;
$$;

-- Storage policies. Reading: verified receipts for fund readers, plus the author's own
-- attempts (needed to verify them). Uploading: only a fresh pending reservation of the
-- author (signing window of one hour; the signed URL itself is valid for two hours).
-- Deleting: only the author, only rejected or expired attempts (neutralization).
create or replace function private.can_read_receipt(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipts r join public.movements m on m.id=r.movement_id
  where r.object_path=path and (r.status='verified' or r.uploaded_by=auth.uid())
  and (private.can_read_fund(m.fund_id) or private.can_read_fund(m.destination_id)));
$$;
create or replace function private.can_upload_receipt(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipts r join public.movements m on m.id=r.movement_id
  where r.object_path=path and r.status='pending' and r.created_at>now()-interval '1 hour'
  and r.uploaded_by=auth.uid() and m.created_by=auth.uid() and m.financial_status='posted' and m.review_status<>'approved' and private.can_write_fund(m.fund_id));
$$;
create function private.can_discard_receipt(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.receipts r where r.object_path=path and r.uploaded_by=auth.uid() and r.status in ('rejected','expired'));
$$;
create policy receipt_object_discard on storage.objects for delete to authenticated using(bucket_id='receipts' and private.can_discard_receipt(name));

-- Alerts: only verified receipts satisfy the evidence requirement.
create or replace function public.alerts_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'pending',(select count(*) from public.movements where financial_status='posted' and review_status='pending' and kind not in ('opening','reversal')),
 'observed',(select count(*) from public.movements where financial_status='posted' and review_status='observed'),
 'missing_receipts',(select count(*) from public.movements m where m.financial_status='posted' and m.kind='expense' and not exists(select 1 from public.receipts r where r.movement_id=m.id and r.status='verified')),
 'funds_with_difference',(select count(*) from public.funds f where (select difference<>0 from public.checks c where c.fund_id=f.id order by c.created_at desc,c.id desc limit 1)),
 'unverified_funds',(select count(*) from public.funds f where f.active and not exists(select 1 from public.checks c join public.check_reviews r on r.check_id=c.id where c.fund_id=f.id and r.decision='approved' and c.created_at>=now()-interval '7 days'))
 );
$$;

revoke all on function public.reserve_receipt(uuid,text,text,integer,uuid),public.confirm_receipt(uuid,text,bigint),public.alerts_snapshot() from public,anon,authenticated;
revoke all on function private.can_read_receipt(text),private.can_upload_receipt(text),private.can_discard_receipt(text) from public,anon,authenticated;
grant execute on function public.reserve_receipt(uuid,text,text,integer,uuid),public.confirm_receipt(uuid,text,bigint),public.alerts_snapshot() to authenticated;
grant execute on function private.can_read_receipt(text),private.can_upload_receipt(text),private.can_discard_receipt(text) to authenticated;
