// Application-layer tests (H-03, H-35) for the route handlers with a fake
// Supabase client: reports authenticate before reading filters and answer
// invalid filters with 400 in Spanish; /comprobantes/[id] answers a uniform
// 404 and only signs verified receipts.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  RedirectSignal,
  session,
} from "./helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));

const { requireUser } = await import("@/lib/auth");
const csv = await import("@/app/reportes/csv/route");
const pdf = await import("@/app/reportes/pdf/route");
const receipt = await import("@/app/comprobantes/[id]/route");

function signedIn(options: Parameters<typeof createSupabaseMock>[0] = {}) {
  const mock = createSupabaseMock(options);
  vi.mocked(requireUser).mockResolvedValue(session(mock));
  return mock;
}
const fund = randomUUID();
const report = {
  from: "2026-10-01",
  to: "2026-10-21",
  offset: 0,
  total_entries: 0,
  totals: [
    {
      id: fund,
      name: "Caja menor",
      company_name: "Empresa",
      opening_balance: "0",
      opening_funding: "1000",
      income: "999999999999999999",
      expenses: "0",
      transfers_net: "0",
      reversals_net: "0",
      closing_balance: "1000000000000000999",
    },
  ],
  entries: [],
};
const request = (path: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(requireUser).mockReset();
});

describe.each([
  ["/reportes/csv", csv.GET],
  ["/reportes/pdf", pdf.GET],
])("%s", (path, GET) => {
  it("autentica antes de leer los filtros", async () => {
    vi.mocked(requireUser).mockRejectedValue(new RedirectSignal("/login"));
    // Invalid filters: without a session the answer is the login redirect,
    // never a 400 that would reveal how filters are validated.
    await expect(GET(request(`${path}?from=ayer&fund=x`))).rejects.toThrow(
      RedirectSignal,
    );
    expect(requireUser).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["fecha inválida", "from=2026-02-30&to=2026-10-01", /fecha inicial/],
    ["sin fechas", "", /fecha inicial/],
    [
      "inicio posterior al corte",
      "from=2026-10-21&to=2026-10-01",
      /anterior o igual/,
    ],
    ["más de 366 días", "from=2025-01-01&to=2026-10-21", /366 días/],
    ["fondo no UUID", "from=2026-10-01&to=2026-10-21&fund=ajeno", /fondo/],
    ["tipo desconocido", "from=2026-10-01&to=2026-10-21&kind=x", /tipo/],
    ["página negativa", "from=2026-10-01&to=2026-10-21&offset=-200", /página/],
  ])("%s: 400 en español sin consultar la base", async (_n, query, message) => {
    const mock = signedIn();
    const response = await GET(request(`${path}?${query}`));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await response.text()).toMatch(message);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("un rango rechazado por la base también es 400", async () => {
    signedIn({ rpc: () => ({ error: { message: "INVALID_REPORT_RANGE" } }) });
    const response = await GET(
      request(`${path}?from=2026-10-01&to=2026-10-21`),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/366 días/);
  });
  it("un fallo de la base es 503 genérico y se registra en el servidor", async () => {
    signedIn({
      rpc: () => ({ error: { message: "connection refused 10.0.0.1" } }),
    });
    const response = await GET(
      request(`${path}?from=2026-10-01&to=2026-10-21`),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/No fue posible generar el reporte/);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
  it("con filtros válidos llama a la RPC con la sesión y descarga", async () => {
    const mock = signedIn({ rpc: () => ({ data: report }) });
    const response = await GET(
      request(`${path}?from=2026-10-01&to=2026-10-21&fund=${fund}&kind=`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="cuadria-2026-10-01-2026-10-21\.(csv|pdf)"/,
    );
    expect(mock.rpc).toHaveBeenCalledWith("financial_report", {
      p_company: null,
      p_fund: fund,
      p_from: "2026-10-01",
      p_to: "2026-10-21",
      p_kind: null,
      p_review: null,
      p_category: null,
      p_author: null,
      p_offset: 0,
    });
  });
});

it("el CSV conserva importes de más de 15 dígitos como texto", async () => {
  signedIn({ rpc: () => ({ data: report }) });
  const body = await (
    await csv.GET(request("/reportes/csv?from=2026-10-01&to=2026-10-21"))
  ).text();
  expect(body).toContain('"COP 999999999999999999"');
  expect(body).toContain('"COP 1000000000000000999"');
});

describe("/comprobantes/[id]", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const get = (id: string) =>
    receipt.GET(
      new Request(`http://localhost:3000/comprobantes/${id}`),
      params(id),
    );
  async function notFound(response: Response) {
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return response.text();
  }
  it("exige sesión antes de validar el identificador", async () => {
    vi.mocked(requireUser).mockRejectedValue(new RedirectSignal("/login"));
    await expect(get("no-es-uuid")).rejects.toThrow(RedirectSignal);
  });
  it("404 uniforme: identificador inválido, inexistente, ajeno o con error", async () => {
    const invalid = signedIn();
    const bodies = [await notFound(await get("../secreto"))];
    expect(invalid.from).not.toHaveBeenCalled();
    // RLS hides other companies' receipts: same answer as a missing row.
    signedIn({ row: { data: null } });
    bodies.push(await notFound(await get(randomUUID())));
    signedIn({ row: { error: { message: "permission denied" } } });
    bodies.push(await notFound(await get(randomUUID())));
    expect(new Set(bodies)).toEqual(new Set(["No encontrado"]));
  });
  it("solo consulta comprobantes verificados y nunca firma sin fila", async () => {
    const id = randomUUID();
    const mock = signedIn({ row: { data: null } });
    await get(id);
    expect(mock.from).toHaveBeenCalledWith("receipts");
    expect(mock.filters).toEqual([
      ["id", id],
      ["status", "verified"],
    ]);
    expect(mock.bucket.createSignedUrl).not.toHaveBeenCalled();
  });
  it("imágenes en línea y PDF como descarga, con URL de 60 s y sin caché", async () => {
    for (const [mime, download] of [
      ["image/png", undefined],
      ["application/pdf", { download: "factura_marzo.pdf" }],
    ] as const) {
      const mock = signedIn({
        row: {
          data: {
            object_path: "c/m/r",
            mime_type: mime,
            original_name: "factura/marzo.pdf",
          },
        },
      });
      const response = await get(randomUUID());
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "https://storage.example.test/sign/c/m/r?token=t",
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(mock.bucket.createSignedUrl).toHaveBeenCalledWith(
        "c/m/r",
        60,
        download,
      );
    }
  });
});
