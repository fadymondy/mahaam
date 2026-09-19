import { act, renderHook } from "@testing-library/react-native";

import { translate } from "@/i18n";
import { useNow } from "../use-now";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

describe("useNow", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("ticks while active and stops when inactive", async () => {
    jest.setSystemTime(new Date("2026-09-18T10:00:00Z"));
    const { result, rerender } = await renderHook(({ active }: { active: boolean }) => useNow(1000, active), { initialProps: { active: true } });
    const t0 = result.current;
    await act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current - t0).toBe(3000);

    await rerender({ active: false });
    const frozen = result.current;
    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(frozen);
  });
});

describe("translate", () => {
  it("interpolates and falls back to English", () => {
    expect(translate("en", "timer.startedAt", { time: "09:00" })).toBe("Started 09:00");
    expect(translate("ar", "tabs.today")).toBe("اليوم");
    expect(translate("ar", "no.such.key")).toBe("no.such.key");
  });
});
