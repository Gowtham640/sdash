/**
 * ODML Storage Utility
 * Helper functions for managing ODML records
 */

import { trackPostRequest } from "@/lib/postAnalytics";

export interface OdmlRecord {
  id: string;
  user_id: string;
  period_from: string; // ISO date string
  period_to: string; // ISO date string
  subject_hours: Record<string, number>; // { "MA101": 4, "CS101": 2, ... }
  created_at?: string;
  updated_at?: string;
}

export interface LeavePeriod {
  from: Date;
  to: Date;
  id: string;
}

/** Local calendar date as YYYY-MM-DD (avoids UTC shift from toISOString()). */
export function formatLocalDateYyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight (avoids Date('YYYY-MM-DD') UTC interpretation). */
export function parseLocalYyyyMmDd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) {
    return new Date(s);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Fetch all ODML records for the current user
 */
export async function fetchOdmlRecords(access_token: string): Promise<OdmlRecord[]> {
  try {
    const response = await fetch('/api/odml', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[ODML Storage] Error fetching ODML records:', result.error);
      return [];
    }

    return result.data || [];
  } catch (error) {
    console.error('[ODML Storage] Exception fetching ODML records:', error);
    return [];
  }
}

/**
 * Save ODML record
 */
export async function saveOdmlRecord(
  access_token: string,
  period_from: Date,
  period_to: Date,
  subject_hours: Record<string, number>
): Promise<OdmlRecord | null> {
  try {
    const response = await trackPostRequest('/api/odml', {
      action: 'odml_save',
      dataType: 'user',
      payload: {
        period_from: formatLocalDateYyyyMmDd(period_from),
        period_to: formatLocalDateYyyyMmDd(period_to),
        subject_hours
      },
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
      omitPayloadKeys: [],
      payloadSummary: {
        subject_hours: Object.keys(subject_hours).length,
      },
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[ODML Storage] Error saving ODML record:', result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.error('[ODML Storage] Exception saving ODML record:', error);
    return null;
  }
}

/**
 * Delete ODML record
 */
export async function deleteOdmlRecord(access_token: string, recordId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/odml?id=${recordId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (!result.success) {
      console.error('[ODML Storage] Error deleting ODML record:', result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[ODML Storage] Exception deleting ODML record:', error);
    return false;
  }
}

/**
 * Convert ODML records to aggregated subject hours
 * Sums hours across all periods for each subject
 */
export function aggregateOdmlHours(records: OdmlRecord[]): Record<string, number> {
  const aggregated: Record<string, number> = {};

  records.forEach(record => {
    Object.entries(record.subject_hours).forEach(([subjectCode, hours]) => {
      aggregated[subjectCode] = (aggregated[subjectCode] || 0) + hours;
    });
  });

  return aggregated;
}

/**
 * Convert ODML records to LeavePeriod format for calculation
 */
export function odmlRecordsToLeavePeriods(records: OdmlRecord[]): LeavePeriod[] {
  return records.map((record) => ({
    from: parseLocalYyyyMmDd(record.period_from),
    to: parseLocalYyyyMmDd(record.period_to),
    id: record.id,
  }));
}



