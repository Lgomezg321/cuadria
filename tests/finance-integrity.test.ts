// Regression tests for the financial-integrity findings of docs/AUDIT_REPORT.md
// (H-05, H-06, H-23 to H-30, H-48, H-49). Every scenario reproduces the audited
// failure and asserts the corrected behavior; afterEach checks that every fund
// balance still equals the sum of its ledger entries.
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  actAs,
  asSuperuser,
  createTestDatabase,
  createUsers,
  expectFailure,
  ledgerDrift,
  queryValue,
} from "./helpers/db";

let db: PGlite;
const owner = "00000000-0000-4000-8000-0000000000a1";
const admin2 = "00000000-0000-4000-8000-0000000000a2";
const employee = "00000000-0000-4000-8000-0000000000e1";
const auditor = "00000000-0000-4000-8000-0000000000d1";
let company: string;

const user = (id: string) => actAs(db, id);
const superuser = () => asSuperuser(db);
const scalar = <T = string>(sql: string, args: unknown[] = []) =>
  queryValue<T>(db, sql, args);
// Expected failures run inside a savepoint so the test transaction stays usable.
const fails = (sql: string, args: unknown[], code: string | RegExp) =>
  expectFailure(db, () => db.query(sql, args), code);
async function fund(
  name: string,
  { daysAgo = 0, opening = "0", kind = "cash" } = {},
): Promise<string> {
  await user(owner);
  const id = await scalar(
    "select public.create_fund($1,$2,$3,$4,$5) as value",
    [company, name, kind, opening, randomUUID()],
  );
  await superuser();
  await db.query(
    "update public.funds set created_at=now()-make_interval(days=>$2) where id=$1",
    [id, daysAgo],
  );
  await db.query(
    "insert into public.assignments(company_id,fund_id,user_id) values($1,$2,$3)",
    [company, id, employee],
  );
  return id;
}
const postSQL =
  "select public.post_movement($1,$2,null,$3,$4,'Operación de prueba',current_date-$5::int,$6) as value";
type PostOptions = {
  as?: string;
  kind?: string;
  amount?: string;
  daysAgo?: number;
  to?: string | null;
  key?: string;
};
function postArgs(f: string, o: PostOptions) {
  return [
    f,
    o.to ?? null,
    o.kind ?? "expense",
    o.amount ?? "100",
    o.daysAgo ?? 0,
    o.key ?? randomUUID(),
  ];
}
async function post(f: string, o: PostOptions = {}) {
  await user(o.as ?? employee);
  return scalar(postSQL, postArgs(f, o));
}
async function postFails(f: string, o: PostOptions, code: string) {
  await user(o.as ?? employee);
  await fails(postSQL, postArgs(f, o), code);
}
async function review(
  m: string,
  decision = "approved",
  as = admin2,
  key = randomUUID(),
  comment = "Revisado",
) {
  await user(as);
  return scalar("select public.review_movement($1,$2,$3,$4) as value", [
    m,
    decision,
    comment,
    key,
  ]);
}
async function reverse(m: string, as = owner, key = randomUUID()) {
  await user(as);
  return scalar("select public.reverse_movement($1,$2,$3) as value", [
    m,
    "Corrección",
    key,
  ]);
}
async function balance(f: string) {
  await superuser();
  return scalar("select balance::text as value from public.funds where id=$1", [
    f,
  ]);
}
async function movement(id: string) {
  await superuser();
  const r = await db.query<{ review_status: string; financial_status: string }>(
    "select review_status,financial_status from public.movements where id=$1",
    [id],
  );
  return r.rows[0];
}
type Totals = {
  id: string;
  name: string;
  opening_balance: string;
  opening_funding: string;
  income: string;
  expenses: string;
  transfers_net: string;
  reversals_net: string;
  closing_balance: string;
};
type Report = {
  totals: Totals[];
  entries: { entry_id: number; financial_status: string }[];
  total_entries: number;
};
async function report(from: number, to: number, f: string | null, offset = 0) {
  await user(auditor);
  return scalar<Report>(
    "select public.financial_report($1,$2,current_date-$3::int,current_date-$4::int,null,null,null,null,$5) as value",
    [company, f, from, to, offset],
  );
}
function equation(t: Totals) {
  return (
    BigInt(t.opening_balance) +
    BigInt(t.opening_funding) +
    BigInt(t.income) -
    BigInt(t.expenses) +
    BigInt(t.transfers_net) +
    BigInt(t.reversals_net)
  );
}

