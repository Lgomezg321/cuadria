// Fake Supabase client for the application-layer tests (Server Actions and
// route handlers). It records every call so a test can assert what happened
// and in which order; it never talks to a network service.
import { vi } from "vitest";

type SupabaseError = { message: string; code?: string; status?: number };
export type Result = { data?: unknown; error?: SupabaseError | null };
type Awaitable<T> = T | Promise<T>;

/** Thrown by the mocked requireUser/redirect, like Next's NEXT_REDIRECT. */
export class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`NEXT_REDIRECT:${location}`);
  }
}

export const sessionUser = {
  id: "7f1c2a9e-4b3d-4c5e-8f6a-1b2c3d4e5f60",
  email: "persona@example.test",
};

export function createSupabaseMock(
  options: {
    rpc?: (name: string, args: Record<string, unknown>) => Awaitable<Result>;
    /** Result of from(...).select(...).eq(...).maybeSingle(). */
    row?: Result;
    storage?: Record<string, (...args: never[]) => unknown>;
  } = {},
) {
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push(`rpc:${name}`);
    const r = (await options.rpc?.(name, args)) ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const filters: [string, unknown][] = [];
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    }),
    maybeSingle: vi.fn(async () => ({
      data: options.row?.data ?? null,
      error: options.row?.error ?? null,
    })),
  };
  const from = vi.fn((table: string) => {
    calls.push(`from:${table}`);
    return query;
  });
  const bucket = {
    exists: vi.fn(async (path: string) => {
      calls.push(`storage.exists:${path}`);
      return { data: false, error: null };
    }),
    createSignedUploadUrl: vi.fn(async (path: string) => {
      calls.push(`storage.createSignedUploadUrl:${path}`);
      return {
        data: {
          signedUrl: `https://storage.example.test/upload/${path}?token=t`,
          path,
          token: "t",
        },
        error: null,
      };
    }),
    download: vi.fn(async (path: string) => {
      calls.push(`storage.download:${path}`);
      return { data: null, error: { message: "Object not found" } };
    }),
    remove: vi.fn(async (paths: string[]) => {
      calls.push(`storage.remove:${paths.join(",")}`);
      return { data: [], error: null };
    }),
    createSignedUrl: vi.fn(
      async (...[path]: [path: string, expires: number, options?: unknown]) => {
        calls.push(`storage.createSignedUrl:${path}`);
        return {
          data: {
            signedUrl: `https://storage.example.test/sign/${path}?token=t`,
          },
          error: null,
        };
      },
    ),
    ...options.storage,
  };
  const storage = {
    from: vi.fn((name: string) => {
      calls.push(`storage:${name}`);
      return bucket;
    }),
  };
  const client = { rpc, from, storage };
  return { client, rpc, from, query, filters, bucket, storage, calls };
}
export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

/** Resolved value for the mocked requireUser with the fake client. */
export function session(mock: SupabaseMock, user = sessionUser) {
  return { supabase: mock.client, user } as never;
}

export function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
