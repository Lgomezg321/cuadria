-- All aggregates execute as the caller and therefore retain RLS fund boundaries.
create function public.financial_report(p_company uuid,p_fund uuid,p_from date,p_to date,p_kind text default null,p_review text default null,p_category uuid default null,p_author uuid default null,p_offset integer default 0)
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
 ) select jsonb_build_object('from',p_from,'to',p_to,'totals',coalesce((select jsonb_agg(to_jsonb(t)) from totals t),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(to_jsonb(d)) from (select * from details order by operation_date,entry_id limit 200 offset p_offset) d),'[]'::jsonb),
 'total_entries',(select count(*) from details),'offset',p_offset) into result;
 return result;
 end;
$$;
revoke all on function public.financial_report(uuid,uuid,date,date,text,text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.financial_report(uuid,uuid,date,date,text,text,uuid,uuid,integer) to authenticated;