beforeAll(async () => {
  // Shared bootstrap: every migration on Supabase substitutes that include its
  // default privileges, so the revokes in the migrations are exercised.
  db = await createTestDatabase();
  await createUsers(
    db,
    [owner, admin2, employee, auditor].map((id) => ({ id })),
  );
  // Memberships are inserted directly: these tests do not depend on the
  // membership RPCs, which are hardened separately.
  company = await scalar(
    "insert into public.companies(name,nit) values('Empresa Integridad','900777888') returning id as value",
  );
  for (const [id, role] of [
    [owner, "admin"],
    [admin2, "admin"],
    [employee, "employee"],
    [auditor, "auditor"],
  ])
    await db.query("insert into public.memberships values($1,$2,$3,true)", [
      company,
      id,
      role,
    ]);
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  try {
    await superuser();
    expect(await ledgerDrift(db)).toEqual([]);
    const closures = await db.query(
      "select id from public.period_closures where opening_balance+income-expenses+transfers_net+reversals_net<>closing_balance",
    );
    expect(closures.rows).toEqual([]);
  } finally {
    await db.exec("rollback;reset role");
  }
});
afterAll(async () => {
  await db.close();
});

describe("H-05 · fechas retroactivas y saldos históricos", () => {
  it("rechaza fechas anteriores a la apertura del fondo en origen y destino", async () => {
    const a = await fund("Caja histórica", { daysAgo: 10 });
    const b = await fund("Caja nueva");
    await post(a, { kind: "income", amount: "100", daysAgo: 10 });
    await postFails(
      a,
      { kind: "income", amount: "1", daysAgo: 400 },
      "DATE_BEFORE_FUND_OPENING",
    );
    await postFails(
      a,
      { kind: "transfer", amount: "10", daysAgo: 2, to: b },
      "DATE_BEFORE_FUND_OPENING",
    );
    await post(a, { kind: "transfer", amount: "10", to: b });
    expect(await balance(a)).toBe("90");
    expect(await balance(b)).toBe("10");
  });
  it("un egreso retroactivo no puede dejar saldo negativo en la línea temporal", async () => {
    const f = await fund("Caja", { daysAgo: 10 });
    await post(f, { kind: "income", amount: "100" });
    // Audited reproduction: accepted before, left -100 between day -5 and today.
    await postFails(f, { amount: "100", daysAgo: 5 }, "HISTORICAL_OVERDRAFT");
    await postFails(
      f,
      { amount: "100", daysAgo: 5, as: owner },
      "HISTORICAL_OVERDRAFT",
    );
    await post(f, { amount: "100" });
    expect(await balance(f)).toBe("0");
    const r = await report(6, 1, f);
    expect(r.totals[0].closing_balance).toBe("0");
  });
  it("valida el saldo acumulado en cada día desde la fecha indicada", async () => {
    const f = await fund("Caja", { daysAgo: 10 });
    const b = await fund("Banco", { daysAgo: 10, kind: "bank" });
    await post(f, { kind: "income", amount: "100", daysAgo: 6 });
    await post(f, { amount: "100", daysAgo: 5 });
    await post(f, { kind: "income", amount: "100" });
    // Today's balance covers it, but day -5 would drop to -1.
    await postFails(f, { amount: "1", daysAgo: 6 }, "HISTORICAL_OVERDRAFT");
    await postFails(f, { amount: "1", daysAgo: 1 }, "HISTORICAL_OVERDRAFT");
    await postFails(
      f,
      { kind: "transfer", amount: "50", daysAgo: 8, to: b },
      "HISTORICAL_OVERDRAFT",
    );
    await post(f, { amount: "1" });
    await post(f, { kind: "income", amount: "1", daysAgo: 6 });
    await post(f, { amount: "1", daysAgo: 6 });
    expect(await balance(f)).toBe("99");
    for (let day = 10; day >= 0; day--) {
      const r = await report(day, day, f);
      expect(BigInt(r.totals[0].closing_balance)).toBeGreaterThanOrEqual(0n);
    }
  });
  it("una reversión que resta no deja el fondo negativo", async () => {
    const f = await fund("Caja", { daysAgo: 10 });
    const income = await post(f, {
      kind: "income",
      amount: "100",
      daysAgo: 5,
    });
    await post(f, { amount: "100" });
    await user(owner);
    await fails(
      "select public.reverse_movement($1,'Ingreso duplicado',$2)",
      [income, randomUUID()],
      "INSUFFICIENT_FUNDS",
    );
  });
  it("close_period rechaza saldos de cierre negativos heredados", async () => {
    const f = await fund("Caja", { daysAgo: 10 });
    const income = await post(f, { kind: "income", amount: "100" });
    // Legacy history written before this migration: an expense dated day -5.
    await superuser();
    const legacy = await scalar(
      `insert into public.movements(company_id,fund_id,kind,amount,concept,operation_date,created_by,review_status,idempotency_key,request_payload)
       values($1,$2,'expense',100,'Gasto heredado',current_date-5,$3,'approved',gen_random_uuid(),'{}') returning id as value`,
      [company, f, employee],
    );
    await db.query(
      "insert into public.entries(company_id,movement_id,fund_id,amount) values($1,$2,$3,-100)",
      [company, legacy, f],
    );
    await db.query("update public.funds set balance=balance-100 where id=$1", [
      f,
    ]);
    await review(income);
    await user(owner);
    await fails(
      "select public.close_period($1,current_date-1,'Cierre')",
      [f],
      "NEGATIVE_CLOSING_BALANCE",
    );
    await superuser();
    await fails(
      `insert into public.period_closures(company_id,fund_id,cutoff,opening_balance,income,expenses,transfers_net,reversals_net,closing_balance,movement_ids,approved_by,note)
       values($1,$2,current_date-1,0,0,100,0,0,-100,'{}',$3,'')`,
      [company, f, owner],
      "period_closures_nonnegative_balances",
    );
  });
});

