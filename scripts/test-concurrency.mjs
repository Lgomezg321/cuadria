// Run ONLY against a dedicated empty database. Never resets or drops existing schemas.
//
// Every race below is forced, not hoped for: a "holder" transaction keeps the
// contended rows locked while all competing requests are started on their own
// connections, and the harness waits until PostgreSQL reports every one of them
// in a lock wait (pg_stat_activity.wait_event_type = 'Lock') before releasing.
// After each scenario the persisted balance of every fund must equal the sum of
// its ledger entries.
import pg from "pg";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const url = process.env.CUADRIA_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set CUADRIA_TEST_DATABASE_URL to an empty disposable PostgreSQL database.",
  );

const RETRIES = 8;
// The inspector/admin connection lives outside the pool, so the pool always
// has room for every competing request plus the holder transaction.
const pool = new pg.Pool({ connectionString: url, max: RETRIES + 2 });
const admin = new pg.Client({ connectionString: url });
await admin.connect();

const owner = randomUUID(); // installation owner, company admin and author
const reviewer = randomUUID(); // second company admin (four-eyes reviews)
const BOGOTA_TODAY = "(now() at time zone 'America/Bogota')::date";

// Supabase-equivalent stubs. auth.uid()/auth.role()/auth.jwt() follow the
// definitions shipped by Supabase (legacy claim GUCs first, then the
// request.jwt.claims JSON that current PostgREST sets).
const AUTH_STUB = `
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(
 id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz,
 deleted_at timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(
  nullif(current_setting('request.jwt.claim.sub', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
 )::uuid
$$;
create function auth.role() returns text language sql stable as $$
 select coalesce(
  nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
 )::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(
  nullif(current_setting('request.jwt.claim', true), ''),
  nullif(current_setting('request.jwt.claims', true), '')
 )::jsonb
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
`;
const STORAGE_STUB = `
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
 select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create function storage.filename(name text) returns text language sql immutable as $$
 select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create function storage.extension(name text) returns text language sql immutable as $$
 select reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
`;

