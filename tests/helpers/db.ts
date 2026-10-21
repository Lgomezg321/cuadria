// Shared PGlite bootstrap for every database test. It loads ALL migrations of
// supabase/migrations in filename order on top of minimal Supabase substitutes,
// so a new migration can never be silently left out of a suite.
//
// The substitutes follow what Supabase ships (and scripts/test-concurrency.mjs):
//   * roles anon, authenticated and service_role (BYPASSRLS), with Supabase's
//     default privileges in schema public (every new table, sequence and
//     function is granted to the three roles unless a migration revokes it);
//   * auth.users with the columns the migrations read, and auth.uid(),
//     auth.role() and auth.jwt() reading the legacy request.jwt.claim.* GUCs
//     first and then the request.jwt.claims JSON set by current PostgREST;
//   * storage.buckets and storage.objects with owner/owner_id/metadata and the
//     unique (bucket_id, name) index, plus the storage.foldername helpers.
// They never replace a run against `supabase start` (real GoTrue, PostgREST,
// Storage server, signed upload tokens or bucket limits). Never apply this SQL
// to a Supabase project.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { expect } from "vitest";

export const MIGRATIONS_DIR = "supabase/migrations";

const SUPABASE_SUBSTITUTES = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create table auth.users(
 id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz,
 deleted_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid
$$;
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'))::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim',true),''),nullif(current_setting('request.jwt.claims',true),''))::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets(
 id text primary key, name text not null, owner uuid, owner_id text, public boolean default false,
 avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[],
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects(
 id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
 owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text,
 created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
 unique(bucket_id, name)
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
 select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
 select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)]
$$;
create function storage.extension(name text) returns text language sql immutable as $$
 select reverse(split_part(reverse(storage.filename(name)),'.',1))
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

set timezone='America/Bogota';
`;

/** Migration file names in the order Supabase applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_[\w-]+\.sql$/.test(f))
    .sort();
}

export type MigrationHook = (db: PGlite) => Promise<void>;

/**
 * New PGlite database with the Supabase substitutes and every migration.
 * `beforeMigration` runs a callback right before the named migration file
 * (used to seed data that only the previous schema could create).
 */
export async function createTestDatabase(
  options: { beforeMigration?: Record<string, MigrationHook> } = {},
): Promise<PGlite> {
  const files = migrationFiles();
  const hooks = options.beforeMigration ?? {};
  for (const name of Object.keys(hooks))
    if (!files.includes(name))
      throw new Error(`Unknown migration in beforeMigration: ${name}`);
  const db = new PGlite();
  await db.exec(SUPABASE_SUBSTITUTES);
  for (const file of files) {
    await hooks[file]?.(db);
    await db.exec(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));
  }
  return db;
}

/** Inserts Auth users (as superuser) with a confirmed e-mail unless told otherwise. */
export async function createUsers(
  db: PGlite,
  users: { id: string; email?: string | null; confirmed?: boolean }[],
) {
  for (const u of users)
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,case when $3 then now() end)",
      [u.id, u.email ?? null, u.confirmed ?? u.email != null],
    );
}

async function claims(db: PGlite, sub: string | null, role: string) {
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",
    [sub ?? "", role, JSON.stringify(sub ? { sub, role } : { role })],
  );
}

/**
 * Acts as a PostgREST request for the transaction: `authenticated` with the
 * given user, or `anon` when `sub` is null. Must run inside a transaction.
 */
export async function actAs(db: PGlite, sub: string | null) {
  await db.exec("reset role");
  const role = sub ? "authenticated" : "anon";
  await claims(db, sub, role);
  await db.exec(`set local role ${role}`);
}

/** Back to the superuser, optionally keeping a user id for auth.uid(). */
export async function asSuperuser(db: PGlite, actor: string | null = null) {
  await db.exec("reset role");
  await claims(db, actor, actor ? "authenticated" : "");
}

export async function queryValue<T = string>(
  db: PGlite,
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const r = await db.query<{ value: T }>(sql, args);
  return r.rows[0].value;
}

export async function queryValues<T = string>(
  db: PGlite,
  sql: string,
  args: unknown[] = [],
): Promise<T[]> {
  const r = await db.query<{ value: T }>(sql, args);
  return r.rows.map((row) => row.value);
}

/**
 * Asserts that `run` fails with `message` inside a savepoint, so the test
 * transaction stays usable afterwards.
 */
export async function expectFailure(
  db: PGlite,
  run: () => Promise<unknown>,
  message?: string | RegExp,
) {
  await db.exec("savepoint expected_failure");
  try {
    await expect(run()).rejects.toThrow(message);
  } finally {
    await db.exec("rollback to savepoint expected_failure");
  }
}

/** Funds whose balance differs from the sum of their ledger entries. */
export async function ledgerDrift(db: PGlite): Promise<string[]> {
  return queryValues(
    db,
    "select f.id::text as value from public.funds f left join public.entries e on e.fund_id=f.id group by f.id having f.balance<>coalesce(sum(e.amount),0)",
  );
}
