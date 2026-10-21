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
  queryValues,
} from "./helpers/db";

// Arranque compartido (tests/helpers/db.ts): todas las migraciones sobre sustitutos de
// Supabase que emulan sus privilegios por defecto (todo objeto nuevo en public se concede
// a anon, authenticated y service_role salvo que las migraciones lo revoquen).
let db: PGlite;
const ids = {
  owner: "00000000-0000-4000-8000-000000000101",
  admin2: "00000000-0000-4000-8000-000000000102",
  admin3: "00000000-0000-4000-8000-000000000103",
  employee: "00000000-0000-4000-8000-000000000104",
  employee2: "00000000-0000-4000-8000-000000000105",
  auditor: "00000000-0000-4000-8000-000000000106",
  invitee: "00000000-0000-4000-8000-000000000107",
  outsider: "00000000-0000-4000-8000-000000000108",
  foreignAdmin: "00000000-0000-4000-8000-000000000109",
  owner2: "00000000-0000-4000-8000-000000000110",
  admin4: "00000000-0000-4000-8000-000000000111",
} as const;
type Person = keyof typeof ids;
const email = (p: Person) => `${p.toLowerCase()}@example.test`;
let company: string, otherCompany: string, legacyCompany: string, fund: string;

const as = (p: Person | null) => actAs(db, p ? ids[p] : null);
const scalar = <T = string>(sql: string, args: unknown[] = []) =>
  queryValue<T>(db, sql, args);
const list = (sql: string, args: unknown[] = []) => queryValues(db, sql, args);
// Ejecuta una sentencia que debe fallar sin abortar la transacción de la prueba.
const rejects = (sql: string, args: unknown[], message: string) =>
  expectFailure(db, () => db.query(sql, args), message);