describe("H-06 · reversiones en fondos inactivos", () => {
  it("rechaza reversar si algún fondo afectado está inactivo", async () => {
    const a = await fund("Caja A", { opening: "1000" });
    const b = await fund("Caja B");
    const expense = await post(a, { amount: "300" });
    const transfer = await post(a, { kind: "transfer", amount: "700", to: b });
    await superuser();
    await db.query("update public.funds set active=false where id=$1", [a]);
    await user(owner);
    for (const m of [expense, transfer])
      await fails(
        "select public.reverse_movement($1,'Corrección',$2)",
        [m, randomUUID()],
        "FUND_INACTIVE",
      );
    expect(await balance(a)).toBe("0");
    await superuser();
    await db.query(
      "update public.funds set active=(id<>$2) where id in ($1,$2)",
      [a, b],
    );
    await user(owner);
    await fails(
      "select public.reverse_movement($1,'Corrección',$2)",
      [transfer, randomUUID()],
      "FUND_INACTIVE",
    );
    expect(await balance(b)).toBe("700");
  });
});

describe("H-23 a H-26 · reversiones y revisiones", () => {
  it("una reversión no modifica la revisión congelada por un cierre", async () => {
    const f = await fund("Caja", { daysAgo: 10 });
    const income = await post(f, {
      kind: "income",
      amount: "500",
      daysAgo: 3,
    });
    const expense = await post(f, { amount: "100", daysAgo: 2 });
    await review(income);
    await review(expense);
    await user(owner);
    const closure = await scalar(
      "select public.close_period($1,current_date-1,'Cierre') as value",
      [f],
    );
    await reverse(expense);
    expect(await movement(expense)).toEqual({
      review_status: "approved",
      financial_status: "reversed",
    });
    const frozen = await db.query(
      "select closing_balance::text,movement_ids from public.period_closures where id=$1",
      [closure],
    );
    expect(frozen.rows[0]).toEqual({
      closing_balance: "400",
      movement_ids: [income, expense].sort(),
    });
    expect(await balance(f)).toBe("500");
  });
  it("en un período abierto el original queda rechazado sin revisión fabricada", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const m = await post(f, { amount: "200", as: owner });
    const r = await reverse(m, owner);
    expect(await movement(m)).toEqual({
      review_status: "rejected",
      financial_status: "reversed",
    });
    expect(
      await scalar(
        "select count(*)::int as value from public.reviews where movement_id in ($1,$2)",
        [m, r],
      ),
    ).toBe(0);
    expect(await movement(r)).toEqual({
      review_status: "pending",
      financial_status: "posted",
    });
    expect(
      await scalar(
        "select actor_id::text as value from public.audit_events where action='reversal.posted' and entity_id=$1",
        [r],
      ),
    ).toBe(owner);
  });
  it("el cierre exige revisión independiente de las reversiones", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const m = await post(f, { amount: "200", as: owner });
    const r = await reverse(m, owner);
    await user(owner);
    await fails(
      "select public.close_period($1,current_date,'Cierre')",
      [f],
      "UNREVIEWED_MOVEMENTS",
    );
    await fails(
      "select public.review_movement($1,'approved','Propia',$2)",
      [r, randomUUID()],
      "FORBIDDEN",
    );
    const pendingReversals = async () =>
      (
        await scalar<{ pending_reversals: number }>(
          "select public.alerts_snapshot() as value",
        )
      ).pending_reversals;
    expect(await pendingReversals()).toBe(1);
    await review(r, "approved", admin2);
    expect(await pendingReversals()).toBe(0);
    await user(owner);
    const closure = await scalar(
      "select public.close_period($1,current_date,'Cierre') as value",
      [f],
    );
    expect(
      await scalar(
        "select reversals_net::text as value from public.period_closures where id=$1",
        [closure],
      ),
    ).toBe("200");
  });
  it("reabrir una aprobación exige motivo y no se permite en períodos cerrados", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const m = await post(f);
    await review(m, "approved", admin2);
    await user(owner);
    for (const comment of ["", "  "])
      await fails(
        "select public.review_movement($1,'observed',$2,$3)",
        [m, comment, randomUUID()],
        "REVIEW_REASON_REQUIRED",
      );
    await review(m, "observed", owner, randomUUID(), "Falta la factura");
    expect((await movement(m)).review_status).toBe("observed");
    const pending = await post(f);
    await review(pending, "observed", owner, randomUUID(), "");
    await review(m, "approved", admin2);
    await review(pending, "approved", admin2);
    await user(owner);
    await db.query("select public.close_period($1,current_date,'Cierre')", [f]);
    await fails(
      "select public.review_movement($1,'observed','Reabrir',$2)",
      [m, randomUUID()],
      "PERIOD_CLOSED",
    );
  });
});

