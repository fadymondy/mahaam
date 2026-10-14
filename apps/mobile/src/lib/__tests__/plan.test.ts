// Plan refusals never reach the screen with the server's "upgrade in Settings → Plan" (lib/plan.ts).
import { isPlanRefusal } from "../plan";
import { strings } from "@/i18n/strings";

describe("plan refusals", () => {
  it("are recognised by status 402 or a plan code", () => {
    expect(isPlanRefusal(402)).toBe(true);
    expect(isPlanRefusal(402, "plan_feature")).toBe(true);
    expect(isPlanRefusal(403, "plan_limit")).toBe(true);
    expect(isPlanRefusal(402, "plan_read_only")).toBe(true);
  });

  it("leave other refusals alone, including the per-minute plan rate", () => {
    expect(isPlanRefusal(429, "plan_rate")).toBe(false);
    expect(isPlanRefusal(403)).toBe(false);
    expect(isPlanRefusal(422, "invalid_code")).toBe(false);
  });

  it("have a neutral message in both languages, with no upgrade or pricing wording", () => {
    for (const locale of ["en", "ar"] as const) {
      const s = strings[locale]["common.planLimit"];
      expect(s).toBeTruthy();
      expect(s).not.toMatch(/upgrade|plan →|settings|price|pricing|subscribe|ترقية|سعر|اشتراك/i);
    }
  });
});
