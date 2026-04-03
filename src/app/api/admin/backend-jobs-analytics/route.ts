import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JobRow = {
  id: string;
  user_id: string | null;
  job_type: string | null;
  data_type: string | null;
  status: string | null;
  job_source: string | null;
  failure_reason: string | null;
  failure_tokens: string | null;
  duration: number | null;
  created_at: string;
};

function startDateFromRange(timeRange: string): Date | null {
  if (timeRange === "all") return null;
  const startDate = new Date();
  if (timeRange === "1h") startDate.setHours(startDate.getHours() - 1);
  else if (timeRange === "24h") startDate.setHours(startDate.getHours() - 24);
  else if (timeRange === "48h") startDate.setHours(startDate.getHours() - 48);
  else if (timeRange === "7d") startDate.setDate(startDate.getDate() - 7);
  else if (timeRange === "30d") startDate.setDate(startDate.getDate() - 30);
  else if (timeRange === "180d") startDate.setDate(startDate.getDate() - 180);
  else if (timeRange === "365d") startDate.setDate(startDate.getDate() - 365);
  else startDate.setDate(startDate.getDate() - 30);
  return startDate;
}

async function fetchAllJobsInRange(startDate: Date | null): Promise<JobRow[]> {
  const pageSize = 1000;
  const out: JobRow[] = [];
  let offset = 0;
  for (;;) {
    let q = supabaseAdmin
      .from("jobs")
      .select(
        "id, user_id, job_type, data_type, status, job_source, failure_reason, failure_tokens, duration, created_at"
      )
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (startDate) {
      q = q.gte("created_at", startDate.toISOString());
    }

    const { data, error } = await q;
    if (error) {
      console.error("[backend-jobs-analytics] jobs query error:", error);
      throw error;
    }
    const batch = (data || []) as JobRow[];
    out.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function normalizeSource(src: string | null): "internal" | "external" {
  if (src === "external") return "external";
  return "internal";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get("timeRange") || "30d";
    const startDate = startDateFromRange(timeRange);

    const jobs = await fetchAllJobsInRange(startDate);

    let internalCount = 0;
    let externalCount = 0;
    for (const j of jobs) {
      if (normalizeSource(j.job_source) === "external") externalCount++;
      else internalCount++;
    }

    const durationByType = new Map<string, { sum: number; n: number }>();
    for (const j of jobs) {
      if (j.duration == null || j.duration < 0) continue;
      if (j.status !== "done" && j.status !== "failed") continue;
      const dt = j.data_type || "unknown";
      const cur = durationByType.get(dt) || { sum: 0, n: 0 };
      cur.sum += j.duration;
      cur.n += 1;
      durationByType.set(dt, cur);
    }
    const avgDurationByDataType = Array.from(durationByType.entries()).map(
      ([data_type, { sum, n }]) => ({
        data_type,
        avg_ms: n > 0 ? Math.round(sum / n) : 0,
        count: n,
      })
    );
    avgDurationByDataType.sort((a, b) => a.data_type.localeCompare(b.data_type));

    let failureTotal = 0;
    const failuresByDataType = new Map<string, number>();
    for (const j of jobs) {
      if (j.status !== "failed") continue;
      failureTotal++;
      const dt = j.data_type || "unknown";
      failuresByDataType.set(dt, (failuresByDataType.get(dt) || 0) + 1);
    }
    const failuresByDataTypeArr = Array.from(failuresByDataType.entries()).map(
      ([data_type, count]) => ({ data_type, count })
    );
    failuresByDataTypeArr.sort((a, b) => b.count - a.count);

    const failureReasonCounts = new Map<string, number>();
    for (const j of jobs) {
      if (j.status !== "failed") continue;
      const reason = (j.failure_reason || "").trim() || "(empty)";
      failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
    }
    const failureReasons = Array.from(failureReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);

    const missingTokenCounts = new Map<string, number>();
    for (const j of jobs) {
      if (j.status !== "failed" || !j.failure_tokens) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(j.failure_tokens);
      } catch {
        missingTokenCounts.set("(invalid JSON)", (missingTokenCounts.get("(invalid JSON)") || 0) + 1);
        continue;
      }
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          missingTokenCounts.set("(none listed)", (missingTokenCounts.get("(none listed)") || 0) + 1);
        } else {
          for (const item of parsed) {
            const key = typeof item === "string" ? item : JSON.stringify(item);
            missingTokenCounts.set(key, (missingTokenCounts.get(key) || 0) + 1);
          }
        }
      } else {
        missingTokenCounts.set("(not an array)", (missingTokenCounts.get("(not an array)") || 0) + 1);
      }
    }
    const missingTokensTop = Array.from(missingTokenCounts.entries())
      .map(([token_label, count]) => ({ token_label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    const jobsPerUserId = new Map<string, number>();
    for (const j of jobs) {
      if (!j.user_id) continue;
      jobsPerUserId.set(j.user_id, (jobsPerUserId.get(j.user_id) || 0) + 1);
    }

    const userIds = [...jobsPerUserId.keys()];
    const emailByUserId = new Map<string, string>();
    const chunk = 200;
    for (let i = 0; i < userIds.length; i += chunk) {
      const slice = userIds.slice(i, i + chunk);
      const { data: users, error: uerr } = await supabaseAdmin
        .from("users")
        .select("id, email")
        .in("id", slice);
      if (uerr) {
        console.error("[backend-jobs-analytics] users batch error:", uerr);
      } else {
        for (const u of users || []) {
          if (u.id && u.email) emailByUserId.set(u.id, u.email as string);
        }
      }
    }

    const jobsPerUser = Array.from(jobsPerUserId.entries())
      .map(([user_id, count]) => ({
        user_id,
        email: emailByUserId.get(user_id) || user_id.slice(0, 8) + "…",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    let internalLoginTriggers = 0;
    for (const j of jobs) {
      if (j.job_type === "login" && j.data_type === "auth" && normalizeSource(j.job_source) === "internal") {
        internalLoginTriggers++;
      }
    }

    const trafficByDay = new Map<string, number>();
    const trafficByDayAndType = new Map<string, Map<string, number>>();
    for (const j of jobs) {
      const day = dayKey(j.created_at);
      trafficByDay.set(day, (trafficByDay.get(day) || 0) + 1);
      const dt = j.data_type || "unknown";
      if (!trafficByDayAndType.has(day)) trafficByDayAndType.set(day, new Map());
      const m = trafficByDayAndType.get(day)!;
      m.set(dt, (m.get(dt) || 0) + 1);
    }
    const trafficOverall = [...trafficByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const allDataTypes = new Set<string>();
    for (const j of jobs) {
      allDataTypes.add(j.data_type || "unknown");
    }
    const typesSorted = [...allDataTypes].sort();

    const trafficByDataTypeSeries: { date: string; [key: string]: string | number }[] = [];
    for (const { date, count } of trafficOverall) {
      const row: { date: string; [key: string]: string | number } = { date, total: count };
      const byT = trafficByDayAndType.get(date);
      for (const t of typesSorted) {
        row[t] = byT?.get(t) || 0;
      }
      trafficByDataTypeSeries.push(row);
    }

    const failedByUser = new Map<string, number>();
    const totalByUser = new Map<string, number>();
    for (const j of jobs) {
      if (!j.user_id) continue;
      totalByUser.set(j.user_id, (totalByUser.get(j.user_id) || 0) + 1);
      if (j.status === "failed") {
        failedByUser.set(j.user_id, (failedByUser.get(j.user_id) || 0) + 1);
      }
    }
    const failureRateByUser = [...totalByUser.entries()]
      .map(([user_id, total]) => {
        const failed = failedByUser.get(user_id) || 0;
        return {
          user_id,
          email: emailByUserId.get(user_id) || user_id.slice(0, 8) + "…",
          total,
          failed,
          rate_pct: total > 0 ? Math.round((1000 * failed) / total) / 10 : 0,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.rate_pct - a.rate_pct)
      .slice(0, 40);

    const terminalWithDuration = jobs.filter(
      (j) => (j.status === "done" || j.status === "failed") && j.duration != null
    ).length;

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_jobs: jobs.length,
          internal_jobs: internalCount,
          external_jobs: externalCount,
          failures_total: failureTotal,
          internal_login_triggers: internalLoginTriggers,
          jobs_with_duration_sample: terminalWithDuration,
        },
        avgDurationByDataType,
        failuresByDataType: failuresByDataTypeArr,
        failureReasons,
        missingTokensWhenFailed: missingTokensTop,
        jobsPerUser,
        trafficOverall,
        trafficByDataTypeSeries,
        dataTypesInRange: typesSorted,
        failureRateByUser,
      },
    });
  } catch (e) {
    console.error("[backend-jobs-analytics] Error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load job analytics",
      },
      { status: 500 }
    );
  }
}