describe("H-27 · totales de cierre sin límite de cop", () => {
  it("cierra flujos brutos superiores a 10^18-1", async () => {
    const f = await fund("Banco", { kind: "bank" });
    const big = "900000000000000000";
    const ids = [
      await post(f, { kind: "income", amount: big, as: owner }),
      await post(f, { kind: "expense", amount: big, as: owner }),
      await post(f, { kind: "income", amount: big, as: owner }),
    ];
    // H-50: the balance would exceed the cop domain; the database rejects it.
    await user(owner);
    await fails(
      postSQL,
      postArgs(f, { kind: "income", amount: "999999999999999999" }),
      "cop_check",
    );
    for (const m of ids) await review(m);
    await user(owner);
    const closure = await scalar(
      "select public.close_period($1,current_date,'Cierre') as value",
      [f],
    );
    const r = await db.query(
      "select income::text,expenses::text,closing_balance::text from public.period_closures where id=$1",
      [closure],
    );
    expect(r.rows[0]).toEqual({
      income: "1800000000000000000",
      expenses: big,
      closing_balance: big,
    });
    const rep = await report(0, 0, f);
    expect(rep.totals[0].income).toBe("1800000000000000000");
  });
});

describe("H-28 / H-29 · idempotencia por operación", () => {
  it("una clave de apertura no se reutiliza en otra operación", async () => {
    await user(owner);
    const key = randomUUID();
    const f = await scalar(
      "select public.create_fund($1,'Caja Cero','cash','0',$2) as value",
      [company, key],
    );
    await fails(
      "select public.post_movement($1,null,null,'income','50','Ingreso',current_date,$2)",
      [f, key],
      "IDEMPOTENCY_CONFLICT",
    );
    expect(
      await scalar(
        "select public.create_fund($1,'Caja Cero','cash','0',$2) as value",
        [company, key],
      ),
    ).toBe(f);
    expect(await balance(f)).toBe("0");
  });
  it("un borrador no adopta un movimiento previo con la misma clave", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const key = randomUUID();
    await post(f, { amount: "10", key });
    await user(employee);
    await db.query(
      "select public.save_draft($1,0,$2,null,null,'expense','10','Operación de prueba',current_date)",
      [key, f],
    );
    await fails(
      "select public.submit_draft($1,1)",
      [key],
      "IDEMPOTENCY_CONFLICT",
    );
    expect(await balance(f)).toBe("990");
  });
  it("reversión: reintento normalizado y clave no reutilizable", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const m = await post(f);
    const key = randomUUID();
    await user(owner);
    const r = await scalar(
      "select public.reverse_movement($1,'Corrección',$2) as value",
      [m, key],
    );
    expect(
      await scalar(
        "select public.reverse_movement($1,'Corrección ',$2) as value",
        [m, key],
      ),
    ).toBe(r);
    await fails(postSQL, postArgs(f, { key }), "IDEMPOTENCY_CONFLICT");
  });
  it("arqueos y revisiones reintentados no se duplican", async () => {
    const f = await fund("Caja", { opening: "1000" });
    await user(employee);
    const key = randomUUID();
    const check = "select public.record_check($1,$2,'Arqueo',$3) as value";
    const c = await scalar(check, [f, "990", key]);
    expect(await scalar(check, [f, "990", key])).toBe(c);
    await fails(check, [f, "991", key], "IDEMPOTENCY_CONFLICT");
    const m = await post(f);
    const reviewKey = randomUUID();
    const first = await review(m, "approved", admin2, reviewKey);
    expect(await review(m, "approved", admin2, reviewKey)).toBe(first);
    await user(admin2);
    await fails(
      "select public.review_movement($1,'observed','Otro',$2)",
      [m, reviewKey],
      "IDEMPOTENCY_CONFLICT",
    );
    await fails(
      "select public.review_check($1,'approved','',$2)",
      [c, reviewKey],
      "IDEMPOTENCY_CONFLICT",
    );
    const checkKey = randomUUID();
    const q = "select public.review_check($1,'approved','Cuadra',$2) as value";
    const cr = await scalar(q, [c, checkKey]);
    expect(await scalar(q, [c, checkKey])).toBe(cr);
    await superuser();
    expect(
      await scalar(
        "select (select count(*) from public.checks where fund_id=$1)::text||'/'||(select count(*) from public.reviews where movement_id=$2)::text||'/'||(select count(*) from public.check_reviews where check_id=$3)::text as value",
        [f, m, c],
      ),
    ).toBe("1/1/1");
  });
  it("las nuevas firmas solo son ejecutables por authenticated", async () => {
    await superuser();
    for (const fn of [
      "public.record_check(uuid,text,text,uuid)",
      "public.review_movement(uuid,text,text,uuid)",
      "public.review_check(uuid,text,text,uuid)",
    ]) {
      expect(
        await scalar(
          "select has_function_privilege('authenticated',$1,'execute') as value",
          [fn],
        ),
      ).toBe(true);
      for (const role of ["anon", "service_role"])
        expect(
          await scalar(
            "select has_function_privilege($2,$1,'execute') as value",
            [fn, role],
          ),
        ).toBe(false);
    }
    for (const old of [
      "public.record_check(uuid,text,text)",
      "public.review_movement(uuid,text,text)",
      "public.review_check(uuid,text,text)",
    ])
      expect(
        await scalar("select to_regprocedure($1) is null as value", [old]),
      ).toBe(true);
    for (const helper of [
      "private.idempotency_begin(text,uuid,jsonb)",
      "private.post_movement_core(text,uuid,uuid,uuid,text,text,text,date,uuid)",
    ])
      expect(
        await scalar(
          "select has_function_privilege('authenticated',$1,'execute') as value",
          [helper],
        ),
      ).toBe(false);
  });
});

