// Receipt reservations, verification and storage policies in embedded PostgreSQL.
// Bootstrap duplicated from tests/database.test.ts, with a storage.objects
// substitute that also carries owner/owner_id/metadata like Supabase Storage.
// It does not replace a test against real Supabase Storage (signed upload
// tokens, bucket limits, metadata written by the Storage server).
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
const colleague = "00000000-0000-4000-8000-000000000005";
let company: string, fund: string;
const legacy: Record<"match" | "missing" | "mismatch", string> = {
  match: "",
  missing: "",
  mismatch: "",
};
const migration = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, "utf8");

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set local role authenticated");
}
// A failed statement aborts the transaction: isolate expected failures.
async function fails(run: () => Promise<unknown>, message?: string) {
  await db.exec("savepoint expected_failure");
  await expect(run()).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_failure");
}
async function superuser() {
  await db.exec("reset role");
}
async function scalar<T = string>(
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const r = await db.query<{ value: T }>(sql, args);
  return r.rows[0].value;
}
async function post(kind = "expense", amount = "200") {
  return scalar(
    "select public.post_movement($1,null,null,$2,$3,'Operación con comprobante',current_date,$4) as value",
    [fund, kind, amount, randomUUID()],
  );
}
type Reservation = {
  id: string;
  path: string;
  mime: string;
  status: string;
  replayed: boolean;
};
async function reserve(
  movement: string,
  key = randomUUID(),
  name = "factura.pdf",
  mime = "application/pdf",
  size = 100,
) {
  return scalar<Reservation>(
    "select public.reserve_receipt($1,$2,$3,$4,$5) as value",
    [movement, name, mime, size, key],
  );
}
async function upload(
  path: string,
  size = 100,
  mime = "application/pdf",
  objectOwner?: string,
) {
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata,owner_id) values('receipts',$1,$2,coalesce($3,auth.uid()::text))",
    [path, JSON.stringify({ size, mimetype: mime }), objectOwner ?? null],
  );
}
async function confirm(
  id: string,
  mime: string | null = "application/pdf",
  size = 100,
) {
  return scalar<{ status: string; reason: string | null }>(
    "select public.confirm_receipt($1,$2,$3) as value",
    [id, mime, size],
  );
}
async function missingReceipts() {
  return (
    await scalar<{ missing_receipts: number }>(
      "select public.alerts_snapshot() as value",
    )
  ).missing_receipts;
}
async function status(id: string) {
  await superuser();
  const value = await scalar(
    "select status as value from public.receipts where id=$1",
    [id],
  );
  return value;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;set timezone='America/Bogota';`,
  );
  await db.exec(migration("202610190001_core.sql"));
  await db.exec(
    `create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`,
  );
  await db.exec(migration("202610190002_receipts.sql"));
  await db.exec(migration("202610190003_drafts_closures.sql"));
  await db.exec(migration("202610190004_reports.sql"));
  await db.exec(
    "alter table auth.users add column email text;alter table auth.users add column email_confirmed_at timestamptz;",
  );
  await db.exec(migration("202610190005_administration.sql"));
  await db.exec(migration("202610190006_audit_conversation.sql"));
  await db.exec(migration("202610200001_private_requests_rls.sql"));
  for (const id of [owner, employee, outsider, auditor, colleague])
    await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query("insert into public.installation_owners values($1)", [owner]);
  await db.exec("begin");
  await user(owner);
  company = await scalar(
    "select public.create_company('Empresa Uno','900123456') as value",
  );
  await scalar(
    "select public.create_company('Empresa Dos','900654321') as value",
  );
  for (const [id, role] of [
    [employee, "employee"],
    [colleague, "employee"],
    [auditor, "auditor"],
  ])
    await db.query("select public.assign_member($1,$2,$3)", [
      company,
      id,
      role,
    ]);
  fund = await scalar(
    "select public.create_fund($1,'Caja Uno','cash','100000',$2) as value",
    [company, randomUUID()],
  );
  for (const id of [employee, colleague])
    await db.query("select public.assign_fund($1,$2)", [fund, id]);
  // Reservations made with the previous flow, before the verification migration.
  await user(employee);
  const old = await post();
  for (const kind of ["match", "missing", "mismatch"] as const) {
    const path = await scalar(
      "select public.reserve_receipt($1,'antiguo.pdf','application/pdf',100) as value",
      [old],
    );
    legacy[kind] = await scalar(
      "select id::text as value from public.receipts where object_path=$1",
      [path],
    );
    if (kind !== "missing")
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2)",
        [
          path,
          JSON.stringify({
            size: kind === "match" ? 100 : 999,
            mimetype: "application/pdf",
          }),
        ],
      );
  }
  await db.exec("reset role;commit");
  await db.exec(migration("202610210003_receipt_verification.sql"));
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

describe("comprobantes verificados en PostgreSQL embebido", () => {
  it("la migración clasifica las reservas anteriores sin borrarlas", async () => {
    expect(await status(legacy.match)).toBe("verified");
    expect(await status(legacy.mismatch)).toBe("rejected");
    expect(await status(legacy.missing)).toBe("expired");
    expect(
      await scalar("select count(*)::text as value from public.receipts"),
    ).toBe("3");
  });

  it("reemplaza la firma anterior y solo authenticated ejecuta las RPC", async () => {
    await superuser();
    expect(
      await scalar(
        "select string_agg(oid::regprocedure::text,',') as value from pg_proc where proname='reserve_receipt'",
      ),
    ).toBe("reserve_receipt(uuid,text,text,integer,uuid)");
    for (const fn of [
      "public.reserve_receipt(uuid,text,text,integer,uuid)",
      "public.confirm_receipt(uuid,text,bigint)",
    ]) {
      expect(
        await scalar<boolean>(
          "select has_function_privilege('anon',$1,'execute') as value",
          [fn],
        ),
      ).toBe(false);
      expect(
        await scalar<boolean>(
          "select has_function_privilege('authenticated',$1,'execute') as value",
          [fn],
        ),
      ).toBe(true);
    }
  });

  it("la clave de idempotencia y la solicitud no son legibles por la sesión", async () => {
    const m = await post();
    await reserve(m);
    await fails(
      () => db.query("select idempotency_key from public.receipts"),
      "permission denied",
    );
    await fails(
      () => db.query("select request_payload from public.receipts"),
      "permission denied",
    );
    expect(
      await scalar(
        "select count(*)::text as value from public.receipts where movement_id=$1 and status='pending'",
        [m],
      ),
    ).toBe("1");
  });

  it("valida en la base nombre, MIME, tamaño y clave declarados", async () => {
    const m = await post();
    for (const args of [
      [m, randomUUID(), "factura.html", "text/html", 100],
      [m, randomUUID(), "factura.pdf", "application/pdf", 0],
      [m, randomUUID(), "factura.pdf", "application/pdf", 10485761],
      [m, randomUUID(), "../factura.pdf", "application/pdf", 100],
      [m, randomUUID(), "   ", "application/pdf", 100],
      [m, null, "factura.pdf", "application/pdf", 100],
    ]) {
      await fails(
        () => db.query("select public.reserve_receipt($1,$3,$4,$5,$2)", args),
        "INVALID_RECEIPT",
      );
    }
    expect(
      (await reserve(m, randomUUID(), "f.pdf", "application/pdf", 10485760))
        .status,
    ).toBe("pending");
  });

  it("la reserva es idempotente por actor y clave con comparación de contenido", async () => {
    const m = await post();
    const key = randomUUID();
    const first = await reserve(m, key);
    const again = await reserve(m, key);
    expect(again).toMatchObject({
      id: first.id,
      path: first.path,
      replayed: true,
    });
    expect(first.replayed).toBe(false);
    await fails(
      () => reserve(m, key, "otra.pdf", "application/pdf", 100),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(
      await scalar(
        "select count(*)::text as value from public.receipts where movement_id=$1",
        [m],
      ),
    ).toBe("1");
    expect(
      await scalar(
        "select count(*)::text as value from public.audit_events where action='receipt.reserved' and entity_id=$1",
        [first.id],
      ),
    ).toBe("0"); // audit_events are not visible to employees
    await user(owner);
    expect(
      await scalar(
        "select count(*)::text as value from public.audit_events where action='receipt.reserved' and entity_id=$1",
        [first.id],
      ),
    ).toBe("1");
  });

  it("limita reservas pendientes por movimiento y vence las antiguas", async () => {
    const m = await post();
    const pending: Reservation[] = [];
    for (let i = 0; i < 5; i++) pending.push(await reserve(m));
    await fails(() => reserve(m), "RECEIPT_LIMIT");
    await superuser();
    await db.exec("set local session_replication_role=replica");
    await db.query(
      "update public.receipts set created_at=now()-interval '4 hours' where movement_id=$1",
      [m],
    );
    await db.exec("set local session_replication_role=origin");
    await user(employee);
    expect((await reserve(m)).status).toBe("pending");
    for (const r of pending) expect(await status(r.id)).toBe("expired");
    await user(employee);
    await expect(upload(pending[0].path)).rejects.toThrow("row-level security");
  });

  it("solo el autor confirma y solo los verificados cuentan para alertas", async () => {
    const m = await post();
    const r = await reserve(m);
    const before = await missingReceipts();
    await fails(() => confirm(r.id), "RECEIPT_NOT_UPLOADED");
    await upload(r.path);
    expect(await missingReceipts()).toBe(before);
    for (const other of [colleague, owner, outsider, auditor]) {
      await user(other);
      await fails(() => confirm(r.id), "FORBIDDEN");
    }
    // Pending receipts are invisible to everyone but their author.
    await user(owner);
    expect(
      await scalar(
        "select count(*)::text as value from public.receipts where id=$1",
        [r.id],
      ),
    ).toBe("0");
    expect(
      await scalar(
        "select count(*)::text as value from storage.objects where name=$1",
        [r.path],
      ),
    ).toBe("0");
    await user(employee);
    expect(await confirm(r.id)).toMatchObject({
      status: "verified",
      reason: null,
    });
    expect(await confirm(r.id)).toMatchObject({
      status: "verified",
      reason: null,
    });
    expect(await missingReceipts()).toBe(before - 1);
    await user(owner);
    expect(
      await scalar(
        "select count(*)::text as value from storage.objects where name=$1",
        [r.path],
      ),
    ).toBe("1");
    expect(
      await scalar(
        "select count(*)::text as value from public.audit_events where action='receipt.verified' and entity_id=$1",
        [r.id],
      ),
    ).toBe("1");
    await user(outsider);
    expect(
      await scalar(
        "select count(*)::text as value from public.receipts where id=$1",
        [r.id],
      ),
    ).toBe("0");
    expect(
      await scalar(
        "select count(*)::text as value from storage.objects where name=$1",
        [r.path],
      ),
    ).toBe("0");
  });

  it("rechaza contenido, tamaño, metadatos o propietario que no coinciden", async () => {
    const m = await post();
    const before = await missingReceipts();
    const cases: [
      string,
      () => Promise<Reservation>,
      (r: Reservation) => Promise<unknown>,
    ][] = [
      ["content", () => reserve(m), (r) => confirm(r.id, null)],
      ["size", () => reserve(m), (r) => confirm(r.id, "application/pdf", 99)],
      [
        "metadata_size",
        async () => {
          const r = await reserve(m);
          await upload(r.path, 5000);
          return r;
        },
        (r) => confirm(r.id),
      ],
      [
        "metadata_mime",
        async () => {
          const r = await reserve(m);
          await upload(r.path, 100, "image/png");
          return r;
        },
        (r) => confirm(r.id),
      ],
      [
        "owner",
        async () => {
          const r = await reserve(m);
          await upload(r.path, 100, "application/pdf", colleague);
          return r;
        },
        (r) => confirm(r.id),
      ],
    ];
    for (const [reason, prepare, run] of cases) {
      const r = await prepare();
      if (reason === "content" || reason === "size") await upload(r.path);
      expect(await run(r)).toMatchObject({ status: "rejected", reason });
      // A rejected object can be discarded by its author and cannot be re-uploaded.
      await db.query("delete from storage.objects where name=$1", [r.path]);
      expect(
        await scalar(
          "select count(*)::text as value from storage.objects where name=$1",
          [r.path],
        ),
      ).toBe("0");
      await fails(() => upload(r.path), "row-level security");
    }
    // Rejected receipts never count as evidence.
    expect(await missingReceipts()).toBe(before);
    await user(owner);
    expect(
      await scalar(
        "select count(*)::text as value from public.receipts where movement_id=$1",
        [m],
      ),
    ).toBe("0");
  });

  it("los comprobantes verificados no se reemplazan, eliminan ni modifican", async () => {
    const m = await post();
    const r = await reserve(m);
    await upload(r.path);
    await confirm(r.id);
    await db.query("delete from storage.objects where name=$1", [r.path]);
    await db.query("update storage.objects set name='otro' where name=$1", [
      r.path,
    ]);
    expect(
      await scalar(
        "select count(*)::text as value from storage.objects where name=$1",
        [r.path],
      ),
    ).toBe("1");
    await fails(() => upload(r.path));
    await fails(
      () =>
        db.query("update public.receipts set status='rejected' where id=$1", [
          r.id,
        ]),
      "permission denied",
    );
    await superuser();
    for (const sql of [
      "update public.receipts set status='rejected' where id=$1",
      "update public.receipts set original_name='x.pdf' where id=$1",
      "delete from public.receipts where id=$1",
    ]) {
      await fails(() => db.query(sql, [r.id]), "IMMUTABLE_RECORD");
    }
  });

  it("sin acceso ajeno: rutas no reservadas, reservas de otros y movimientos aprobados", async () => {
    const m = await post();
    const r = await reserve(m);
    await fails(
      () =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('receipts','ajeno')",
        ),
      "row-level security",
    );
    await user(colleague);
    await fails(() => upload(r.path), "row-level security");
    await fails(() => reserve(m), "FORBIDDEN");
    await user(outsider);
    await fails(() => reserve(m), "FORBIDDEN");
    await user(owner);
    await db.query("select public.review_movement($1,'approved','')", [m]);
    await user(employee);
    await fails(() => reserve(m), "FORBIDDEN");
    await fails(() => upload(r.path), "row-level security");
    await superuser();
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values(\'receipts\',$1,\'{"size":100,"mimetype":"application/pdf"}\')',
      [r.path],
    );
    await user(employee);
    await expect(confirm(r.id)).rejects.toThrow("FORBIDDEN");
  });
});