async function superuser<T>(fn: () => Promise<T>, actor?: Person) {
  await asSuperuser(db, actor ? ids[actor] : null);
  return fn();
}
async function invite(c: string, who: Person, role: string, by: Person) {
  await as(by);
  return scalar("select public.create_invitation($1,$2,$3) as value", [
    c,
    email(who),
    role,
  ]);
}
async function accept(who: Person) {
  await as(who);
  return scalar<number>("select public.accept_invitations() as value");
}
async function membership(c: string, who: Person) {
  await db.exec("reset role");
  const r = await db.query<{ role: string; active: boolean }>(
    "select role,active from public.memberships where company_id=$1 and user_id=$2",
    [c, ids[who]],
  );
  return r.rows[0] ?? null;
}
async function currentAssignments(who: Person) {
  await db.exec("reset role");
  return scalar(
    "select count(*)::text as value from public.assignments where user_id=$1 and ended_at is null",
    [ids[who]],
  );
}
async function post(who: Person, amount = "10") {
  await as(who);
  return scalar(
    "select public.post_movement($1,null,null,'expense',$2,'Operación de prueba',current_date,$3) as value",
    [fund, amount, randomUUID()],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  await createUsers(
    db,
    (Object.keys(ids) as Person[]).map((p) => ({
      id: ids[p],
      email: email(p),
    })),
  );
  await db.query("insert into public.installation_owners values($1),($2)", [
    ids.owner,
    ids.owner2,
  ]);
  await db.exec("begin");
  await as("owner");
  company = await scalar(
    "select public.create_company('Empresa Segura','900111222') as value",
  );
  otherCompany = await scalar(
    "select public.create_company('Empresa Ajena','900333444') as value",
  );
  fund = await scalar(
    "select public.create_fund($1,'Caja Segura','cash','1000',$2) as value",
    [company, randomUUID()],
  );
  for (const [who, role] of [
    ["admin2", "admin"],
    ["admin3", "admin"],
    ["employee", "employee"],
    ["employee2", "employee"],
    ["auditor", "auditor"],
  ] as [Person, string][]) {
    await invite(company, who, role, "owner");
    expect(await accept(who)).toBe(1);
  }
  await invite(otherCompany, "foreignAdmin", "admin", "owner");
  expect(await accept("foreignAdmin")).toBe(1);
  await as("owner");
  for (const who of ["employee", "employee2"] as Person[])
    await db.query("select public.assign_fund($1,$2)", [fund, ids[who]]);
  // Empresa cuyo creador dejó de ser propietario de instalación.
  await as("owner2");
  legacyCompany = await scalar(
    "select public.create_company('Empresa Heredada','900555666') as value",
  );
  await invite(legacyCompany, "admin4", "admin", "owner2");
  expect(await accept("admin4")).toBe(1);
  await db.exec("reset role");
  await db.query("delete from public.installation_owners where user_id=$1", [
    ids.owner2,
  ]);
  await db.exec("commit");
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

describe("H-04 · gobierno de membresías", () => {
  it("assign_member no da de alta usuarios sin invitación", async () => {
    await as("admin2");
    await rejects(
      "select public.assign_member($1,$2,'admin')",
      [company, ids.outsider],
      "MEMBER_NOT_FOUND",
    );
    await as("owner");
    await rejects(
      "select public.assign_member($1,$2,'employee')",
      [company, ids.outsider],
      "MEMBER_NOT_FOUND",
    );
    expect(await membership(company, "outsider")).toBeNull();
  });
  it("assign_member no reactiva membresías inactivas", async () => {
    await as("owner");
    await db.query("select public.set_member_active($1,$2,false)", [
      company,
      ids.employee,
    ]);
    await rejects(
      "select public.assign_member($1,$2,'auditor')",
      [company, ids.employee],
      "MEMBER_INACTIVE",
    );
    expect(await membership(company, "employee")).toEqual({
      role: "employee",
      active: false,
    });
  });
  it("un admin no puede degradar ni desactivar a otro admin, al propietario ni promover admins", async () => {
    await as("admin2");
    await rejects(
      "select public.assign_member($1,$2,'auditor')",
      [company, ids.admin3],
      "ADMIN_CHANGE_RESTRICTED",
    );
    await rejects(
      "select public.set_member_active($1,$2,false)",
      [company, ids.admin3],
      "ADMIN_CHANGE_RESTRICTED",
    );
    await rejects(
      "select public.assign_member($1,$2,'auditor')",
      [company, ids.owner],
      "PROTECTED_MEMBER",
    );
    await rejects(
      "select public.set_member_active($1,$2,false)",
      [company, ids.owner],
      "PROTECTED_MEMBER",
    );
    await rejects(
      "select public.assign_member($1,$2,'admin')",
      [company, ids.employee],
      "ADMIN_CHANGE_RESTRICTED",
    );
    await rejects(
      "select public.assign_member($1,$2,'admin')",
      [company, ids.admin2],
      "FORBIDDEN",
    );
    expect(await membership(company, "owner")).toEqual({
      role: "admin",
      active: true,
    });
    expect(await membership(company, "admin3")).toEqual({
      role: "admin",
      active: true,
    });
  });
  it("el creador que dejó de ser propietario sigue protegido y gestiona administradores", async () => {
    await as("admin4");
    await rejects(
      "select public.assign_member($1,$2,'auditor')",
      [legacyCompany, ids.owner2],
      "PROTECTED_MEMBER",
    );
    await as("owner2");
    await db.query("select public.assign_member($1,$2,'auditor')", [
      legacyCompany,
      ids.admin4,
    ]);
    expect((await membership(legacyCompany, "admin4"))?.role).toBe("auditor");
  });
  it("el propietario degrada a un admin y la auditoría guarda el rol anterior y el nuevo", async () => {
    await as("owner");
    await db.query("select public.assign_member($1,$2,'auditor')", [
      company,
      ids.admin2,
    ]);
    expect(await membership(company, "admin2")).toEqual({
      role: "auditor",
      active: true,
    });
    const details = await scalar<{ previous_role: string; role: string }>(
      "select details as value from public.audit_events where action='membership.role_changed' and entity_id=$1",
      [ids.admin2],
    );
    expect(details).toEqual({ previous_role: "admin", role: "auditor" });
  });
  it("un admin cambia el rol de un empleado, se cierran sus asignaciones y no reviven", async () => {
    expect(await currentAssignments("employee")).toBe("1");
    await as("admin2");
    await db.query("select public.assign_member($1,$2,'auditor')", [
      company,
      ids.employee,
    ]);
    expect(await currentAssignments("employee")).toBe("0");
    expect(
      await scalar(
        "select details->>'reason' as value from public.audit_events where action='fund.assignment' and details->>'user'=$1 and (details->>'ended')::boolean",
        [ids.employee],
      ),
    ).toBe("role_changed");
    await as("admin2");
    await db.query("select public.assign_member($1,$2,'employee')", [
      company,
      ids.employee,
    ]);
    await as("employee");
    await db.exec("savepoint attempt");
    await expect(post("employee")).rejects.toThrow("FORBIDDEN");
    await db.exec("rollback to savepoint attempt");
  });
  it("set_member_active desactiva, cierra acceso, audita y reactiva sin restaurar asignaciones", async () => {
    await as("admin2");
    await db.query("select public.set_member_active($1,$2,false)", [
      company,
      ids.employee,
    ]);
    expect(await currentAssignments("employee")).toBe("0");
    await as("employee");
    expect(
      await scalar("select count(*)::text as value from public.companies"),
    ).toBe("0");
    await as("admin2");
    await db.query("select public.set_member_active($1,$2,true)", [
      company,
      ids.employee,
    ]);
    expect(await membership(company, "employee")).toEqual({
      role: "employee",
      active: true,
    });
    expect(await currentAssignments("employee")).toBe("0");
    expect(
      await list(
        "select details::text as value from public.audit_events where action='membership.status' and entity_id=$1 order by id",
        [ids.employee],
      ),
    ).toHaveLength(2);
  });
  it("set_member_active rechaza cambios propios, ajenos y de empleados", async () => {
    await as("admin2");
    await rejects(
      "select public.set_member_active($1,$2,false)",
      [company, ids.admin2],
      "FORBIDDEN",
    );
    await rejects(
      "select public.set_member_active($1,$2,null)",
      [company, ids.employee],
      "INVALID_STATUS",
    );
    await as("employee");
    await rejects(
      "select public.set_member_active($1,$2,false)",
      [company, ids.employee2],
      "FORBIDDEN",
    );
    await as("foreignAdmin");
    await rejects(
      "select public.set_member_active($1,$2,false)",
      [company, ids.employee],
      "FORBIDDEN",
    );
    await rejects(
      "select public.assign_member($1,$2,'auditor')",
      [company, ids.employee],
      "FORBIDDEN",
    );
  });
  it("al dejar de ser admin se revocan sus invitaciones pendientes", async () => {
    const pending = await invite(company, "invitee", "employee", "admin3");
    await as("owner");
    await db.query("select public.set_member_active($1,$2,false)", [
      company,
      ids.admin3,
    ]);
    await db.exec("reset role");
    expect(
      await scalar(
        "select (revoked_at is not null)::text as value from public.invitations where id=$1",
        [pending],
      ),
    ).toBe("true");
    expect(await accept("invitee")).toBe(0);
    expect(await membership(company, "invitee")).toBeNull();
  });
  it("la salvaguarda del último admin activo se aplica aun sin otro admin", async () => {
    await db.exec("reset role");
    await db.query(
      "update public.memberships set active=false where company_id=$1 and user_id<>$2 and role='admin'",
      [company, ids.admin3],
    );
    await superuser(async () => {
      await rejects(
        "select private.guard_member_change($1,$2,'admin',true,'auditor',true)",
        [company, ids.admin3],
        "LAST_ACTIVE_ADMIN",
      );
    }, "owner");
  });
});

describe("H-19 a H-22 · invitaciones y asignaciones", () => {
  it("H-19: una invitación de un invitador degradado no concede acceso", async () => {
    const id = await invite(company, "invitee", "employee", "admin2");
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='auditor' where company_id=$1 and user_id=$2",
      [company, ids.admin2],
    );
    expect(await accept("invitee")).toBe(0);
    expect(await membership(company, "invitee")).toBeNull();
    await db.exec("reset role");
    const r = await db.query<{ rejected_reason: string; accepted: boolean }>(
      "select rejected_reason,accepted_at is not null as accepted from public.invitations where id=$1",
      [id],
    );
    expect(r.rows[0]).toEqual({
      rejected_reason: "inviter_not_authorized",
      accepted: false,
    });
  });
  it("H-19: solo el creador o el propietario invitan administradores", async () => {
    await as("admin2");
    await rejects(
      "select public.create_invitation($1,'nuevo-admin@example.test','admin')",
      [company],
      "ADMIN_CHANGE_RESTRICTED",
    );
    await invite(company, "invitee", "admin", "owner");
    expect(await accept("invitee")).toBe(1);
    expect((await membership(company, "invitee"))?.role).toBe("admin");
  });
  it("H-20: finalizar una asignación no valida el rol actual del miembro", async () => {
    await db.exec("reset role");
    await db.query(
      "update public.memberships set role='auditor' where company_id=$1 and user_id=$2",
      [company, ids.employee],
    );
    await as("owner");
    await db.query("select public.assign_fund($1,$2,true)", [
      fund,
      ids.employee,
    ]);
    expect(await currentAssignments("employee")).toBe("0");
    await as("owner");
    await rejects(
      "select public.assign_fund($1,$2,true)",
      [fund, ids.employee],
      "ASSIGNMENT_NOT_FOUND",
    );
    await rejects(
      "select public.assign_fund($1,$2)",
      [fund, ids.employee],
      "INVALID_MEMBER",
    );
    await rejects(
      "select public.assign_fund($1,$2)",
      [fund, ids.employee2],
      "ALREADY_ASSIGNED",
    );
    await as("foreignAdmin");
    await rejects(
      "select public.assign_fund($1,$2,true)",
      [fund, ids.employee2],
      "FORBIDDEN",
    );
  });
  it("H-21: no se invita a quien ya es miembro", async () => {
    await as("owner");
    await rejects(
      "select public.create_invitation($1,$2,'admin')",
      [company, email("employee")],
      "MEMBERSHIP_EXISTS",
    );
  });
  it("H-21: una invitación sobre una membresía existente queda rechazada, no aceptada", async () => {
    const id = await invite(company, "invitee", "admin", "owner");
    await db.exec("reset role");
    await db.query(
      "insert into public.memberships(company_id,user_id,role,active) values($1,$2,'employee',false)",
      [company, ids.invitee],
    );
    expect(await accept("invitee")).toBe(0);
    expect(await membership(company, "invitee")).toEqual({
      role: "employee",
      active: false,
    });
    await db.exec("reset role");
    const r = await db.query<{ reason: string; accepted: boolean }>(
      "select rejected_reason as reason,accepted_at is not null as accepted from public.invitations where id=$1",
      [id],
    );
    expect(r.rows[0]).toEqual({ reason: "membership_exists", accepted: false });
    expect(
      await scalar(
        "select details->>'reason' as value from public.audit_events where action='invitation.rejected' and entity_id=$1",
        [id],
      ),
    ).toBe("membership_exists");
    await as("owner");
    await rejects("select public.revoke_invitation($1)", [id], "FORBIDDEN");
  });
  it("H-22: límite diario de invitaciones por actor", async () => {
    await as("admin2");
    for (let i = 0; i < 20; i++)
      await db.query("select public.create_invitation($1,$2,'employee')", [
        company,
        `limite-${i}@example.test`,
      ]);
    await rejects(
      "select public.create_invitation($1,'limite-extra@example.test','employee')",
      [company],
      "INVITATION_ACTOR_DAILY_LIMIT",
    );
  });
  it("H-22: límite diario de invitaciones por empresa y por correo/minuto", async () => {
    await db.exec("reset role");
    await db.query(
      "insert into public.invitations(company_id,email,role,invited_by) select $1,'masivo-'||g||'@example.test','employee',$2 from generate_series(1,50) g",
      [company, ids.admin3],
    );
    await as("owner");
    await rejects(
      "select public.create_invitation($1,'otro@example.test','employee')",
      [company],
      "INVITATION_COMPANY_DAILY_LIMIT",
    );
    await db.query("select public.create_invitation($1,$2,'employee')", [
      otherCompany,
      "minuto@example.test",
    ]);
    await rejects(
      "select public.create_invitation($1,'minuto@example.test','employee')",
      [otherCompany],
      "INVITATION_RATE_LIMIT",
    );
  });
  it("revocar es idempotente y no se aplica a otra empresa", async () => {
    const id = await invite(company, "invitee", "employee", "owner");
    await db.query("select public.revoke_invitation($1)", [id]);
    await db.query("select public.revoke_invitation($1)", [id]);
    await as("foreignAdmin");
    await rejects("select public.revoke_invitation($1)", [id], "FORBIDDEN");
    await rejects(
      "select public.revoke_invitation($1)",
      [randomUUID()],
      "FORBIDDEN",
    );
    await rejects(
      "select public.set_fund_active($1,false)",
      [fund],
      "FORBIDDEN",
    );
  });
});

describe("H-46 · lectura mínima", () => {
  it("authenticated no lee request_payload ni idempotency_key", async () => {
    const m = await post("employee");
    await as("employee");
    expect(
      await scalar(
        "select amount::text as value from public.movements where id=$1",
        [m],
      ),
    ).toBe("10");
    await rejects(
      "select request_payload from public.movements",
      [],
      "permission denied",
    );
    await rejects(
      "select idempotency_key from public.movements",
      [],
      "permission denied",
    );
    await rejects("select * from public.movements", [], "permission denied");
    const snapshot = await scalar<{
      movements: Record<string, unknown>[];
    }>("select public.workspace_snapshot() as value");
    expect(snapshot.movements[0].amount).toBe("10");
    expect(snapshot.movements[0]).not.toHaveProperty("request_payload");
    expect(snapshot.movements[0]).not.toHaveProperty("idempotency_key");
    const detail = await scalar<{ movement: Record<string, unknown> }>(
      "select public.movement_detail($1) as value",
      [m],
    );
    expect(detail.movement.amount).toBe("10");
    expect(detail.movement).not.toHaveProperty("idempotency_key");
    const report = await scalar<{ total_entries: number }>(
      "select public.financial_report($1,null,current_date,current_date) as value",
      [company],
    );
    expect(report.total_entries).toBeGreaterThan(0);
    await as("owner");
    expect(
      await scalar<{ pending: number }>(
        "select public.alerts_snapshot() as value",
      ),
    ).toHaveProperty("pending");
  });
  it("un empleado solo ve sus propias asignaciones", async () => {
    await as("employee");
    expect(
      await list(
        "select user_id::text as value from public.assignments where fund_id=$1",
        [fund],
      ),
    ).toEqual([ids.employee]);
    await as("owner");
    expect(
      await scalar(
        "select count(*)::text as value from public.assignments where fund_id=$1",
        [fund],
      ),
    ).toBe("2");
  });
  it("los auditores no ven correos de miembros inactivos", async () => {
    await as("owner");
    await db.query("select public.set_member_active($1,$2,false)", [
      company,
      ids.employee2,
    ]);
    type Row = { id: string; email: string | null; active: boolean };
    await as("auditor");
    const forAuditor = await scalar<Row[]>(
      "select public.member_directory($1) as value",
      [company],
    );
    expect(forAuditor.find((m) => m.id === ids.employee2)?.email).toBeNull();
    expect(forAuditor.find((m) => m.id === ids.employee)?.email).toBe(
      email("employee"),
    );
    await as("owner");
    const forAdmin = await scalar<(Row & { creator: boolean })[]>(
      "select public.member_directory($1) as value",
      [company],
    );
    expect(forAdmin.find((m) => m.id === ids.employee2)?.email).toBe(
      email("employee2"),
    );
    expect(forAdmin.find((m) => m.id === ids.owner)?.creator).toBe(true);
    await as("employee");
    await rejects("select public.member_directory($1)", [company], "FORBIDDEN");
  });
});

describe("H-15 / H-44 · lista blanca de privilegios", () => {
  const readable = [
    "assignments",
    "audit_events",
    "categories",
    "check_reviews",
    "checks",
    "companies",
    "drafts",
    "entries",
    "funds",
    "invitations",
    "memberships",
    "movement_comments",
    "period_closures",
    "reviews",
  ];
  const movementColumns = [
    "amount",
    "category_id",
    "company_id",
    "concept",
    "created_at",
    "created_by",
    "destination_id",
    "financial_status",
    "fund_id",
    "id",
    "kind",
    "operation_date",
    "posted_at",
    "review_status",
    "reversal_of",
  ];
  const receiptColumns = [
    "created_at",
    "id",
    "mime_type",
    "movement_id",
    "object_path",
    "original_name",
    "resolved_at",
    "size_bytes",
    "status",
    "status_reason",
    "uploaded_by",
  ];
  const executable = [
    "private.can_discard_receipt(text)",
    "private.can_read_fund(uuid)",
    "private.can_read_receipt(text)",
    "private.can_upload_receipt(text)",
    "private.can_write_fund(uuid)",
    "private.company_role(uuid)",
    "public.accept_invitations()",
    "public.alerts_snapshot()",
    "public.assign_fund(uuid, uuid, boolean)",
    "public.assign_member(uuid, uuid, text)",
    "public.close_period(uuid, date, text)",
    "public.comment_movement(uuid, uuid, text)",
    "public.confirm_receipt(uuid, text, bigint)",
    "public.controls_snapshot()",
    "public.create_category(uuid, text)",
    "public.create_company(text, text)",
    "public.create_fund(uuid, text, text, text, uuid)",
    "public.create_invitation(uuid, text, text)",
    "public.financial_report(uuid, uuid, date, date, text, text, uuid, uuid, integer)",
    "public.member_directory(uuid)",
    "public.movement_detail(uuid)",
    "public.post_movement(uuid, uuid, uuid, text, text, text, date, uuid)",
    "public.record_check(uuid, text, text, uuid)",
    "public.reserve_receipt(uuid, text, text, integer, uuid)",
    "public.reverse_movement(uuid, text, uuid)",
    "public.review_check(uuid, text, text, uuid)",
    "public.review_movement(uuid, text, text, uuid)",
    "public.revoke_invitation(uuid)",
    "public.save_draft(uuid, integer, uuid, uuid, uuid, text, text, text, date)",
    "public.set_fund_active(uuid, boolean)",
    "public.set_member_active(uuid, uuid, boolean)",
    "public.submit_draft(uuid, integer)",
    "public.workspace_snapshot()",
  ];
  const roles = "(values('anon'),('authenticated')) r(name)";
  const schemas = "n.nspname in ('public','private')";

  it("tablas: anon nada; authenticated solo SELECT autorizado", async () => {
    await db.exec("reset role");
    const grants = await list(
      `select r.name||' '||p.priv||' '||n.nspname||'.'||c.relname as value
       from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join ${roles}
       cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
       where ${schemas} and c.relkind in ('r','p','v','m','f') and has_table_privilege(r.name,c.oid,p.priv) order by 1`,
    );
    expect([...grants].sort()).toEqual(
      readable.map((t) => `authenticated SELECT public.${t}`).sort(),
    );
    const columns = await list(
      `select r.name||' '||p.priv||' '||n.nspname||'.'||c.relname||'.'||a.attname as value
       from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join ${roles}
       cross join (values('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(priv)
       where ${schemas} and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped
       and has_column_privilege(r.name,c.oid,a.attnum,p.priv) and not has_table_privilege(r.name,c.oid,p.priv) order by 1`,
    );
    expect([...columns].sort()).toEqual(
      [
        ...movementColumns.map(
          (col) => `authenticated SELECT public.movements.${col}`,
        ),
        ...receiptColumns.map(
          (col) => `authenticated SELECT public.receipts.${col}`,
        ),
      ].sort(),
    );
    expect(
      await list(
        `select n.nspname||'.'||c.relname as value from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where ${schemas} and exists(select 1 from aclexplode(c.relacl) x where x.grantee=0)`,
      ),
    ).toEqual([]);
  });
  it("secuencias: sin privilegios para anon ni authenticated", async () => {
    await db.exec("reset role");
    const sequences = await list(
      `select n.nspname||'.'||c.relname as value from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where ${schemas} and c.relkind='S' order by 1`,
    );
    expect(sequences).toEqual(
      expect.arrayContaining([
        "public.audit_events_id_seq",
        "public.entries_id_seq",
      ]),
    );
    expect(
      await list(
        `select r.name||' '||n.nspname||'.'||c.relname as value from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join ${roles}
         where ${schemas} and c.relkind='S' and (has_sequence_privilege(r.name,c.oid,'USAGE') or has_sequence_privilege(r.name,c.oid,'SELECT') or has_sequence_privilege(r.name,c.oid,'UPDATE'))`,
      ),
    ).toEqual([]);
  });
  it("funciones: anon nada, PUBLIC nada y authenticated solo la lista blanca", async () => {
    await db.exec("reset role");
    const fns = (role: string) =>
      list(
        `select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' as value
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where ${schemas} and has_function_privilege($1,p.oid,'EXECUTE') order by 1`,
        [role],
      );
    expect(await fns("anon")).toEqual([]);
    expect((await fns("authenticated")).sort()).toEqual([...executable].sort());
    expect(
      await list(
        `select n.nspname||'.'||p.proname as value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where ${schemas} and (p.proacl is null or exists(select 1 from aclexplode(p.proacl) x where x.grantee=0))`,
      ),
    ).toEqual([]);
    expect(
      await scalar<boolean>(
        "select has_schema_privilege('anon','private','USAGE') as value",
      ),
    ).toBe(false);
  });
  it("objetos futuros en public no heredan privilegios de anon, authenticated ni PUBLIC", async () => {
    await db.exec("reset role");
    await db.exec(
      "create table public.zz_future(id bigint generated always as identity primary key,note text);create function public.zz_future_fn() returns integer language sql as $$ select 1 $$;",
    );
    expect(
      await list(
        `select r.name as value from ${roles} where has_table_privilege(r.name,'public.zz_future','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_sequence_privilege(r.name,'public.zz_future_id_seq','USAGE,SELECT,UPDATE')
         or has_function_privilege(r.name,'public.zz_future_fn()','EXECUTE')`,
      ),
    ).toEqual([]);
    expect(
      await scalar<boolean>(
        "select has_table_privilege('service_role','public.zz_future','SELECT') as value",
      ),
    ).toBe(true);
  });
  it("anon recibe permission denied en tablas, funciones y secuencias", async () => {
    await as(null);
    for (const table of [...readable, "movements", "installation_owners"])
      await rejects(
        `select 1 from public.${table} limit 1`,
        [],
        "permission denied",
      );
    for (const call of [
      "select public.workspace_snapshot()",
      "select public.accept_invitations()",
      "select public.member_directory(gen_random_uuid())",
      "select public.set_member_active(gen_random_uuid(),gen_random_uuid(),false)",
      "select public.assign_member(gen_random_uuid(),gen_random_uuid(),'admin')",
    ])
      await rejects(call, [], "permission denied");
    await rejects(
      "select nextval('public.audit_events_id_seq')",
      [],
      "permission denied",
    );
    await rejects(
      "select 1 from private.fund_requests",
      [],
      "permission denied",
    );
  });
  it("authenticated no escribe tablas ni usa secuencias directamente", async () => {
    await as("owner");
    await rejects(
      "insert into public.memberships values($1,$2,'admin',true)",
      [company, ids.outsider],
      "permission denied",
    );
    await rejects(
      "update public.invitations set accepted_at=now()",
      [],
      "permission denied",
    );
    await rejects(
      "select nextval('public.entries_id_seq')",
      [],
      "permission denied",
    );
  });
});