describe("H-48 · reintentos tras perder el permiso", () => {
  it("devuelve el resultado registrado sin revelar ni aceptar contenido distinto", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const key = randomUUID();
    const m = await post(f, { key });
    await superuser();
    await db.query(
      "update public.assignments set ended_at=now() where fund_id=$1 and user_id=$2",
      [f, employee],
    );
    expect(await post(f, { key })).toBe(m);
    await postFails(f, { key, amount: "101" }, "IDEMPOTENCY_CONFLICT");
    await postFails(f, {}, "FORBIDDEN");
    expect(await balance(f)).toBe("900");
  });
  it("revisiones, cierres, borradores y aperturas también devuelven el resultado previo", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const draft = randomUUID();
    await user(employee);
    await db.query(
      "select public.save_draft($1,0,$2,null,null,'expense','25','Compra',current_date)",
      [draft, f],
    );
    const submitted = await scalar(
      "select public.submit_draft($1,1) as value",
      [draft],
    );
    const key = randomUUID();
    const r = await review(submitted, "approved", admin2, key);
    await user(owner);
    const closure = await scalar(
      "select public.close_period($1,current_date,'Cierre') as value",
      [f],
    );
    expect(await review(submitted, "approved", admin2, key)).toBe(r);
    await superuser();
    await db.query(
      "update public.assignments set ended_at=now() where fund_id=$1",
      [f],
    );
    await db.query(
      "update public.memberships set role='auditor' where user_id=$1 and company_id=$2",
      [owner, company],
    );
    await user(employee);
    expect(
      await scalar("select public.submit_draft($1,1) as value", [draft]),
    ).toBe(submitted);
    await user(owner);
    expect(
      await scalar(
        "select public.close_period($1,current_date,'Cierre') as value",
        [f],
      ),
    ).toBe(closure);
    await fails(
      "select public.create_fund($1,'Otra','cash','0',$2)",
      [company, randomUUID()],
      "FORBIDDEN",
    );
  });
});

