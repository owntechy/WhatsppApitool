"use client";

/**
 * Supabase-free API client for browser-side data access.
 * Replaces the old `createClient()` from @supabase/ssr.
 * All queries go through Next.js API routes, which use Prisma + NextAuth
 * session for auth instead of Supabase RLS.
 */

export interface ApiQueryOptions {
  table: string;
  select?: string;
  eq?: Record<string, string>;
  neq?: Record<string, string>;
  ilike?: Record<string, string>;
  in?: Record<string, string[]>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  single?: boolean;
  gte?: Record<string, string>;
  lt?: Record<string, string>;
  offset?: number;
  or?: string;
  count?: string;
}

export interface ApiMutateOptions {
  table: string;
  action: "insert" | "update" | "upsert" | "delete";
  data?: Record<string, unknown>;
  eq?: Record<string, string>;
  is?: Record<string, unknown>;
  onConflict?: string;
  ignoreDuplicates?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _clientInstance: any = null;

export function createClient(): any {
  if (_clientInstance) return _clientInstance;

  _clientInstance = {
    from: (table: string) => ({
      select: (columns = "*", opts?: { count?: string }) => {
        const countOpt = opts?.count;
        return {
        eq: (col: string, val: string) => {
          const base = (single = false) => {
            const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, count: countOpt };
            if (single) opts.single = true;
            return buildQuery(opts);
          };
          return {
            eq: (col2: string, val2: string) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val, [col2]: val2 } };
              return buildQuery(opts);
            },
            neq: (col2: string, val2: string) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, neq: { [col2]: val2 } };
              return buildQuery(opts);
            },
            ilike: (col2: string, val2: string) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, ilike: { [col2]: val2 } };
              return buildQuery(opts);
            },
            maybeSingle: () => base(true),
            single: () => base(true).then((r) => {
              if (r.error) return { data: null, error: r.error };
              if (!r.data) return { data: null, error: new Error("Not found") };
              return { data: r.data, error: null };
            }),
            in: (col2: string, vals: string[]) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, in: { [col2]: vals } };
              return buildQuery(opts);
            },
            gte: (col2: string, val2: string) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, gte: { [col2]: val2 } };
              return buildQuery(opts);
            },
            order: (col2: string, { ascending = true } = {}) => ({
              limit: (n: number) => {
                const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, order: { column: col2, ascending }, limit: n };
                return buildQuery(opts);
              },
              then: (cb: (r: { data: unknown; error: unknown }) => void) => {
                return buildQuery({ table, select: columns, eq: { [col]: val }, order: { column: col2, ascending }, count: countOpt }).then(cb);
              },
            }),
            limit: (n: number) => {
              const opts: ApiQueryOptions = { table, select: columns, eq: { [col]: val }, limit: n };
              return buildQuery(opts);
            },
            then: (cb: (r: { data: unknown; error: unknown }) => void) => {
              return base().then(cb);
            },
          };
        },
        in: (col: string, vals: string[]) => {
          const opts: ApiQueryOptions = { table, select: columns, in: { [col]: vals } };
          return buildQuery(opts);
        },
        gte: (col: string, val: string) => {
          const opts: ApiQueryOptions = { table, select: columns, gte: { [col]: val } };
          return buildQuery(opts);
        },
        order: (col: string, { ascending = true } = {}) => {
          const orderOpts = { column: col, ascending };
          const exec = (extra?: Partial<ApiQueryOptions>) => buildQuery({ table, select: columns, order: orderOpts, count: countOpt, ...extra });
          return {
            limit: (n: number) => ({
              maybeSingle: () => exec({ limit: n, single: true }),
              single: () => exec({ limit: n, single: true }).then((r) => {
                if (r.error) return { data: null, error: r.error };
                if (!r.data) return { data: null, error: new Error("Not found") };
                return { data: r.data, error: null };
              }),
              then: (cb: (r: { data: unknown; error: unknown }) => void) => exec({ limit: n }).then(cb),
            }),
            eq: (col2: string, val: string) => exec({ eq: { [col2]: val } }),
            range: (from: number, to: number) => {
              const base = { offset: from, limit: to - from + 1, count: countOpt };
              const exec2 = (extra?: Partial<ApiQueryOptions>) => exec({ ...base, ...extra });
              return {
                or: (orStr: string) => exec2({ or: orStr }),
                then: (cb: (r: { data: unknown; error: unknown; count?: number | null }) => void) => exec2().then(cb),
              };
            },
            maybeSingle: () => exec({ single: true }),
            single: () => exec({ single: true }).then((r) => {
              if (r.error) return { data: null, error: r.error };
              if (!r.data) return { data: null, error: new Error("Not found") };
              return { data: r.data, error: null };
            }),
            then: (cb: (r: { data: unknown; error: unknown }) => void) => exec().then(cb),
          };
        },
        limit: (n: number) => ({
          order: (col: string, { ascending = true } = {}) => {
            const opts: ApiQueryOptions = {
              table, select: columns,
              limit: n,
              order: { column: col, ascending },
            };
            return buildQuery(opts);
          },
          eq: (col2: string, val: string) => {
            const opts: ApiQueryOptions = {
              table, select: columns,
              limit: n,
              eq: { [col2]: val },
            };
            return buildQuery(opts);
          },
          maybeSingle: () => {
            const opts: ApiQueryOptions = { table, select: columns, limit: n, single: true };
            return buildQuery(opts);
          },
          single: () => {
            const opts: ApiQueryOptions = { table, select: columns, limit: n, single: true };
            return buildQuery(opts).then((r) => {
              if (r.error) return { data: null, error: r.error };
              if (!r.data) return { data: null, error: new Error("Not found") };
              return { data: r.data, error: null };
            });
          },
          then: (cb: (r: { data: unknown; error: unknown }) => void) => {
            return buildQuery({ table, select: columns, limit: n, count: countOpt }).then(cb);
          },
        }),
        maybeSingle: () => {
          const opts: ApiQueryOptions = { table, select: columns, single: true };
          return buildQuery(opts);
        },
        single: () => {
          const opts: ApiQueryOptions = { table, select: columns, single: true };
          return buildQuery(opts).then((r) => {
            if (r.error) return { data: null, error: r.error };
            if (!r.data) return { data: null, error: new Error("Not found") };
            return { data: r.data, error: null };
          });
        },
        then: (cb: (r: { data: unknown; error: unknown; count?: number | null }) => void) => {
          return buildQuery({ table, select: columns, count: countOpt }).then(cb);
        },
      };
      },
      insert: (data: Record<string, unknown>) => {
        const exec = () => mutate({ table, action: "insert", data });
        return {
          select: (fields?: string) => ({
            single: () => exec().then((r) => ({
              data: Array.isArray(r.data) ? r.data[0] ?? null : r.data,
              error: r.error,
            })),
            then: (cb: (r: { data: unknown; error: unknown }) => void) => exec().then(cb),
          }),
          then: (cb: (r: { data: unknown; error: unknown }) => void) => exec().then(cb),
        };
      },
      update: (data: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          return mutate({ table, action: "update", data, eq: { [col]: val } });
        },
        is: (col: string, val: unknown) => {
          return mutate({ table, action: "update", data, is: { [col]: val } });
        },
      }),
      upsert: (data: Record<string, unknown>, { onConflict, ignoreDuplicates = false }: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        return mutate({ table, action: "upsert", data, onConflict, ignoreDuplicates });
      },
      delete: () => ({
        eq: (col: string, val: string) => {
          return mutate({ table, action: "delete", eq: { [col]: val } });
        },
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
    }),
    removeChannel: () => {},
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => {},
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      return fetch("/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fn, params }),
      }).then((r) => r.json());
    },
  };
  return _clientInstance;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === "object") {
    const msg = (err as Record<string, unknown>).error
      ?? (err as Record<string, unknown>).message
      ?? String(err);
    return new Error(String(msg));
  }
  return new Error(String(err));
}

async function buildQuery(opts: ApiQueryOptions) {
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: toError(json) };
    return { data: json.data, error: null, count: json.count ?? null };
  } catch (err) {
    return { data: null, error: toError(err) };
  }
}

async function mutate(opts: ApiMutateOptions) {
  try {
    const res = await fetch("/api/query", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: toError(json) };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: toError(err) };
  }
}
