// Application-layer tests (H-03) for the Server Actions with a fake Supabase
// client: session before any work, amounts as strings, idempotency keys passed
// to the RPCs, receipt reservation/confirmation and the invitation admin client.
// They exercise the real action code; only Next/Supabase boundaries are mocked.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  formData,
  RedirectSignal,
  session,
  sessionUser,
} from "./helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new RedirectSignal(location);
  }),
}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
  inRecoveryMode: vi.fn(async () => false),
  isTransientAuthError: vi.fn(() => false),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createEphemeralClient: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const { requireUser, inRecoveryMode } = await import("@/lib/auth");
const { createClient: createSessionClient, createEphemeralClient } =
  await import("@/lib/supabase/server");
const { createClient: createAdminClient } =
  await import("@supabase/supabase-js");
const { mutate, changePassword } = await import("@/app/actions");
const { inviteEmployee, acceptInvitations } =
  await import("@/app/invitation-actions");
const { reserveReceiptUpload, confirmReceiptUpload } =
  await import("@/app/receipt-actions");
const { signReceiptVerdict } = await import("@/lib/receipt-signature");

const noSession = () =>
  vi.mocked(requireUser).mockRejectedValue(new RedirectSignal("/login"));
function signedIn(options: Parameters<typeof createSupabaseMock>[0] = {}) {
  const mock = createSupabaseMock(options);
  vi.mocked(requireUser).mockResolvedValue(session(mock));
  return mock;
}
const ids = {
  company: randomUUID(),
  fund: randomUUID(),
  destination: randomUUID(),
  movement: randomUUID(),
  check: randomUUID(),
  key: randomUUID(),
};
const movementForm = (overrides: Record<string, string> = {}) =>
  formData({
    operation: "movement",
    fund: ids.fund,
    destination: "",
    category: "",
    kind: "expense",
    amount: "1500000",
    concept: "Compra de papelería",
    date: "2026-10-21",
    key: ids.key,
    ...overrides,
  });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(requireUser).mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createEphemeralClient).mockReset();
  vi.mocked(createSessionClient).mockReset();
  vi.mocked(inRecoveryMode).mockClear();
});

describe("toda acción protegida exige sesión antes de cualquier trabajo", () => {
  const invalidReceipt = { movement: "x", key: "y", name: "", size: -1 };
  const cases: [string, () => Promise<unknown>][] = [
    ["mutate (datos válidos)", () => mutate({}, movementForm())],
    // Invalid data must still be rejected by the session check, not by zod.
    [
      "mutate (datos inválidos)",
      () => mutate({}, movementForm({ amount: "1.000", key: "" })),
    ],
    [
      "mutate (operación desconocida)",
      () => mutate({}, formData({ operation: "nada" })),
    ],
    [
      "inviteEmployee",
      () =>
        inviteEmployee(
          {},
          formData({ company: ids.company, email: "a@b.co", role: "admin" }),
        ),
    ],
    ["acceptInvitations", () => acceptInvitations()],
    [
      "changePassword",
      () =>
        changePassword({}, formData({ password: "x", currentPassword: "y" })),
    ],
    ["reserveReceiptUpload", () => reserveReceiptUpload(invalidReceipt)],
    ["confirmReceiptUpload", () => confirmReceiptUpload("no-es-uuid")],
  ];
  it.each(cases)("%s", async (_name, run) => {
    // Configured service key: the action must still stop at the session.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "clave-publicable");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "clave-servidor");
    noSession();
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    expect(requireUser).toHaveBeenCalledTimes(1);
    // Nothing else ran: no Supabase client of any kind, no recovery check.
    expect(createSessionClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createEphemeralClient).not.toHaveBeenCalled();
    expect(inRecoveryMode).not.toHaveBeenCalled();
  });
});

