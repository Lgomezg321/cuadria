import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  it,
  expect,
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
const owner = "00000000-0000-4000-8000-000000000001";
const employee = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const auditor = "00000000-0000-4000-8000-000000000004";
let company: string,
  otherCompany: string,
  fund: string,
  destination: string,
  foreignFund: string;
const user = (id: string) => actAs(db, id);
const scalar = <T = string>(sql: string, args: unknown[] = []) =>
  queryValue<T>(db, sql, args);
async function post(
  kind = "expense",
  amount = "200",
  key = randomUUID(),
  f = fund,
  dest: string | null = null,
) {
  return scalar(
    "select public.post_movement($1,$2,null,$3,$4,$5,current_date,$6) as value",
    [f, dest, kind, amount, "Operación de prueba", key],
  );
}
async function balance(f = fund) {
  return scalar("select balance::text as value from public.funds where id=$1", [
    f,
  ]);
}
beforeAll(async () => {
  db = await createTestDatabase();
  await createUsers(
    db,
    [owner, employee, outsider, auditor].map((id) => ({ id })),
  );
  await db.query("insert into public.installation_owners values($1)", [owner]);
  await db.exec("begin");
  await user(owner);
  company = await scalar(
    "select public.create_company('Empresa Uno','900123456') as value",
  );
  otherCompany = await scalar(
    "select public.create_company('Empresa Dos','900654321') as value",
  );
  // Since 202610210001 members only join through accepted invitations
  // (assign_member changes roles of existing members). Seed them directly.
  await asSuperuser(db);
  for (const [id, role] of [
    [employee, "employee"],
    [auditor, "auditor"],
  ])
    await db.query("insert into public.memberships values($1,$2,$3,true)", [
      company,
      id,
      role,
    ]);
  await user(owner);
  fund = await scalar(
    "select public.create_fund($1,'Caja Uno','cash','1000',$2) as value",
    [company, randomUUID()],
  );
  destination = await scalar(
    "select public.create_fund($1,'Banco Uno','bank','100',$2) as value",
    [company, randomUUID()],
  );
  foreignFund = await scalar(
    "select public.create_fund($1,'Otra Caja','cash','500',$2) as value",
    [otherCompany, randomUUID()],
  );
  for (const f of [fund, destination])
    await db.query("select public.assign_fund($1,$2)", [f, employee]);
  await db.exec("reset role;commit");
});
beforeEach(async () => {
  await db.exec("begin");
  await user(employee);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
afterAll(async () => {
  await db.close();
});
describe("motor financiero ejecutado en PostgreSQL embebido", () => {
  it("responder observaciones conserva dinero, estado e idempotencia", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'observed','Falta descripción',gen_random_uuid())",
      [m],
    );
    await user(employee);
    const id = randomUUID();
    for (let i = 0; i < 2; i++)
      await db.query(
        "select public.comment_movement($1,$2,'Transporte de documentos')",
        [id, m],
      );
    const detail = await scalar<{
      movement: { amount: string; review_status: string };
      comments: unknown[];
      reviews: unknown[];
    }>("select public.movement_detail($1) as value", [m]);
    expect(detail.movement.amount).toBe("200");
    expect(detail.movement.review_status).toBe("observed");
    expect(detail.comments).toHaveLength(1);
    expect(detail.reviews).toHaveLength(1);
    expect(await balance()).toBe("800");
  });
  it("detalle e historial no filtran movimientos ajenos", async () => {
    const m = await post();
    await user(outsider);
    expect(
      await scalar("select public.movement_detail($1) as value", [m]),
    ).toBeNull();
    await expect(
      db.query(
        "select public.comment_movement($1,$2,'Comentario no autorizado')",
        [randomUUID(), m],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("auditor consulta historial pero no escribe respuestas", async () => {
    const m = await post();
    await user(auditor);
    expect(
      await scalar("select public.movement_detail($1) as value", [m]),
    ).not.toBeNull();
    await expect(
      db.query(
        "select public.comment_movement($1,$2,'Comentario no autorizado')",
        [randomUUID(), m],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("un comentario conserva su contenido ante reintentos conflictivos", async () => {
    const m = await post(),
      id = randomUUID();
    await db.query("select public.comment_movement($1,$2,'Original')", [id, m]);
    await expect(
      db.query("select public.comment_movement($1,$2,'Cambiar texto')", [
        id,
        m,
      ]),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("comentarios inmutables incluso con escritura privilegiada accidental", async () => {
    const m = await post();
    await db.query("select public.comment_movement($1,$2,'Explicación')", [
      randomUUID(),
      m,
    ]);
    await db.exec("reset role");
    await expect(
      db.exec("delete from public.movement_comments"),
    ).rejects.toThrow("IMMUTABLE_RECORD");
  });
  it("invitar requiere un administrador autorizado", async () => {
    await expect(
      db.query(
        "select public.create_invitation($1,'nuevo@example.test','admin')",
        [company],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("aceptar una invitación exige correo verificado y conserva el rol autorizado", async () => {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='nuevo@example.test',email_confirmed_at=now() where id=$1",
      [outsider],
    );
    await user(owner);
    await db.query(
      "select public.create_invitation($1,'nuevo@example.test','employee')",
      [company],
    );
    await user(outsider);
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(1);
    expect(
      await scalar(
        "select role as value from public.memberships where company_id=$1 and user_id=$2",
        [company, outsider],
      ),
    ).toBe("employee");
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(0);
  });
  it("un correo sin verificar no obtiene membresía", async () => {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='nuevo@example.test' where id=$1",
      [outsider],
    );
    await user(owner);
    await db.query(
      "select public.create_invitation($1,'nuevo@example.test','admin')",
      [company],
    );
    await user(outsider);
    await expect(
      db.query("select public.accept_invitations()"),
    ).rejects.toThrow("EMAIL_NOT_VERIFIED");
  });
  it("invitación revocada no concede acceso", async () => {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='nuevo@example.test',email_confirmed_at=now() where id=$1",
      [outsider],
    );
    await user(owner);
    const id = await scalar(
      "select public.create_invitation($1,'nuevo@example.test','employee') as value",
      [company],
    );
    await db.query("select public.revoke_invitation($1)", [id]);
    await user(outsider);
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(0);
  });
  it("las invitaciones no elevan silenciosamente una membresía existente", async () => {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='empleado@example.test',email_confirmed_at=now() where id=$1",
      [employee],
    );
    await user(owner);
    await expectFailure(
      db,
      () =>
        db.query(
          "select public.create_invitation($1,'empleado@example.test','admin')",
          [company],
        ),
      "MEMBERSHIP_EXISTS",
    );
    await user(employee);
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(0);
    expect(
      await scalar(
        "select role as value from public.memberships where user_id=$1 and company_id=$2",
        [employee, company],
      ),
    ).toBe("employee");
  });
  it("las invitaciones normalizan el correo y vencen", async () => {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='nuevo@example.test',email_confirmed_at=now() where id=$1",
      [outsider],
    );
    await user(owner);
    const id = await scalar(
      "select public.create_invitation($1,'  NuEvo@Example.TEST ','employee') as value",
      [company],
    );
    expect(
      await scalar(
        "select email as value from public.invitations where id=$1",
        [id],
      ),
    ).toBe("nuevo@example.test");
    await db.exec("reset role");
    await db.query(
      "update public.invitations set expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await user(outsider);
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(0);
    await db.exec("reset role");
    await db.query(
      "update public.invitations set expires_at=now()+interval '1 day' where id=$1",
      [id],
    );
    await user(outsider);
    expect(
      await scalar<number>("select public.accept_invitations() as value"),
    ).toBe(1);
  });
  it("solo un administrador crea categorías en su empresa", async () => {
    await user(owner);
    const cat = await scalar(
      "select public.create_category($1,'  Transporte ') as value",
      [company],
    );
    expect(
      await scalar("select name as value from public.categories where id=$1", [
        cat,
      ]),
    ).toBe("Transporte");
    for (const who of [employee, auditor, outsider]) {
      await user(who);
      await expectFailure(
        db,
        () => db.query("select public.create_category($1,'Ajena')", [company]),
        "FORBIDDEN",
      );
    }
  });
  it("controls_snapshot respeta RLS y serializa dinero como texto", async () => {
    const id = randomUUID();
    await db.query(
      "select public.save_draft($1,0,$2,null,null,'expense','250','Borrador',current_date)",
      [id, fund],
    );
    type Controls = { drafts: { id: string; amount: unknown }[] };
    const mine = await scalar<Controls>(
      "select public.controls_snapshot() as value",
    );
    expect(mine.drafts).toEqual([
      expect.objectContaining({ id, amount: "250" }),
    ]);
    await user(outsider);
    expect(
      (await scalar<Controls>("select public.controls_snapshot() as value"))
        .drafts,
    ).toEqual([]);
  });
  it("no permite desactivar fondos con saldo", async () => {
    await user(owner);
    await expect(
      db.query("select public.set_fund_active($1,false)", [fund]),
    ).rejects.toThrow("FUND_HAS_BALANCE");
  });
  it("las alertas distinguen pendiente, falta de comprobante y falta de verificación", async () => {
    await post();
    const a = await scalar<{
      pending: number;
      pending_reversals: number;
      missing_receipts: number;
      unverified_funds: number;
    }>("select public.alerts_snapshot() as value");
    expect(a.pending).toBe(1);
    expect(a.pending_reversals).toBe(0);
    expect(a.missing_receipts).toBe(1);
    expect(a.unverified_funds).toBe(2);
  });
  it("las alertas cuentan las reversiones pendientes de revisión independiente", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',gen_random_uuid())",
      [m],
    );
    const r = await scalar(
      "select public.reverse_movement($1,'Factura duplicada',gen_random_uuid()) as value",
      [m],
    );
    type Alerts = { pending: number; pending_reversals: number };
    const before = await scalar<Alerts>(
      "select public.alerts_snapshot() as value",
    );
    expect(before).toMatchObject({ pending: 0, pending_reversals: 1 });
    // The reversal blocks the closure until another admin approves it.
    await expectFailure(
      db,
      () =>
        db.query("select public.close_period($1,current_date,'Cierre')", [
          fund,
        ]),
      "UNREVIEWED_MOVEMENTS",
    );
    await expectFailure(
      db,
      () =>
        db.query(
          "select public.review_movement($1,'approved','Propia',gen_random_uuid())",
          [r],
        ),
      "FORBIDDEN",
    );
    // An auditor sees the same alert (RLS, explicit movement columns).
    await user(auditor);
    expect(
      (await scalar<Alerts>("select public.alerts_snapshot() as value"))
        .pending_reversals,
    ).toBe(1);
    await user(outsider);
    expect(
      (await scalar<Alerts>("select public.alerts_snapshot() as value"))
        .pending_reversals,
    ).toBe(0);
  });

  it("el reporte consolida transferencias sin convertirlas en ingresos", async () => {
    await post("transfer", "200", randomUUID(), fund, destination);
    await post("income", "50");
    const r = await scalar<{
      totals: {
        income: string;
        transfers_net: string;
        closing_balance: string;
      }[];
    }>(
      "select public.financial_report(null,null,current_date,current_date) as value",
    );
    expect(r.totals.reduce((a, f) => a + BigInt(f.income), 0n)).toBe(50n);
    expect(r.totals.reduce((a, f) => a + BigInt(f.transfers_net), 0n)).toBe(0n);
    expect(r.totals.reduce((a, f) => a + BigInt(f.closing_balance), 0n)).toBe(
      1150n,
    );
  });
  it("el reporte no revela fondos de otra empresa mediante parámetros", async () => {
    const r = await scalar<{ totals: unknown[] }>(
      "select public.financial_report($1,null,current_date,current_date) as value",
      [otherCompany],
    );
    expect(r.totals).toEqual([]);
  });

  it("guardar y editar borrador no cambia el saldo; enviar dos veces contabiliza una vez", async () => {
    const id = randomUUID();
    const args = [
      id,
      0,
      fund,
      null,
      null,
      "expense",
      "200",
      "Borrador de compra",
    ];
    await db.query(
      "select public.save_draft($1,$2,$3,$4,$5,$6,$7,$8,current_date)",
      args,
    );
    expect(await balance()).toBe("1000");
    await db.query(
      "select public.save_draft($1,1,$2,null,null,'expense','250','Compra editada',current_date)",
      [id, fund],
    );
    const m = await scalar("select public.submit_draft($1,2) as value", [id]);
    expect(
      await scalar("select public.submit_draft($1,2) as value", [id]),
    ).toBe(m);
    expect(await balance()).toBe("750");
  });
  it("detecta edición de borrador con versión desactualizada", async () => {
    const id = randomUUID();
    const q =
      "select public.save_draft($1,0,$2,null,null,'expense','200','Borrador',current_date)";
    await db.query(q, [id, fund]);
    await expect(db.query(q, [id, fund])).rejects.toThrow("DRAFT_CONFLICT");
  });
  it("otro usuario no puede enviar un borrador ajeno", async () => {
    const id = randomUUID();
    await db.query(
      "select public.save_draft($1,0,$2,null,null,'expense','200','Borrador',current_date)",
      [id, fund],
    );
    await user(owner);
    await expect(
      db.query("select public.submit_draft($1,1)", [id]),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("bloquea cierres con movimientos sin revisar", async () => {
    await post();
    await user(owner);
    await expect(
      db.query("select public.close_period($1,current_date,'Cierre')", [fund]),
    ).rejects.toThrow("UNREVIEWED_MOVEMENTS");
  });
  it("congela cierre con totales exactos y no afecta saldo", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',gen_random_uuid())",
      [m],
    );
    const id = await scalar(
      "select public.close_period($1,current_date,'Cierre') as value",
      [fund],
    );
    expect(
      await scalar(
        "select public.close_period($1,current_date,'Cierre') as value",
        [fund],
      ),
    ).toBe(id);
    const r = await db.query(
      "select opening_balance::text,expenses::text,closing_balance::text from public.period_closures where id=$1",
      [id],
    );
    expect(r.rows[0]).toEqual({
      opening_balance: "1000",
      expenses: "200",
      closing_balance: "800",
    });
    expect(await balance()).toBe("800");
  });
  it("impide registrar movimientos tardíos dentro del cierre", async () => {
    await user(owner);
    await db.query("select public.close_period($1,current_date,'Cierre')", [
      fund,
    ]);
    await user(employee);
    await expect(post()).rejects.toThrow("PERIOD_CLOSED");
  });
  it("impide cambiar una revisión incluida en un cierre", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',gen_random_uuid())",
      [m],
    );
    await db.query("select public.close_period($1,current_date,'Cierre')", [
      fund,
    ]);
    await expect(
      db.query(
        "select public.review_movement($1,'observed','Cambiar',gen_random_uuid())",
        [m],
      ),
    ).rejects.toThrow("PERIOD_CLOSED");
  });
  it("un cierre no admite modificaciones silenciosas", async () => {
    await user(owner);
    await db.query("select public.close_period($1,current_date,'Cierre')", [
      fund,
    ]);
    await db.exec("reset role");
    await expect(
      db.exec("update public.period_closures set note='Cambio'"),
    ).rejects.toThrow("IMMUTABLE_RECORD");
  });
  it("empleado no puede aprobar cierres", async () => {
    await expect(
      db.query("select public.close_period($1,current_date,'Cierre')", [fund]),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("aprobar arqueo conserva diferencia y no cambia dinero", async () => {
    const id = await scalar(
      "select public.record_check($1,'900','Faltante',gen_random_uuid()) as value",
      [fund],
    );
    await user(owner);
    await db.query(
      "select public.review_check($1,'approved','Revisado',gen_random_uuid())",
      [id],
    );
    expect(await balance()).toBe("1000");
    expect(
      await scalar(
        "select difference::text as value from public.checks where id=$1",
        [id],
      ),
    ).toBe("-100");
    await expect(
      db.query(
        "select public.review_check($1,'observed','Cambiar',gen_random_uuid())",
        [id],
      ),
    ).rejects.toThrow("CHECK_ALREADY_APPROVED");
  });

  it("permite apertura cero sin asientos ficticios y reintento idempotente", async () => {
    await user(owner);
    const key = randomUUID();
    const f = await scalar(
      "select public.create_fund($1,'Caja vacía','cash','0',$2) as value",
      [company, key],
    );
    expect(
      await scalar(
        "select public.create_fund($1,'Caja vacía','cash','0',$2) as value",
        [company, key],
      ),
    ).toBe(f);
    expect(await balance(f)).toBe("0");
    expect(
      await scalar(
        "select count(*)::text as value from public.entries where fund_id=$1",
        [f],
      ),
    ).toBe("0");
  });
  it("comprobante privado: el autor adjunta y verifica, el administrador lee, el ajeno no accede", async () => {
    const m = await post();
    const r = await scalar<{ id: string; path: string }>(
      "select public.reserve_receipt($1,'factura.pdf','application/pdf',100,gen_random_uuid()) as value",
      [m],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipts',$1,auth.uid()::text,$2)",
      [r.path, JSON.stringify({ size: 100, mimetype: "application/pdf" })],
    );
    await user(owner);
    // Not verified yet: only the author can read the object.
    expect(
      await scalar("select count(*)::text as value from storage.objects"),
    ).toBe("0");
    await user(employee);
    expect(
      (
        await scalar<{ status: string }>(
          "select public.confirm_receipt($1,'application/pdf',100) as value",
          [r.id],
        )
      ).status,
    ).toBe("verified");
    await user(owner);
    expect(
      await scalar("select count(*)::text as value from storage.objects"),
    ).toBe("1");
    await user(outsider);
    expect(
      await scalar("select count(*)::text as value from storage.objects"),
    ).toBe("0");
    expect(
      await scalar("select count(*)::text as value from public.receipts"),
    ).toBe("0");
  });
  it("impide sobrescribir y eliminar comprobantes", async () => {
    const m = await post();
    const r = await scalar<{ id: string; path: string }>(
      "select public.reserve_receipt($1,'factura.pdf','application/pdf',100,gen_random_uuid()) as value",
      [m],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,owner_id,metadata) values('receipts',$1,auth.uid()::text,$2)",
      [r.path, JSON.stringify({ size: 100, mimetype: "application/pdf" })],
    );
    await db.query("select public.confirm_receipt($1,'application/pdf',100)", [
      r.id,
    ]);
    await db.exec(
      "update storage.objects set name='reemplazo';delete from storage.objects;",
    );
    expect(await scalar("select name as value from storage.objects")).toBe(
      r.path,
    );
  });
  it("impide subir un comprobante fuera de la ruta reservada", async () => {
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('receipts','ajeno')",
      ),
    ).rejects.toThrow("row-level security");
  });
  it("impide adjuntar después de aprobación", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'approved','',gen_random_uuid())",
      [m],
    );
    await user(employee);
    await expect(
      db.query(
        "select public.reserve_receipt($1,'factura.pdf','application/pdf',100,gen_random_uuid())",
        [m],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("contabiliza ingresos y egresos con asientos exactos", async () => {
    await post("income", "350");
    await post("expense", "125");
    expect(await balance()).toBe("1225");
    expect(
      await scalar(
        "select sum(amount)::text as value from public.entries where fund_id=$1",
        [fund],
      ),
    ).toBe("1225");
  });
  it("el mismo envío afecta el saldo una vez", async () => {
    const key = randomUUID();
    const a = await post("expense", "200", key);
    expect(await post("expense", "200", key)).toBe(a);
    expect(await balance()).toBe("800");
  });
  it("rechaza reutilizar una clave con contenido diferente", async () => {
    const key = randomUUID();
    await post("expense", "200", key);
    await expect(post("expense", "201", key)).rejects.toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
  });
  it("bloquea egresos sin fondos", async () => {
    await expect(post("expense", "1001")).rejects.toThrow("INSUFFICIENT_FUNDS");
  });
  it("una transferencia conserva el total", async () => {
    await post("transfer", "300", randomUUID(), fund, destination);
    expect(await balance()).toBe("700");
    expect(await balance(destination)).toBe("400");
    expect(
      await scalar("select sum(balance)::text as value from public.funds"),
    ).toBe("1100");
  });
  it("revierte íntegramente una transferencia rechazada por saldo insuficiente", async () => {
    await db.exec("savepoint insufficient");
    await expect(
      post("transfer", "1001", randomUUID(), fund, destination),
    ).rejects.toThrow("INSUFFICIENT_FUNDS");
    await db.exec("rollback to insufficient");
    expect(await balance()).toBe("1000");
    expect(await balance(destination)).toBe("100");
  });
  it("aprobar no vuelve a contabilizar dinero", async () => {
    const m = await post();
    await user(owner);
    await db.query(
      "select public.review_movement($1,'approved','Revisado',gen_random_uuid())",
      [m],
    );
    expect(await balance()).toBe("800");
    expect(
      await scalar(
        "select count(*)::text as value from public.reviews where movement_id=$1",
        [m],
      ),
    ).toBe("1");
  });
  it("impide aprobar movimientos propios incluso al administrador", async () => {
    await user(owner);
    const m = await post();
    await expect(
      db.query(
        "select public.review_movement($1,'approved','',gen_random_uuid())",
        [m],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("empleado no puede revisar", async () => {
    const m = await post();
    await expect(
      db.query(
        "select public.review_movement($1,'approved','',gen_random_uuid())",
        [m],
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("reversión compensatoria conserva el original y es idempotente", async () => {
    const m = await post();
    await user(owner);
    const key = randomUUID();
    const r = await scalar(
      "select public.reverse_movement($1,$2,$3) as value",
      [m, "Factura incorrecta", key],
    );
    expect(
      await scalar("select public.reverse_movement($1,$2,$3) as value", [
        m,
        "Factura incorrecta",
        key,
      ]),
    ).toBe(r);
    expect(await balance()).toBe("1000");
    expect(
      await scalar(
        "select financial_status as value from public.movements where id=$1",
        [m],
      ),
    ).toBe("reversed");
    expect(
      await scalar(
        "select count(*)::text as value from public.entries where movement_id in ($1,$2)",
        [m, r],
      ),
    ).toBe("2");
  });
  it("impide revertir dos veces con claves distintas", async () => {
    const m = await post();
    await user(owner);
    await db.query("select public.reverse_movement($1,$2,$3)", [
      m,
      "Corrección",
      randomUUID(),
    ]);
    await expect(
      db.query("select public.reverse_movement($1,$2,$3)", [
        m,
        "Corrección",
        randomUUID(),
      ]),
    ).rejects.toThrow("INVALID_REVERSAL");
  });
  it("reversa ambos lados de una transferencia", async () => {
    const m = await post("transfer", "300", randomUUID(), fund, destination);
    await user(owner);
    await db.query("select public.reverse_movement($1,$2,$3)", [
      m,
      "Transferencia incorrecta",
      randomUUID(),
    ]);
    expect(await balance()).toBe("1000");
    expect(await balance(destination)).toBe("100");
  });
  it("el arqueo captura el saldo sin modificarlo", async () => {
    const c = await scalar(
      "select public.record_check($1,$2,$3,gen_random_uuid()) as value",
      [fund, "990", "Faltante"],
    );
    await post();
    expect(await balance()).toBe("800");
    const r = await db.query<{ theoretical: string; difference: string }>(
      "select theoretical::text,difference::text from public.checks where id=$1",
      [c],
    );
    expect(r.rows[0]).toEqual({ theoretical: "1000", difference: "-10" });
  });
  it("distingue conciliación bancaria de arqueo", async () => {
    const c = await scalar(
      "select public.record_check($1,$2,$3,gen_random_uuid()) as value",
      [destination, "110", "Extracto"],
    );
    expect(
      await scalar("select kind as value from public.checks where id=$1", [c]),
    ).toBe("bank_reconciliation");
    expect(await balance(destination)).toBe("100");
  });
  it("no expone fondos de otra empresa", async () => {
    expect(
      await scalar(
        "select count(*)::text as value from public.funds where id=$1",
        [foreignFund],
      ),
    ).toBe("0");
    await expect(
      post("expense", "1", randomUUID(), foreignFund),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("propietario no tiene acceso implícito a empresas sin membresía", async () => {
    await db.exec("reset role");
    await db.query(
      "delete from public.memberships where company_id=$1 and user_id=$2",
      [otherCompany, owner],
    );
    await user(owner);
    expect(
      await scalar(
        "select count(*)::text as value from public.funds where id=$1",
        [foreignFund],
      ),
    ).toBe("0");
  });
  it("un usuario sin membresías no ve información", async () => {
    await user(outsider);
    expect(
      await scalar("select count(*)::text as value from public.companies"),
    ).toBe("0");
    expect(
      await scalar("select count(*)::text as value from public.movements"),
    ).toBe("0");
  });
  it("la finalización de asignación revoca acceso al fondo", async () => {
    await user(owner);
    await db.query("select public.assign_fund($1,$2,true)", [fund, employee]);
    await user(employee);
    expect(
      await scalar(
        "select count(*)::text as value from public.funds where id=$1",
        [fund],
      ),
    ).toBe("0");
  });
  it("empleado no puede escalar privilegios por RPC", async () => {
    await expect(
      db.query("select public.assign_member($1,$2,'admin')", [
        company,
        employee,
      ]),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("empleado no puede modificar directamente membresías", async () => {
    await expect(
      db.exec("update public.memberships set role='admin'"),
    ).rejects.toThrow("permission denied");
  });
  it("no permite asientos arbitrarios por el cliente", async () => {
    await expect(db.exec("delete from public.entries")).rejects.toThrow(
      "permission denied",
    );
  });
  it("protege asientos incluso ante escritura privilegiada accidental", async () => {
    await db.exec("reset role");
    await expect(db.exec("update public.entries set amount=1")).rejects.toThrow(
      "IMMUTABLE_RECORD",
    );
  });
  it("auditor lee pero no opera dinero", async () => {
    await user(auditor);
    expect(await balance()).toBe("1000");
    await expect(post()).rejects.toThrow("FORBIDDEN");
  });
  it("las categorías están restringidas a la empresa del fondo", async () => {
    await user(owner);
    const cat = await scalar(
      "select id as value from public.categories where company_id=$1",
      [otherCompany],
    );
    await user(employee);
    await expect(
      db.query(
        "select public.post_movement($1,null,$2,'expense','1','Categoría ajena',current_date,$3)",
        [fund, cat, randomUUID()],
      ),
    ).rejects.toThrow("foreign key");
  });
  it("snapshot serializa dinero como cadenas", async () => {
    const s = await scalar<{ funds: { balance: string }[] }>(
      "select public.workspace_snapshot() as value",
    );
    expect(typeof s.funds[0].balance).toBe("string");
  });
  it("registra actor y evento de auditoría", async () => {
    const m = await post();
    await user(owner);
    expect(
      await scalar(
        "select actor_id::text as value from public.audit_events where entity_id=$1",
        [m],
      ),
    ).toBe(employee);
  });
  it("rechaza fracciones en base de datos, sin redondeo silencioso", async () => {
    await expect(post("income", "1.5")).rejects.toThrow("INVALID_MOVEMENT");
  });
  it("rechaza transferencias entre empresas aun con permisos administrativos", async () => {
    await user(owner);
    await expect(
      post("transfer", "1", randomUUID(), fund, foreignFund),
    ).rejects.toThrow("INVALID_DESTINATION");
  });
});
