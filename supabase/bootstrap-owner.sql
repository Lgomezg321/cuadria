-- Execute ONLY from Supabase SQL Editor as the project owner, after creating your
-- own authenticated user. Substitute its verified UUID from Authentication > Users.
-- This grants installation ownership; it does NOT grant access to other companies.
-- This file is deliberately NOT an automatic migration.
begin;
do $$
declare target uuid := '00000000-0000-0000-0000-000000000000';
begin
 if target='00000000-0000-0000-0000-000000000000'::uuid then raise exception 'Set the verified owner UUID before running';end if;
 if exists(select 1 from public.installation_owners) then raise exception 'An installation owner already exists; review manually';end if;
 if not exists(select 1 from auth.users where id=target) then raise exception 'Auth user not found';end if;
 insert into public.installation_owners(user_id) values(target);
end $$;
commit;