describe("importes como cadenas decimales", () => {
  it("el importe viaja como string exacto hasta 18 dígitos, sin Number", async () => {
    const mock = signedIn();
    for (const amount of ["1500000", "999999999999999999", "1"]) {
      expect(await mutate({}, movementForm({ amount }))).toEqual({
        success: "Operación guardada correctamente.",
      });
      const args = mock.rpc.mock.lastCall?.[1] as Record<string, unknown>;
      expect(mock.rpc.mock.lastCall?.[0]).toBe("post_movement");
      expect(args.p_amount).toBe(amount);
      expect(typeof args.p_amount).toBe("string");
    }
  });
  it.each([
    "1.000",
    "1,000",
    "1e3",
    " 100",
    "100 ",
    "-5",
    "0",
    "0100",
    "100.5",
    "1000000000000000000",
    "",
    "١٢٣",
  ])("rechaza %j sin llamar a la base", async (amount) => {
    const mock = signedIn();
    const result = await mutate({}, movementForm({ amount }));
    expect(result.error).toMatch(/^Valor: /);
    expect(result.fieldErrors?.amount).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("apertura y arqueo admiten cero como cadena y rechazan formatos con separadores", async () => {
    const mock = signedIn();
    await mutate(
      {},
      formData({
        operation: "fund",
        company: ids.company,
        name: "Caja menor",
        kind: "cash",
        opening: "0",
        key: ids.key,
      }),
    );
    expect(mock.rpc).toHaveBeenLastCalledWith(
      "create_fund",
      expect.objectContaining({ p_opening: "0" }),
    );
    await mutate(
      {},
      formData({
        operation: "check",
        fund: ids.fund,
        declared: "250000",
        note: "",
        key: ids.key,
      }),
    );
    expect(mock.rpc).toHaveBeenLastCalledWith(
      "record_check",
      expect.objectContaining({ p_declared: "250000" }),
    );
    const before = mock.rpc.mock.calls.length;
    const rejected = await mutate(
      {},
      formData({
        operation: "check",
        fund: ids.fund,
        declared: "250.000",
        note: "",
        key: ids.key,
      }),
    );
    expect(rejected.fieldErrors?.declared).toBeTruthy();
    expect(mock.rpc.mock.calls.length).toBe(before);
  });
  it("una transferencia sin destino no llega a la base", async () => {
    const mock = signedIn();
    expect(await mutate({}, movementForm({ kind: "transfer" }))).toEqual({
      error: "Selecciona el fondo de destino.",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("los errores de la RPC se traducen sin filtrar mensajes internos", async () => {
    signedIn({
      rpc: () => ({
        error: { message: "INSUFFICIENT_FUNDS", code: "P0001" },
      }),
    });
    expect(await mutate({}, movementForm())).toEqual({
      error: "El fondo no tiene saldo suficiente.",
    });
    signedIn({
      rpc: () => ({
        error: { message: 'relation "x" does not exist', code: "42P01" },
      }),
    });
    const result = await mutate({}, movementForm());
    expect(result.error).toMatch(/No fue posible guardar la operación/);
    expect(result.error).not.toMatch(/relation/);
  });
});

describe("claves de idempotencia", () => {
  const key = randomUUID();
  const operations: [string, Record<string, string>, string][] = [
    [
      "movement",
      { ...Object.fromEntries(movementForm()), key },
      "post_movement",
    ],
    [
      "fund",
      {
        operation: "fund",
        company: ids.company,
        name: "Banco",
        kind: "bank",
        opening: "10",
        key,
      },
      "create_fund",
    ],
    [
      "check",
      { operation: "check", fund: ids.fund, declared: "10", note: "", key },
      "record_check",
    ],
    [
      "review",
      {
        operation: "review",
        movement: ids.movement,
        decision: "approved",
        comment: "",
        key,
      },
      "review_movement",
    ],
    [
      "checkReview",
      {
        operation: "checkReview",
        check: ids.check,
        decision: "observed",
        comment: "Falta soporte",
        key,
      },
      "review_check",
    ],
    [
      "reversal",
      {
        operation: "reversal",
        movement: ids.movement,
        reason: "Factura duplicada",
        key,
      },
      "reverse_movement",
    ],
  ];
  it.each(operations)(
    "%s pasa la clave del formulario a la RPC",
    async (_op, values, rpc) => {
      const mock = signedIn();
      await mutate({}, formData(values));
      expect(mock.rpc).toHaveBeenCalledTimes(1);
      expect(mock.rpc).toHaveBeenCalledWith(
        rpc,
        expect.objectContaining({ p_key: key }),
      );
    },
  );
  it.each(operations)(
    "%s sin clave o con clave inválida no llega a la base",
    async (_op, values) => {
      const mock = signedIn();
      for (const bad of [undefined, "no-es-uuid"]) {
        const form = { ...values } as Record<string, string>;
        if (bad === undefined) delete form.key;
        else form.key = bad;
        const result = await mutate({}, formData(form));
        expect(result.error).toBeTruthy();
      }
      expect(mock.rpc).not.toHaveBeenCalled();
    },
  );
  it("los comentarios usan su identificador como clave y descartan campos extra", async () => {
    const mock = signedIn();
    const id = randomUUID();
    await mutate(
      {},
      formData({
        operation: "movementComment",
        id,
        movement: ids.movement,
        body: "Adjunto la factura",
        p_actor: "otro",
      }),
    );
    expect(mock.rpc).toHaveBeenCalledWith("comment_movement", {
      p_id: id,
      p_movement: ids.movement,
      p_body: "Adjunto la factura",
    });
  });
});

describe("reserveReceiptUpload", () => {
  const valid = () => ({
    movement: ids.movement,
    key: randomUUID(),
    name: "factura.pdf",
    mime: "application/pdf",
    size: 1234,
  });
  const reservation = (over: Record<string, unknown> = {}) => ({
    data: {
      id: randomUUID(),
      path: `${ids.company}/${ids.movement}/archivo`,
      mime: "application/pdf",
      status: "pending",
      created_at: new Date().toISOString(),
      replayed: false,
      ...over,
    },
  });
  it.each([
    ["movimiento no UUID", { movement: "x" }],
    ["clave ausente", { key: undefined }],
    ["MIME no permitido", { mime: "text/html" }],
    ["tamaño cero", { size: 0 }],
    ["más de 10 MB", { size: 10 * 1024 * 1024 + 1 }],
    ["tamaño como texto", { size: "1234" }],
    ["tamaño fraccionario", { size: 12.5 }],
    ["nombre vacío", { name: "" }],
    ["nombre solo con espacios", { name: "   " }],
  ])("rechaza %s sin reservar", async (_name, over) => {
    const mock = signedIn();
    const result = await reserveReceiptUpload({ ...valid(), ...over });
    expect("error" in result && result.error).toBeTruthy();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("reserva con clave y nombre saneado, y firma la subida con la sesión", async () => {
    const r = reservation();
    const mock = signedIn({ rpc: () => r });
    const input = { ...valid(), name: "fac\ttura/marzo.pdf" };
    const result = await reserveReceiptUpload(input);
    expect(mock.rpc).toHaveBeenCalledWith("reserve_receipt", {
      p_movement: ids.movement,
      p_name: "fac_tura_marzo.pdf",
      p_mime: "application/pdf",
      p_size: 1234,
      p_key: input.key,
    });
    const { path, id } = r.data;
    expect(mock.storage.from).toHaveBeenCalledWith("receipts");
    expect(mock.bucket.createSignedUploadUrl).toHaveBeenCalledWith(path);
    expect(result).toEqual({
      receiptId: id,
      state: "upload",
      signedUrl: `https://storage.example.test/upload/${path}?token=t`,
      mime: "application/pdf",
    });
    expect(mock.calls.indexOf("rpc:reserve_receipt")).toBeLessThan(
      mock.calls.indexOf(`storage.createSignedUploadUrl:${path}`),
    );
  });
  it("no firma reservas verificadas, rechazadas, vencidas ni respuestas inesperadas", async () => {
    for (const [status, expected] of [
      ["verified", { state: "verified" }],
      ["rejected", { renewKey: true }],
      ["expired", { renewKey: true }],
    ] as const) {
      const mock = signedIn({ rpc: () => reservation({ status }) });
      expect(await reserveReceiptUpload(valid())).toMatchObject(expected);
      expect(mock.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    }
    const mock = signedIn({ rpc: () => ({ data: { id: "x" } }) });
    expect(await reserveReceiptUpload(valid())).toEqual({
      error:
        "No fue posible preparar la carga. El movimiento sigue registrado; vuelve a intentarlo.",
    });
    expect(mock.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("un reintento con el archivo ya almacenado pasa directo a verificar", async () => {
    const r = reservation({ replayed: true });
    const mock = signedIn({
      rpc: () => r,
      storage: { exists: async () => ({ data: true, error: null }) },
    });
    expect(await reserveReceiptUpload(valid())).toEqual({
      receiptId: r.data.id,
      state: "uploaded",
    });
    expect(mock.bucket.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("traduce los errores de la reserva", async () => {
    signedIn({ rpc: () => ({ error: { message: "RECEIPT_LIMIT" } }) });
    const result = await reserveReceiptUpload(valid());
    expect("error" in result && result.error).toMatch(/límite de comprobantes/);
  });
});

describe("confirmReceiptUpload", () => {
  const pdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  );
  const row = (over: Record<string, unknown> = {}) => ({
    data: {
      id: ids.movement,
      object_path: "c/m/r",
      mime_type: "application/pdf",
      size_bytes: pdf.length,
      status: "pending",
      status_reason: null,
      uploaded_by: sessionUser.id,
      ...over,
    },
  });
  const stored = (bytes: Uint8Array<ArrayBuffer>) => ({
    download: async () => ({ data: new Blob([bytes]), error: null }),
  });
  const secret = "s".repeat(40);
  beforeEach(() => vi.stubEnv("RECEIPT_VERIFICATION_SECRET", secret));
  it("R-01: sin secreto de verificación no descarga ni confirma (falla cerrado)", async () => {
    for (const value of ["", "corto"]) {
      vi.stubEnv("RECEIPT_VERIFICATION_SECRET", value);
      const mock = signedIn({ row: row() });
      expect(await confirmReceiptUpload(ids.movement)).toEqual({
        error:
          "La verificación de comprobantes no está configurada en el servidor. El archivo queda pendiente; avisa al administrador.",
      });
      expect(mock.bucket.download).not.toHaveBeenCalled();
      expect(mock.rpc).not.toHaveBeenCalled();
    }
    expect(console.error).toHaveBeenCalledTimes(2);
  });
  it("un identificador inválido no consulta nada", async () => {
    const mock = signedIn();
    expect(await confirmReceiptUpload("../../etc")).toEqual({
      error: "Comprobante no válido.",
    });
    expect(mock.calls).toEqual([]);
  });
  it("una reserva ajena o inexistente no se verifica", async () => {
    for (const r of [row({ uploaded_by: randomUUID() }), { data: null }]) {
      const mock = signedIn({ row: r });
      expect(await confirmReceiptUpload(ids.movement)).toEqual({
        error: "No encontramos la reserva de este comprobante.",
      });
      expect(mock.bucket.download).not.toHaveBeenCalled();
      expect(mock.rpc).not.toHaveBeenCalled();
    }
  });
  it("verifica los bytes reales y confirma con el MIME detectado y el tamaño", async () => {
    const mock = signedIn({
      row: row(),
      storage: stored(pdf),
      rpc: () => ({ data: { status: "verified", reason: null } }),
    });
    expect(await confirmReceiptUpload(ids.movement)).toEqual({
      success: "Comprobante verificado y guardado en almacenamiento privado.",
    });
    expect(mock.filters).toContainEqual(["id", ids.movement]);
    const signature = signReceiptVerdict(secret, {
      receipt: ids.movement,
      detectedMime: "application/pdf",
      size: pdf.length,
      user: sessionUser.id,
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(mock.rpc).toHaveBeenCalledWith("confirm_receipt", {
      p_receipt: ids.movement,
      p_detected_mime: "application/pdf",
      p_size: pdf.length,
      p_signature: signature,
    });
  });
  it("contenido que no coincide se confirma como rechazo y se descarta el objeto", async () => {
    const html = new TextEncoder().encode("<html>no es un pdf</html>");
    const mock = signedIn({
      row: row({ size_bytes: html.length }),
      storage: stored(html),
      rpc: () => ({ data: { status: "rejected", reason: "content" } }),
    });
    expect(await confirmReceiptUpload(ids.movement)).toEqual({
      error: "El archivo debe ser una imagen JPG, PNG o un PDF válido.",
    });
    // The signed verdict carries the inspection result (no MIME detected).
    expect(mock.rpc).toHaveBeenCalledWith("confirm_receipt", {
      p_receipt: ids.movement,
      p_detected_mime: null,
      p_size: html.length,
      p_signature: signReceiptVerdict(secret, {
        receipt: ids.movement,
        detectedMime: null,
        size: html.length,
        user: sessionUser.id,
      }),
    });
    expect(mock.bucket.remove).toHaveBeenCalledWith(["c/m/r"]);
  });
  it("si el archivo aún no está, pide reintentar sin confirmar", async () => {
    const mock = signedIn({ row: row() });
    expect(await confirmReceiptUpload(ids.movement)).toMatchObject({
      retry: true,
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reservas ya resueltas no se vuelven a descargar", async () => {
    for (const [status, expected] of [
      ["verified", { success: expect.any(String) }],
      ["rejected", { error: expect.any(String) }],
      ["expired", { error: expect.stringMatching(/venció/) }],
    ] as const) {
      const mock = signedIn({ row: row({ status }) });
      expect(await confirmReceiptUpload(ids.movement)).toEqual(expected);
      expect(mock.bucket.download).not.toHaveBeenCalled();
      expect(mock.rpc).not.toHaveBeenCalled();
    }
  });
});

describe("changePassword (R-05)", () => {
  it("si la ventana de recuperación venció avisa con enlace y no toca Auth", async () => {
    signedIn();
    vi.mocked(inRecoveryMode).mockResolvedValueOnce(false);
    const result = await changePassword(
      {},
      formData({
        password: "una-clave-larga-1",
        confirmPassword: "una-clave-larga-1",
      }),
    );
    expect(result).toEqual({
      error:
        "El enlace de recuperación venció antes de guardar. Solicita uno nuevo desde la página de ingreso.",
      link: { href: "/login", label: "Solicitar un nuevo enlace" },
    });
    expect(createEphemeralClient).not.toHaveBeenCalled();
  });
  it("en una sesión normal sigue exigiendo la contraseña actual", async () => {
    signedIn();
    vi.mocked(inRecoveryMode).mockResolvedValueOnce(false);
    const result = await changePassword(
      {},
      formData({
        currentPassword: "",
        password: "una-clave-larga-1",
        confirmPassword: "una-clave-larga-1",
      }),
    );
    expect(result.fieldErrors?.currentPassword).toBe(
      "Ingresa tu contraseña actual.",
    );
    expect(createEphemeralClient).not.toHaveBeenCalled();
  });
});

describe("inviteEmployee: cliente administrativo solo tras create_invitation", () => {
  const email = "nueva.persona@example.test";
  const form = () =>
    formData({ company: ids.company, email, role: "employee" });
  function configure() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "clave-publicable");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "clave-servidor");
  }
  function adminApi(error: unknown = null) {
    const inviteUserByEmail = vi.fn(async () => ({ data: {}, error }));
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail } },
    } as never);
    return inviteUserByEmail;
  }
  it("sin clave de servidor no invita ni crea el cliente", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "clave-publicable");
    const mock = signedIn();
    expect((await inviteEmployee({}, form())).error).toMatch(
      /clave de administración/,
    );
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("datos inválidos no llegan a la RPC ni al cliente administrativo", async () => {
    configure();
    const mock = signedIn();
    for (const values of [
      { company: "x", email, role: "employee" },
      { company: ids.company, email: "no-es-correo", role: "employee" },
      { company: ids.company, email, role: "owner" },
    ])
      expect((await inviteEmployee({}, formData(values))).error).toBe(
        "Revisa la empresa, el correo y el rol.",
      );
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("si create_invitation falla no se crea el cliente administrativo", async () => {
    configure();
    adminApi();
    for (const message of [
      "FORBIDDEN",
      "ADMIN_CHANGE_RESTRICTED",
      "MEMBERSHIP_EXISTS",
      "INVITATION_ACTOR_DAILY_LIMIT",
    ]) {
      signedIn({ rpc: () => ({ error: { message } }) });
      expect((await inviteEmployee({}, form())).error).toBeTruthy();
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it("tras create_invitation exitoso crea el cliente sin sesión persistente y envía", async () => {
    configure();
    const send = adminApi();
    const mock = signedIn({ rpc: () => ({ data: randomUUID() }) });
    expect(await inviteEmployee({}, form())).toEqual({
      success:
        "Invitación enviada. La membresía se activa al verificar el correo e iniciar sesión.",
    });
    expect(mock.rpc).toHaveBeenCalledWith("create_invitation", {
      p_company: ids.company,
      p_email: email,
      p_role: "employee",
    });
    expect(createAdminClient).toHaveBeenCalledWith(
      "https://proyecto.example.test",
      "clave-servidor",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(mock.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createAdminClient).mock.invocationCallOrder[0],
    );
    expect(send).toHaveBeenCalledWith(email, {
      redirectTo: "http://localhost:3000/auth/callback?next=/auth/password",
    });
  });
  it("un fallo de envío se registra en el servidor sin el correo", async () => {
    configure();
    adminApi({
      name: "AuthApiError",
      status: 500,
      code: "unexpected_failure",
      message: `Error sending invite email to ${email}`,
    });
    const invitation = randomUUID();
    signedIn({ rpc: () => ({ data: invitation }) });
    const error = vi.mocked(console.error);
    expect((await inviteEmployee({}, form())).error).toMatch(
      /quedó registrada, pero el correo no se pudo enviar/,
    );
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      event: "invitation.delivery_failed",
      invitation,
      status: 500,
      code: "unexpected_failure",
    });
    expect(line).not.toContain(email);
  });
  it("acceptInvitations registra el fallo y responde en español", async () => {
    signedIn({ rpc: () => ({ error: { message: "EMAIL_NOT_VERIFIED" } }) });
    await expect(acceptInvitations()).rejects.toThrow(
      "No fue posible aceptar las invitaciones. Verifica tu correo.",
    );
    expect(
      JSON.parse(String(vi.mocked(console.warn).mock.calls[0][0])),
    ).toMatchObject({ event: "invitation.accept_failed" });
  });
});
