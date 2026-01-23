/**
 * Client-side rate limiter for requests sent to the Go backend.
 * Enforces a maximum of `MAX_REQUESTS_PER_WINDOW` requests per 5 minutes
 * and ensures each data type is only fetched every 10 minutes.
 */

const STORAGE_KEY = 'backend_request_limiter_state';
const MAX_REQUESTS_PER_WINDOW = 4;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const TYPE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export type BackendDataType = 'attendance' | 'marks' | 'calendar' | 'timetable' | 'unified' | 'login';

interface RequestLogEntry {
  timestamp: number;
  types: BackendDataType[];
}

interface LimiterState {
  log: RequestLogEntry[];
  lastRequestByType: Partial<Record<BackendDataType, number>>;
}

let cachedState: LimiterState | null = null;

const isClient = typeof window !== 'undefined';

class RateLimitError extends Error {
  public readonly reason: string;
  public readonly type: 'global_limit' | 'type_cooldown';
  public readonly blockedType?: BackendDataType;

  constructor(reason: string, type: 'global_limit' | 'type_cooldown', blockedType?: BackendDataType) {
    super(reason);
    this.name = 'RateLimitError';
    this.reason = reason;
    this.type = type;
    this.blockedType = blockedType;
  }
}

function readState(): LimiterState {
  if (cachedState) {
    return cachedState;
  }

  if (!isClient) {
    cachedState = { log: [], lastRequestByType: {} };
    return cachedState;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as LimiterState;
      cachedState = {
        log: Array.isArray(parsed.log) ? parsed.log : [],
        lastRequestByType: typeof parsed.lastRequestByType === 'object' && parsed.lastRequestByType
          ? parsed.lastRequestByType
          : {},
      };
      cleanupState(cachedState);
      return cachedState;
    }
  } catch (error) {
    console.warn('[BackendLimiter] Failed to read limiter state from storage', error);
  }

  cachedState = { log: [], lastRequestByType: {} };
  return cachedState;
}

function persistState(state: LimiterState) {
  if (!isClient) {
    return;
  }

  cleanupState(state);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[BackendLimiter] Failed to persist limiter state', error);
  }
}

function cleanupState(state: LimiterState) {
  const now = Date.now();
  state.log = state.log.filter(entry => now - entry.timestamp <= WINDOW_MS);

  Object.keys(state.lastRequestByType).forEach((type) => {
    const timestamp = state.lastRequestByType[type as BackendDataType];
    if (timestamp && now - timestamp > TYPE_COOLDOWN_MS * 2) {
      delete state.lastRequestByType[type as BackendDataType];
    }
  });
}

export type RateLimitCheckResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
      type: 'global_limit' | 'type_cooldown';
      blockedType?: BackendDataType;
    };

export function canMakeRequest(
  types: BackendDataType[] = [],
  enforceTypeCooldown = true
): RateLimitCheckResult {
  const state = readState();
  const now = Date.now();

  cleanupState(state);

  if (state.log.length >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      reason: `Too many backend requests. Wait a few minutes before trying again.`,
      type: 'global_limit',
    };
  }

  if (enforceTypeCooldown) {
    for (const type of types) {
      const lastRequest = state.lastRequestByType[type];
      if (lastRequest && now - lastRequest < TYPE_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((TYPE_COOLDOWN_MS - (now - lastRequest)) / 1000);
        return {
          allowed: false,
          reason: `Please wait ${waitSeconds} seconds before fetching ${type} again.`,
          type: 'type_cooldown',
          blockedType: type,
        };
      }
    }
  }

  return { allowed: true };
}

export function recordRequest(types: BackendDataType[] = []) {
  const state = readState();
  const now = Date.now();

  cleanupState(state);

  state.log.push({ timestamp: now, types });
  types.forEach(type => {
    state.lastRequestByType[type] = now;
  });

  persistState(state);
}

export { RateLimitError };