describe("H-30 · inmutabilidad en la base de datos", () => {
  it("movimientos solo admiten transiciones de estado válidas", async () => {
    const f = await fund("Caja", { opening: "1000" });
    const m = await post(f);
    const r = await reverse(m);
    const approved = await post(f);
    await review(approved);
    await superuser();
    for (const sql of [
      "update public.movements set amount=1 where id=$1",
      "update public.movements set operation_date=operation_date-1 where id=$1",
      "update public.movements set fund_id=fund_id, concept='Otro concepto' where id=$1",
      "delete from public.movements where id=$1",
    ])
      await fails(sql, [approved], "IMMUTABLE_RECORD");
    await fails(
      "update public.movements set financial_status='posted' where id=$1",
      [m],
      "INVALID_STATUS_TRANSITION",
    );
    await fails(
      "update public.movements set review_status='pending' where id=$1",
      [approved],
      "INVALID_STATUS_TRANSITION",
    );
    await fails(
      "update public.movements set review_status='rejected' where id=$1",
      [approved],
      "INVALID_STATUS_TRANSITION",
    );
    await fails(
      "update public.movements set review_status='approved' where id=$1",
      [m],
      "INVALID_STATUS_TRANSITION",
    );
    await db.query(
      "update public.movements set review_status='approved' where id=$1",
      [r],
    );
    await user(owner);
    await db.query("select public.close_period($1,current_date,'Cierre')", [f]);
    await superuser();
    await fails(
      "update public.movements set review_status='observed' where id=$1",
      [approved],
      "PERIOD_CLOSED",
    );
  });
  it("TRUNCATE está bloqueado en tablas financieras", async () => {
    await superuser();
    for (const table of [
      "entries",
      "movements",
      "period_closures",
      "audit_events",
      "reviews",
      "checks",
      "check_reviews",
    ])
      await fails(`truncate public.${table} cascade`, [], "IMMUTABLE_RECORD");
  });
  it("service_role conserva lectura pero no escribe directamente", async () => {
    await superuser();
    for (const table of [
      "funds",
      "movements",
      "entries",
      "reviews",
      "checks",
      "check_reviews",
      "period_closures",
      "audit_events",
    ]) {
      const p = await db.query<Record<string, boolean>>(
        `select has_table_privilege('service_role',$1,'select') sel,
          has_table_privilege('service_role',$1,'insert') ins,
          has_table_privilege('service_role',$1,'update') upd,
          has_table_privilege('service_role',$1,'delete') del,
          has_table_privilege('service_role',$1,'truncate') trn`,
        [`public.${table}`],
      );
      expect(p.rows[0]).toEqual({
        sel: true,
        ins: false,
        upd: false,
        del: false,
        trn: false,
      });
    }
  });
});

