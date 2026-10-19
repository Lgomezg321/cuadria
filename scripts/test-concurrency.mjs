// Run ONLY against a dedicated empty database. Never resets or drops existing schemas.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const url = process.env.CUADRIA_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set CUADRIA_TEST_DATABASE_URL to an empty disposable PostgreSQL database.",
  );
const pool = new pg.Pool({ connectionString: url, max: 8 });
const admin = await pool.connect();
const actor = randomUUID();
let company, fund, destination;
async function tx(callback) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    await c.query("set local role authenticated");
    const result = await callback(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function post(
  c,
  {
    key = randomUUID(),
    amount = "80",
    kind = "expense",
    source = fund,
    target = null,
  } = {},
) {
  const r = await c.query(
    "select public.post_movement($1,$2,null,$3,$4,$5,(now() at time zone 'America/Bogota')::date,$6) id",
    [source, target, kind, amount, "Concurrent test", key],
  );
  return r.rows[0].id;
}
try {
  const { rows } = await admin.query(
    "select count(*)::int n from information_schema.tables where table_schema in ('public','auth','storage')",
  );
  assert.equal(rows[0].n, 0, "Refusing to run in a non-empty database");
  await admin.query(
    `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end $$;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await admin.query(
    await readFile(
      new URL("../supabase/migrations/202610190001_core.sql", import.meta.url),
      "utf8",
    ),
  );
  await admin.query("insert into auth.users values($1)", [actor]);
  await admin.query("insert into public.installation_owners values($1)", [
    actor,
  ]);
  await tx(async (c) => {
    company = (
      await c.query(
        "select public.create_company('Concurrent company','900999888') id",
      )
    ).rows[0].id;
    fund = (
      await c.query(
        "select public.create_fund($1,'Source','cash','100',$2) id",
        [company, randomUUID()],
      )
    ).rows[0].id;
    destination = (
      await c.query(
        "select public.create_fund($1,'Target','cash','100',$2) id",
        [company, randomUUID()],
      )
    ).rows[0].id;
  });
  // Force one request to hold the fund lock while a second connection tries to post.
  let locked;
  const held = new Promise((r) => {
    locked = r;
  });
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const first = tx(async (c) => {
    await post(c);
    locked();
    await gate;
  });
  await held;
  const second = tx((c) => post(c));
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /INSUFFICIENT_FUNDS/,
  );
  assert.equal(
    (
      await admin.query("select balance::text from public.funds where id=$1", [
        fund,
      ])
    ).rows[0].balance,
    "20",
  );
  console.log("PASS: simultaneous expenses cannot overdraw");
  const key = randomUUID();
  const ids = await Promise.all(
    Array.from({ length: 8 }, () =>
      tx((c) => post(c, { key, kind: "income", amount: "5" })),
    ),
  );
  assert.equal(new Set(ids).size, 1);
  assert.equal(
    (
      await admin.query("select balance::text from public.funds where id=$1", [
        fund,
      ])
    ).rows[0].balance,
    "25",
  );
  console.log("PASS: eight simultaneous retries create one movement");
  await Promise.all([
    tx((c) => post(c, { kind: "transfer", amount: "10", target: destination })),
    tx((c) =>
      post(c, {
        kind: "transfer",
        amount: "10",
        source: destination,
        target: fund,
      }),
    ),
  ]);
  assert.equal(
    (await admin.query("select sum(balance)::text total from public.funds"))
      .rows[0].total,
    "125",
  );
  const mismatch = await admin.query(
    "select f.id from public.funds f left join public.entries e on e.fund_id=f.id group by f.id having f.balance<>coalesce(sum(e.amount),0)",
  );
  assert.equal(mismatch.rowCount, 0);
  console.log(
    "PASS: opposite concurrent transfers conserve money without deadlock",
  );
  console.log(
    "PostgreSQL:",
    (await admin.query("show server_version")).rows[0].server_version,
  );
} finally {
  admin.release();
  await pool.end();
}
