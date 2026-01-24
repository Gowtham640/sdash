import { trackEvent } from "@/lib/analytics";

export type PostDataType =
    | "attendance"
    | "calendar"
    | "courses"
    | "marks"
    | "timetable"
    | "user"
    | "login"
    | "unknown";

export interface TrackPostRequestOptions {
    action: string;
    dataType?: PostDataType;
    payload?: Record<string, unknown> | string;
    headers?: HeadersInit;
    payloadSummary?: Record<string, unknown>;
    omitPayloadKeys?: string[];
    primary?: boolean;
}

const DEFAULT_REDACTED_FIELDS = new Set([
    "password",
    "pwd",
    "captcha",
    "cdigest",
    "access_token",
    "refresh_token",
    "token",
    "x-csrf-token",
]);

const REDACTED_PLACEHOLDER = "REDACTED";
const MAX_SAMPLE_KEYS = 5;

function sanitizePayload(
    payload: Record<string, unknown>,
    extraOmitKeys?: string[]
): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const omitKeys = new Set<string>([
        ...DEFAULT_REDACTED_FIELDS,
        ...(extraOmitKeys ?? []).map((key) => key.toLowerCase()),
    ]);

    Object.entries(payload).forEach(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        if (omitKeys.has(normalizedKey)) {
            sanitized[key] = REDACTED_PLACEHOLDER;
            return;
        }

        if (typeof value === "string") {
            sanitized[key] = value.length > 120 ? `${value.slice(0, 120)}...` : value;
        } else if (typeof value === "number" || typeof value === "boolean") {
            sanitized[key] = value;
        } else if (value === null || value === undefined) {
            sanitized[key] = value;
        } else if (Array.isArray(value)) {
            sanitized[key] = `[array length=${value.length}]`;
        } else {
            sanitized[key] = "[object]";
        }
    });

    return sanitized;
}

function buildPayloadMeta(
    sanitizedPayload?: Record<string, unknown>,
    override?: Record<string, unknown>
): Record<string, unknown> | undefined {
    if (override && Object.keys(override).length > 0) {
        return override;
    }

    if (!sanitizedPayload) {
        return undefined;
    }

    const keys = Object.keys(sanitizedPayload);
    if (keys.length === 0) {
        return undefined;
    }

    const sample: Record<string, unknown> = {};
    keys.slice(0, MAX_SAMPLE_KEYS).forEach((key) => {
        sample[key] = sanitizedPayload[key];
    });

    return {
        keys,
        sample,
    };
}

const generateRequestId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `post-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export async function trackPostRequest(
    url: string,
    params: TrackPostRequestOptions
): Promise<Response> {
    const {
        action,
        dataType,
        payload,
        headers,
        payloadSummary,
        omitPayloadKeys,
        primary,
    } = params;

    const requestId = generateRequestId();
    const startTime = Date.now();
    const bodyPayload =
        payload && typeof payload !== "string" ? payload : undefined;
    const sanitizedPayload = bodyPayload
        ? sanitizePayload(bodyPayload, omitPayloadKeys)
        : undefined;
    const payloadMeta = buildPayloadMeta(sanitizedPayload, payloadSummary);

    const baseEventData: Record<string, unknown> = {
        action,
        endpoint: url,
        data_type: dataType ?? "unknown",
        request_id: requestId,
        payload_meta: payloadMeta,
        primary_request: primary !== undefined ? primary : true,
    };

    trackEvent("post_request_start", baseEventData);

    const bodyString =
        typeof payload === "string"
            ? payload
            : bodyPayload
                ? JSON.stringify(bodyPayload)
                : undefined;

    const requestHeaders: HeadersInit = {
        "Content-Type": "application/json",
        ...(headers ?? {}),
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: requestHeaders,
            body: bodyString,
        });

        const duration = Date.now() - startTime;
        trackEvent("post_request_result", {
            ...baseEventData,
            success: response.ok,
            status_code: response.status,
            duration_ms: duration,
            error_reason: response.ok ? undefined : response.statusText,
            error_type: response.ok ? undefined : "http_error",
            primary_request: baseEventData.primary_request,
        });

        return response;
    } catch (error) {
        const duration = Date.now() - startTime;
        trackEvent("post_request_result", {
            ...baseEventData,
            success: false,
            duration_ms: duration,
            error_reason:
                error instanceof Error ? error.message : "network_error",
            error_type: error instanceof Error ? error.name : "unknown",
            primary_request: baseEventData.primary_request,
        });
        throw error;
    }
}
