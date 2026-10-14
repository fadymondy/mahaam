// Plan refusals from the API (internal/limits): 402 with code plan_limit / plan_feature /
// plan_read_only (quota_exceeded on the feedback and monitor intakes). The server's message names
// the plan and ends "upgrade in Settings → Plan"; plans are managed on the web, so the app never
// shows that sentence (App Store 3.1.1) and says, in the person's language, who can act instead.
const PLAN_CODES = new Set(["plan_limit", "plan_feature", "plan_read_only", "quota_exceeded"]);

/** A refusal because of the workspace's plan. A per-minute plan rate (429 plan_rate) is not one. */
export function isPlanRefusal(status: number, code?: string): boolean {
  return status === 402 || (!!code && PLAN_CODES.has(code));
}
