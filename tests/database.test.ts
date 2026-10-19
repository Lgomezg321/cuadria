import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
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
async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set local role authenticated");
}
async function scalar<T = string>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const r = await db.query<{ value: T }>(sql, args);
  return r.rows[0].value;
}
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
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;set timezone='America/Bogota';`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610190001_core.sql", "utf8"),
  );
  await db.exec(
    `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610190002_receipts.sql", "utf8"),
  );
  for (const id of [owner, employee, outsider, auditor])
    await db.query("insert into auth.users values($1)", [id]);
  await db.query("insert into public.installation_owners values($1)", [owner]);
  await db.exec("begin");
  await user(owner);
  company = await scalar(
    "select public.create_company('Empresa Uno','900123456') as value",
  );
  otherCompany = await scalar(
    "select public.create_company('Empresa Dos','900654321') as value",
  );
  await db.query("select public.assign_member($1,$2,'employee')", [
    company,
    employee,
  ]);
  await db.query("select public.assign_member($1,$2,'auditor')", [
    company,
    auditor,
  ]);
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
  it("comprobante privado: propietario adjunta, administrador lee, ajeno no accede", async () => {
    const m = await post();
    const path = await scalar(
      "select public.reserve_receipt($1,'factura.pdf','application/pdf',100) as value",
      [m],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('receipts',$1)",
      [path],
    );
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
    const path = await scalar(
      "select public.reserve_receipt($1,'factura.pdf','application/pdf',100) as value",
      [m],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('receipts',$1)",
      [path],
    );
    await db.exec(
      "update storage.objects set name='reemplazo';delete from storage.objects;",
    );
    expect(await scalar("select name as value from storage.objects")).toBe(
      path,
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
    await db.query("select public.review_movement($1,'approved','')", [m]);
    await user(employee);
    await expect(
      db.query(
        "select public.reserve_receipt($1,'factura.pdf','application/pdf',100)",
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
    await db.query("select public.review_movement($1,'approved','Revisado')", [
      m,
    ]);
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
      db.query("select public.review_movement($1,'approved','')", [m]),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("empleado no puede revisar", async () => {
    const m = await post();
    await expect(
      db.query("select public.review_movement($1,'approved','')", [m]),
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
    const c = await scalar("select public.record_check($1,$2,$3) as value", [
      fund,
      "990",
      "Faltante",
    ]);
    await post();
    expect(await balance()).toBe("800");
    const r = await db.query<{ theoretical: string; difference: string }>(
      "select theoretical::text,difference::text from public.checks where id=$1",
      [c],
    );
    expect(r.rows[0]).toEqual({ theoretical: "1000", difference: "-10" });
  });
  it("distingue conciliación bancaria de arqueo", async () => {
    const c = await scalar("select public.record_check($1,$2,$3) as value", [
      destination,
      "110",
      "Extracto",
    ]);
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
