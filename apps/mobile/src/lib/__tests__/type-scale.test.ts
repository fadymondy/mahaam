import { type } from "@/grid";
import { fs, GRID_TYPE, MIN_TEXT, MIN_UPPERCASE, READABLE_TYPE, textFloor } from "../type-scale";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

describe("readable type scale", () => {
  it("replaces the grid's scale at import (English under jest)", () => {
    expect({ ...type }).toEqual(READABLE_TYPE.en);
    expect(GRID_TYPE.micro).toBe(10.5);
  });

  it.each(["en", "ar"] as const)("meets the rule in %s", (script) => {
    const s = READABLE_TYPE[script];
    expect(s.micro).toBeGreaterThanOrEqual(MIN_UPPERCASE);
    for (const k of ["microAr", "tab", "meta", "body", "rowTitle", "title", "bigHeader"] as const) expect(s[k]).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(s.meta).toBeGreaterThanOrEqual(13);
    expect(s.body).toBeGreaterThanOrEqual(15);
    expect(s.rowTitle).toBeGreaterThanOrEqual(15);
  });

  it("never shrinks a grid size, and Arabic is never smaller than Latin", () => {
    for (const k of Object.keys(GRID_TYPE) as (keyof typeof GRID_TYPE)[]) {
      expect(READABLE_TYPE.en[k]).toBeGreaterThanOrEqual(GRID_TYPE[k]);
      expect(READABLE_TYPE.ar[k]).toBeGreaterThanOrEqual(READABLE_TYPE.en[k]);
    }
  });

  it("keeps the app's own sizes readable", () => {
    for (const v of Object.values(fs)) expect(v).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});

describe("textFloor", () => {
  it("leaves readable and unsized text alone", () => {
    expect(textFloor(undefined)).toBeNull();
    expect(textFloor({ color: "red" })).toBeNull();
    expect(textFloor({ fontSize: 12 })).toBeNull();
    expect(textFloor({ fontSize: 11.5, textTransform: "uppercase" })).toBeNull();
  });
  it("raises small text to 12, uppercase labels to 11.5", () => {
    expect(textFloor({ fontSize: 10.5 })).toEqual({ fontSize: 12 });
    expect(textFloor([{ fontSize: 11 }, { letterSpacing: 1 }])).toEqual({ fontSize: 12 });
    expect(textFloor({ fontSize: 10.5, textTransform: "uppercase" })).toEqual({ fontSize: 11.5 });
  });
  it("lifts Lusail one point further in the Arabic UI, but not mono", () => {
    expect(textFloor({ fontSize: 12 }, true)).toEqual({ fontSize: 13 });
    expect(textFloor({ fontSize: 12, fontFamily: "JetBrainsMono_400Regular" }, true)).toBeNull();
    expect(textFloor({ fontSize: 11, fontFamily: "JetBrainsMono_400Regular" }, true)).toEqual({ fontSize: 12 });
    expect(textFloor({ fontSize: 12 }, false)).toBeNull();
  });
  it("grows a line height that would clip the new size", () => {
    expect(textFloor({ fontSize: 10, lineHeight: 12 })).toEqual({ fontSize: 12, lineHeight: 14 });
    expect(textFloor({ fontSize: 11, lineHeight: 20 })).toEqual({ fontSize: 12 });
  });
});
