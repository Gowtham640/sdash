const HCAPTCHA_VERIFY_URL = "https://hcaptcha.com/siteverify";

export interface HCaptchaVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  score?: number;
  "error-codes"?: string[];
  credit?: boolean;
}

/**
 * Verifies an hCaptcha response token with the hCaptcha API.
 */
export async function verifyHCaptchaToken(
  token: string,
  remoteIp?: string
): Promise<HCaptchaVerifyResponse> {
  const secret = process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) {
    throw new Error("HCAPTCHA_SECRET_KEY is not configured");
  }

  const payload = new URLSearchParams();
  payload.append("secret", secret);
  payload.append("response", token);
  if (remoteIp) {
    payload.append("remoteip", remoteIp);
  }

  const response = await fetch(HCAPTCHA_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`hCaptcha verification request failed with status ${response.status}`);
  }

  return (await response.json()) as HCaptchaVerifyResponse;
}
