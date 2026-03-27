// supabase/functions/notify/_helpers.ts
// Shared helpers for Epic I notification jobs.
// Used by: notify-topic-follows, notify-stance-changes, notify-weekly-digest

export type LogLevel = "info" | "warn" | "error";

export function log(
  func: string,
  level: LogLevel,
  msg: string,
  extra: Record<string, unknown> = {},
  traceId?: string,
) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      func,
      traceId,
      msg,
      ...extra,
    }),
  );
}

// ---------------------------------------------------------------------------
// Supabase admin client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

export function makeAdminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL");
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");

  if (!url || !key) throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");

  // Thin PostgREST wrapper — avoids importing the full Supabase JS SDK in Deno
  return {
    url: url.replace(/\/+$/, ""),
    key,

    async rpc<T = unknown>(fn: string, params: Record<string, unknown> = {}): Promise<T[]> {
      const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`rpc ${fn} failed ${res.status}: ${text}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [data];
    },

    async from<T = unknown>(
      table: string,
      query: string = "",
    ): Promise<T[]> {
      const res = await fetch(`${this.url}/rest/v1/${table}${query ? `?${query}` : ""}`, {
        headers: this._headers(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET ${table} failed ${res.status}: ${text}`);
      }
      return res.json() as Promise<T[]>;
    },

    async insert(table: string, rows: unknown[]): Promise<void> {
      if (rows.length === 0) return;
      const res = await fetch(`${this.url}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...this._headers(), Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(rows),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`INSERT ${table} failed ${res.status}: ${text}`);
      }
    },

    _headers(): Record<string, string> {
      return {
        "Content-Type": "application/json",
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
      };
    },
  };
}

export type AdminClient = ReturnType<typeof makeAdminClient>;

// ---------------------------------------------------------------------------
// CRON_SECRET auth check
// ---------------------------------------------------------------------------

export function authCheck(req: Request): Response | null {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return null; // no secret configured → open (dev only)
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dedupe: insert into notification_event_log
// Returns true  → event is new, caller should create the notification
// Returns false → duplicate, skip
// ---------------------------------------------------------------------------

export async function tryLogEvent(
  db: AdminClient,
  eventType: string,
  eventKey: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${db.url}/rest/v1/notification_event_log`,
      {
        method: "POST",
        headers: {
          ...db._headers(),
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify([{ event_type: eventType, event_key: eventKey, payload }]),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      // 409 or empty body with ignore-duplicates = already exists
      if (res.status === 409 || text === "[]" || text === "") return false;
      throw new Error(`event_log insert ${res.status}: ${text}`);
    }
    const data = await res.json();
    // ignore-duplicates returns [] when row already existed
    return Array.isArray(data) ? data.length > 0 : true;
  } catch (e) {
    // On error, be conservative — skip to avoid spam
    console.error("tryLogEvent error", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Insert a user_notification row (service role, no RLS check needed)
// ---------------------------------------------------------------------------

export interface NotificationRow {
  user_id: string;
  notification_type: "stance_change" | "weekly_digest" | "topic_follow";
  title: string;
  body?: string | null;
  href?: string | null;
  topic_id?: string | null;
  question_id?: string | null;
  digest_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function insertNotification(
  db: AdminClient,
  row: NotificationRow,
): Promise<void> {
  await db.insert("user_notifications", [
    {
      user_id: row.user_id,
      notification_type: row.notification_type,
      title: row.title,
      body: row.body ?? null,
      href: row.href ?? null,
      topic_id: row.topic_id ?? null,
      question_id: row.question_id ?? null,
      digest_id: row.digest_id ?? null,
      metadata: row.metadata ?? {},
    },
  ]);
}

// ---------------------------------------------------------------------------
// ISO week helpers (for dedupe keys)
// ---------------------------------------------------------------------------

/** Returns "YYYY-Www" — e.g. "2026-W13" */
export function isoWeek(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO week: Monday = day 1
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Returns Monday of the current ISO week as "YYYY-MM-DD" */
export function weekStart(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - (day - 1));
  return date.toISOString().slice(0, 10);
}

/** Returns Sunday of the current ISO week as "YYYY-MM-DD" */
export function weekEnd(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}