describe("H-49 / H-16 · ecuación y paginación del reporte", () => {
  it("cumple la ecuación con varias fechas, transferencias y reversiones", async () => {
    const a = await fund("B · Caja", { daysAgo: 20 });
    const b = await fund("A · Banco", { daysAgo: 20, kind: "bank" });
    await post(a, { kind: "income", amount: "1000", daysAgo: 15 });
    await post(a, { kind: "income", amount: "250", daysAgo: 10 });
    const expense = await post(a, { amount: "300", daysAgo: 12 });
    await post(a, { kind: "transfer", amount: "400", daysAgo: 8, to: b });
    await post(b, { amount: "50", daysAgo: 4 });
    const transfer = await post(a, {
      kind: "transfer",
      amount: "100",
      daysAgo: 2,
      to: b,
    });
    await post(a, { kind: "income", amount: "75" });
    await reverse(expense);
    await reverse(transfer);
    for (const [from, to] of [
      [11, 1],
      [20, 0],
      [9, 3],
      [2, 0],
      [0, 0],
    ]) {
      const r = await report(from, to, null);
      expect(r.totals.map((t) => t.name)).toEqual(["A · Banco", "B · Caja"]);
      for (const t of r.totals) {
        expect(equation(t)).toBe(BigInt(t.closing_balance));
        const before = from === 20 ? null : await report(20, from + 1, t.id);
        if (before)
          expect(t.opening_balance).toBe(before.totals[0].closing_balance);
      }
      if (to === 0)
        for (const t of r.totals)
          expect(t.closing_balance).toBe(await balance(t.id));
    }
    const today = await report(0, 0, a);
    expect(today.totals[0]).toMatchObject({
      income: "75",
      reversals_net: "400",
      transfers_net: "0",
    });
    const window = await report(11, 1, b);
    expect(window.totals[0]).toMatchObject({
      opening_balance: "0",
      expenses: "50",
      transfers_net: "500",
      closing_balance: "450",
    });
    expect(
      (await report(12, 12, a)).entries.map((e) => e.financial_status),
    ).toEqual(["reversed"]);
  });
  it("pagina más de 200 asientos sin repetir ni omitir", async () => {
    const f = await fund("Caja", { opening: "1" });
    for (let i = 0; i < 205; i++)
      await post(f, { kind: "income", amount: "1" });
    const first = await report(0, 0, f, 0);
    const second = await report(0, 0, f, 200);
    expect(first.total_entries).toBe(206);
    expect(first.entries).toHaveLength(200);
    expect(second.entries).toHaveLength(6);
    const ids = [...first.entries, ...second.entries].map((e) => e.entry_id);
    expect(new Set(ids).size).toBe(206);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(first.totals[0].closing_balance).toBe("206");
    expect((await report(0, 0, f, 400)).entries).toEqual([]);
  });
});