// ---------------------------------------------------------------------------
// RPC helpers: the ONLY place where public RPC signatures appear. Calls use
// named notation so parameter order changes are harmless. Functions that may
// gain an idempotency key (review_movement, review_check, record_check,
// reserve_receipt) receive p_key automatically when the deployed signature has it.
// ---------------------------------------------------------------------------
const signatures = new Map();
function hasParam(fn, param) {
  return (signatures.get(fn) ?? []).some((args) =>
    new RegExp(`\\b${param}\\b`).test(args),
  );
}
async function call(c, fn, args) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names
    .map((n, i) => `${n}=>$${i + 1}`)
    .join(",")}) as value`;
  return (await c.query(sql, Object.values(args))).rows[0].value;
}
const rpc = {
  createCompany: (c, name, nit) =>
    call(c, "create_company", { p_name: name, p_nit: nit }),
  createFund: (c, company, name, opening) =>
    call(c, "create_fund", {
      p_company: company,
      p_name: name,
      p_kind: "cash",
      p_opening: opening,
      p_key: randomUUID(),
    }),
  postMovement: (
    c,
    {
      fund,
      kind = "expense",
      amount = "80",
      destination = null,
      key = randomUUID(),
    },
  ) =>
    c
      .query(
        `select public.post_movement(p_fund=>$1,p_destination=>$2,p_category=>null,p_kind=>$3,p_amount=>$4,p_concept=>$5,p_date=>${BOGOTA_TODAY},p_key=>$6) as value`,
        [fund, destination, kind, amount, "Concurrent test", key],
      )
      .then((r) => r.rows[0].value),
  reverseMovement: (c, movement, key = randomUUID()) =>
    call(c, "reverse_movement", {
      p_movement: movement,
      p_reason: "Concurrent reversal",
      p_key: key,
    }),
  saveDraft: (c, { id, fund, amount, kind = "expense" }) =>
    c
      .query(
        `select public.save_draft(p_id=>$1,p_version=>0,p_fund=>$2,p_destination=>null,p_category=>null,p_kind=>$3,p_amount=>$4,p_concept=>$5,p_date=>${BOGOTA_TODAY}) as value`,
        [id, fund, kind, amount, "Concurrent draft"],
      )
      .then((r) => r.rows[0].value),
  submitDraft: (c, id, version) =>
    call(c, "submit_draft", { p_id: id, p_version: version }),
  reviewMovement: (c, movement, decision, key = randomUUID()) =>
    call(c, "review_movement", {
      p_movement: movement,
      p_decision: decision,
      p_comment: "Concurrent review",
      ...(hasParam("review_movement", "p_key") ? { p_key: key } : {}),
    }),
  closePeriod: (c, fund) =>
    c
      .query(
        `select public.close_period(p_fund=>$1,p_cutoff=>${BOGOTA_TODAY},p_note=>$2) as value`,
        [fund, "Concurrent close"],
      )
      .then((r) => r.rows[0].value),
};

// ---------------------------------------------------------------------------
// Transactions, holders and lock-wait verification
// ---------------------------------------------------------------------------
// `as` = user id for an authenticated request (PostgREST style), null = superuser holder.
async function tx(as, callback, onConnection = () => {}) {
  const c = await pool.connect();
  try {
    onConnection(c);
    await c.query("begin");
    await c.query("set local statement_timeout = '15s'");
    if (as) {
      await c.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: as, role: "authenticated" }),
      ]);
      await c.query("set local role authenticated");
    }
    const result = await callback(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function waitForLockWaits(pids, expected) {
  const deadline = Date.now() + 8000;
  let last = [];
  while (Date.now() < deadline) {
    if (pids.length === expected) {
      const { rows } = await admin.query(
        "select pid, wait_event_type, wait_event from pg_stat_activity where pid = any($1::int[])",
        [pids],
      );
      last = rows;
      if (
        rows.length === expected &&
        rows.every((r) => r.wait_event_type === "Lock")
      )
        return rows.map((r) => r.wait_event).sort();
    }
    await delay(15);
  }
  throw new Error(
    `Expected ${expected} requests in a real lock wait; saw ${pids.length} connections: ${JSON.stringify(last)}`,
  );
}

// Runs `hold` in its own transaction and keeps it open, starts every call on
// its own connection, waits until all of them are blocked on a lock, then
// commits the holder. Returns the settled results plus observed wait events.
async function contend(hold, calls) {
  assert.ok(
    calls.length + 1 <= pool.options.max,
    "Pool too small for a genuinely simultaneous race",
  );
  let held, release;
  const ready = new Promise((r) => {
    held = r;
  });
  const gate = new Promise((r) => {
    release = r;
  });
  const holder = tx(hold.as ?? null, async (c) => {
    const value = await hold.run(c);
    held();
    await gate;
    return value;
  });
  await Promise.race([ready, holder]);
  const pids = [];
  const pending = Promise.allSettled(
    calls.map(({ as, run }) => tx(as, run, (c) => pids.push(c.processID))),
  );
  let waits, failure;
  try {
    waits = await waitForLockWaits(pids, calls.length);
  } catch (e) {
    failure = e;
  } finally {
    release();
  }
  const [heldResult, settled] = await Promise.allSettled([holder, pending]);
  if (failure) throw failure;
  if (heldResult.status === "rejected") throw heldResult.reason;
  return { held: heldResult.value, results: settled.value, waits };
}
const lockRows = (sql, params) => ({ run: (c) => c.query(sql, params) });

async function balance(fund) {
  return (
    await admin.query("select balance::text b from public.funds where id=$1", [
      fund,
    ])
  ).rows[0].b;
}
async function assertLedger(label) {
  const { rows } = await admin.query(
    "select f.id, f.balance::text balance, coalesce(sum(e.amount),0)::text ledger from public.funds f left join public.entries e on e.fund_id=f.id group by f.id having f.balance<>coalesce(sum(e.amount),0)",
  );
  assert.deepEqual(rows, [], `${label}: balance differs from ledger entries`);
}
const fulfilled = (results) => results.filter((r) => r.status === "fulfilled");
const rejected = (results) => results.filter((r) => r.status === "rejected");
function pass(label, waits) {
  console.log(
    `PASS: ${label}${waits ? ` (lock waits: ${waits.join(",")})` : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
try {
  const { rows } = await admin.query(
    "select count(*)::int n from information_schema.tables where table_schema in ('public','auth','storage')",
  );
  assert.equal(rows[0].n, 0, "Refusing to run in a non-empty database");
  await admin.query(AUTH_STUB);
  await admin.query(
    await readFile(
      new URL("../supabase/migrations/202610190001_core.sql", import.meta.url),
      "utf8",
    ),
  );
  await admin.query(STORAGE_STUB);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((f) => f.endsWith(".sql") && !f.includes("0001_core"))
    .sort()) {
    await admin.query(await readFile(new URL(file, migrations), "utf8"));
  }
  for (const r of (
    await admin.query(
      "select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
    )
  ).rows)
    signatures.set(r.proname, [...(signatures.get(r.proname) ?? []), r.args]);

  await admin.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.test',now()),($2,'reviewer@example.test',now())",
    [owner, reviewer],
  );
  await admin.query("insert into public.installation_owners values($1)", [
    owner,
  ]);
  const company = await tx(owner, (c) =>
    rpc.createCompany(c, "Concurrent company", "900999888"),
  );
  // Second admin inserted directly (fixture), independent of assign_member's rules.
  await admin.query(
    "insert into public.memberships(company_id,user_id,role,active) values($1,$2,'admin',true)",
    [company, reviewer],
  );
  const newFund = (name, opening) =>
    tx(owner, (c) => rpc.createFund(c, company, name, opening));
  const fundRow = (fund) =>
    lockRows("select id from public.funds where id=$1 for update", [fund]);

  // 1. Two simultaneous expenses cannot overdraw.
  const fund = await newFund("Source", "100");
  const destination = await newFund("Target", "100");
  {
    const { results, waits } = await contend(fundRow(fund), [
      { as: owner, run: (c) => rpc.postMovement(c, { fund }) },
      { as: owner, run: (c) => rpc.postMovement(c, { fund }) },
    ]);
    assert.equal(fulfilled(results).length, 1);
    assert.match(rejected(results)[0].reason.message, /INSUFFICIENT_FUNDS/);
    assert.equal(await balance(fund), "20");
    await assertLedger("overdraw");
    pass("simultaneous expenses cannot overdraw", waits);
  }

  // 2. Eight genuinely simultaneous retries with one key create one movement.
  {
    const key = randomUUID();
    const { results, waits } = await contend(
      fundRow(fund),
      Array.from({ length: RETRIES }, () => ({
        as: owner,
        run: (c) =>
          rpc.postMovement(c, { fund, key, kind: "income", amount: "5" }),
      })),
    );
    assert.equal(fulfilled(results).length, RETRIES);
    assert.equal(new Set(results.map((r) => r.value)).size, 1);
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.movements where created_by=$1 and idempotency_key=$2",
          [owner, key],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(await balance(fund), "25");
    await assertLedger("idempotent retries");
    pass(`${RETRIES} simultaneous retries create one movement`, waits);
  }

  // 3. Opposite transfers started while both funds are locked: no deadlock.
  {
    const { results, waits } = await contend(
      lockRows(
        "select id from public.funds where id = any($1::uuid[]) order by id for update",
        [[fund, destination]],
      ),
      [
        {
          as: owner,
          run: (c) =>
            rpc.postMovement(c, {
              fund,
              destination,
              kind: "transfer",
              amount: "10",
            }),
        },
        {
          as: owner,
          run: (c) =>
            rpc.postMovement(c, {
              fund: destination,
              destination: fund,
              kind: "transfer",
              amount: "10",
            }),
        },
      ],
    );
    for (const r of rejected(results)) throw r.reason;
    assert.equal(await balance(fund), "25");
    assert.equal(await balance(destination), "100");
    await assertLedger("opposite transfers");
    pass(
      "opposite concurrent transfers conserve money without deadlock",
      waits,
    );
  }

  // 4. A closure serializes with a late posting on the same fund.
  {
    const closingFund = await newFund("Closing", "10");
    const { results, waits } = await contend(
      { as: owner, run: (c) => rpc.closePeriod(c, closingFund) },
      [
        {
          as: owner,
          run: (c) =>
            rpc.postMovement(c, {
              fund: closingFund,
              kind: "income",
              amount: "1",
            }),
        },
      ],
    );
    assert.equal(results[0].status, "rejected");
    assert.match(results[0].reason.message, /PERIOD_CLOSED/);
    assert.equal(await balance(closingFund), "10");
    await assertLedger("closure vs posting");
    pass("period closure blocks a genuinely concurrent late posting", waits);
  }

  // 5a. Two admins reverse the same movement with different keys: one reversal.
  {
    const reversalFund = await newFund("Reversal", "100");
    const movement = await tx(owner, (c) =>
      rpc.postMovement(c, { fund: reversalFund, amount: "30" }),
    );
    const { results, waits } = await contend(fundRow(reversalFund), [
      { as: reviewer, run: (c) => rpc.reverseMovement(c, movement) },
      { as: reviewer, run: (c) => rpc.reverseMovement(c, movement) },
    ]);
    assert.equal(fulfilled(results).length, 1);
    assert.match(rejected(results)[0].reason.message, /INVALID_REVERSAL/);
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.movements where reversal_of=$1",
          [movement],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(await balance(reversalFund), "100");
    await assertLedger("double reversal");
    pass("double reverse_movement creates a single reversal", waits);

    // 5b. The same reversal retried simultaneously with one key is idempotent.
    const second = await tx(owner, (c) =>
      rpc.postMovement(c, { fund: reversalFund, amount: "40" }),
    );
    const key = randomUUID();
    const retry = await contend(fundRow(reversalFund), [
      { as: reviewer, run: (c) => rpc.reverseMovement(c, second, key) },
      { as: reviewer, run: (c) => rpc.reverseMovement(c, second, key) },
    ]);
    assert.equal(fulfilled(retry.results).length, 2);
    assert.equal(new Set(retry.results.map((r) => r.value)).size, 1);
    assert.equal(await balance(reversalFund), "100");
    await assertLedger("idempotent reversal");
    pass(
      "simultaneous reversal retries with one key are idempotent",
      retry.waits,
    );
  }

  // 6. A draft submitted twice at the same time posts exactly once.
  {
    const draftFund = await newFund("Draft", "100");
    const draft = randomUUID();
    await tx(owner, (c) =>
      rpc.saveDraft(c, { id: draft, fund: draftFund, amount: "40" }),
    );
    const version = (
      await admin.query("select version from public.drafts where id=$1", [
        draft,
      ])
    ).rows[0].version;
    const { results, waits } = await contend(
      lockRows("select id from public.drafts where id=$1 for update", [draft]),
      [
        { as: owner, run: (c) => rpc.submitDraft(c, draft, version) },
        { as: owner, run: (c) => rpc.submitDraft(c, draft, version) },
      ],
    );
    for (const r of rejected(results)) throw r.reason;
    assert.equal(new Set(results.map((r) => r.value)).size, 1);
    const posted = await admin.query(
      "select m.id from public.movements m join public.drafts d on d.submitted_movement=m.id where d.id=$1",
      [draft],
    );
    assert.equal(posted.rows[0].id, results[0].value);
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from public.movements where fund_id=$1 and kind='expense'",
          [draftFund],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(await balance(draftFund), "60");
    await assertLedger("double draft submission");
    pass("double submit_draft posts a single movement", waits);
  }

  // 7a. Closure first: a concurrent review of a movement inside the period fails.
  {
    const closedFund = await newFund("Review closed", "100");
    const movement = await tx(owner, (c) =>
      rpc.postMovement(c, { fund: closedFund, amount: "10" }),
    );
    await tx(reviewer, (c) => rpc.reviewMovement(c, movement, "approved"));
    const reviewsBefore = (
      await admin.query(
        "select count(*)::int n from public.reviews where movement_id=$1",
        [movement],
      )
    ).rows[0].n;
    const { results, waits } = await contend(
      { as: owner, run: (c) => rpc.closePeriod(c, closedFund) },
      [
        {
          as: reviewer,
          run: (c) => rpc.reviewMovement(c, movement, "observed"),
        },
      ],
    );
    assert.equal(results[0].status, "rejected");
    assert.match(results[0].reason.message, /PERIOD_CLOSED/);
    const after = await admin.query(
      "select m.review_status, (select count(*)::int from public.reviews r where r.movement_id=m.id) n from public.movements m where m.id=$1",
      [movement],
    );
    assert.equal(after.rows[0].review_status, "approved");
    assert.equal(after.rows[0].n, reviewsBefore);
    await assertLedger("closure vs review");
    pass("closure blocks a concurrent review inside the closed period", waits);
  }

  // 7b. Review first: the closure waits and then freezes the approved state.
  {
    const reviewedFund = await newFund("Review first", "100");
    const movement = await tx(owner, (c) =>
      rpc.postMovement(c, { fund: reviewedFund, amount: "10" }),
    );
    const { results, waits } = await contend(
      {
        as: reviewer,
        run: (c) => rpc.reviewMovement(c, movement, "approved"),
      },
      [{ as: owner, run: (c) => rpc.closePeriod(c, reviewedFund) }],
    );
    for (const r of rejected(results)) throw r.reason;
    const closure = await admin.query(
      "select closing_balance::text closing, $2::uuid = any(movement_ids) included from public.period_closures where id=$1",
      [results[0].value, movement],
    );
    assert.equal(closure.rows[0].closing, "90");
    assert.equal(closure.rows[0].included, true);
    assert.equal(await balance(reviewedFund), "90");
    await assertLedger("review vs closure");
    pass("closure waits for a concurrent approval and freezes it", waits);
  }

  console.log(
    "PostgreSQL:",
    (await admin.query("show server_version")).rows[0].server_version,
  );
} finally {
  await admin.end();
  await pool.end();
}
