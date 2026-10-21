// R-02: reversals created before 202610210002 stayed 'pending' and the old UI
// could not review them. 202610210004 exempts exactly those (audited) so they
// do not block closures, while every new reversal still needs a second admin.
// The legacy data is seeded with the pre-202610210002 functions.
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
  queryValue,
} from "./helpers/db";

let db: PGlite;
const owner = "00000000-0000-4000-8000-0000000000f1";
const admin2 = "00000000-0000-4000-8000-0000000000f2";
let company: string, fund: string, legacyReversal: string;
const user = (id: string) => actAs(db, id);
const scalar = <T = string>(sql: string, args: unknown[] = []) =>
  queryValue<T>(db, sql, args);
type Alerts = { pending: number; pending_reversals: number };
const alerts = () => scalar<Alerts>("select public.alerts_snapshot() as value");

async function seedLegacy(target: PGlite) {
  db = target;
  await createUsers(db, [{ id: owner }, { id: admin2 }]);
  await db.query("insert into public.installation_owners values($1)", [owner]);
  await db.exec("begin");
  await user(owner);
  company = await scalar(
    "select public.create_company('Empresa Histórica','900999000') as value",
  );
  await asSuperuser(db);
  await db.query("insert into public.memberships values($1,$2,'admin',true)", [
    company,
    admin2,
  ]);
  await user(owner);
  fund = await scalar(
    "select public.create_fund($1,'Caja','cash','1000',$2) as value",
    [company, randomUUID()],
  );
  const m = await scalar(
    "select public.post_movement($1,null,null,'expense','100','Compra',current_date,$2) as value",
    [fund, randomUUID()],
  );
  // Previous signatures: review without key, reversal recorded as a review.
  await user(admin2);
  await db.query("select public.review_movement($1,'approved','Revisado')", [
    m,
  ]);
  await user(owner);
  legacyReversal = await scalar(
    "select public.reverse_movement($1,'Factura duplicada',$2) as value",
    [m, randomUUID()],
  );
  await db.exec("reset role;commit");
}

beforeAll(async () => {
  db = await createTestDatabase({
    beforeMigration: { "202610210002_financial_integrity.sql": seedLegacy },
  });
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
afterAll(async () => {
  await db.close();
});

describe("R-02 · reversiones anteriores a la revisión independiente", () => {
  it("la migración las exime de forma auditada y solo a ellas", async () => {
    await asSuperuser(db);
    expect(
      await scalar(
        "select string_agg(movement_id::text||':'||reason,',') as value from private.reversal_review_exemptions",
      ),
    ).toBe(`${legacyReversal}:legacy_pre_independent_review`);
    expect(
      await scalar(
        "select review_status as value from public.movements where id=$1",
        [legacyReversal],
      ),
    ).toBe("pending");
    expect(
      await scalar(
        "select details->>'migration' as value from public.audit_events where action='reversal.review_exempted' and entity_id=$1",
        [legacyReversal],
      ),
    ).toBe("202610210004");
    await expectFailure(
      db,
      () =>
        db.query(
          "update private.reversal_review_exemptions set reason='x' where movement_id=$1",
          [legacyReversal],
        ),
      "IMMUTABLE_RECORD",
    );
    await user(owner);
    await expectFailure(
      db,
      () => db.query("select 1 from private.reversal_review_exemptions"),
      "permission denied",
    );
  });
  it("no bloquea el cierre ni aparece en las alertas", async () => {
    await user(owner);
    expect(await alerts()).toMatchObject({ pending: 0, pending_reversals: 0 });
    const closure = await scalar(
      "select public.close_period($1,current_date,'Cierre') as value",
      [fund],
    );
    expect(closure).toBeTruthy();
  });
  it("una reversión nueva sigue exigiendo a otro administrador", async () => {
    await user(owner);
    const m = await scalar(
      "select public.post_movement($1,null,null,'expense','50','Compra nueva',current_date,$2) as value",
      [fund, randomUUID()],
    );
    await user(admin2);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',$2)",
      [m, randomUUID()],
    );
    await user(owner);
    const r = await scalar(
      "select public.reverse_movement($1,'Error de digitación',$2) as value",
      [m, randomUUID()],
    );
    expect(await alerts()).toMatchObject({ pending: 1, pending_reversals: 1 });
    await expectFailure(
      db,
      () =>
        db.query("select public.close_period($1,current_date,'Cierre')", [
          fund,
        ]),
      "UNREVIEWED_MOVEMENTS",
    );
    await user(admin2);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',$2)",
      [r, randomUUID()],
    );
    expect(await alerts()).toMatchObject({ pending: 0, pending_reversals: 0 });
    await user(owner);
    await db.query("select public.close_period($1,current_date,'Cierre')", [
      fund,
    ]);
  });
});
