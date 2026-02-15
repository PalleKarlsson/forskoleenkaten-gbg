import { describe, expect, it } from "vitest";
import { schoolColor, buildSchoolColorMap } from "./colors.ts";

describe("schoolColor", () => {
  it("returns first palette color for index 0", () => {
    expect(schoolColor(0)).toBe("#58a6ff");
  });

  it("wraps around after palette length", () => {
    expect(schoolColor(10)).toBe("#58a6ff");
  });
});

describe("buildSchoolColorMap", () => {
  it("builds a map with correct size and colors", () => {
    const map = buildSchoolColorMap([1, 2, 3]);
    expect(map.size).toBe(3);
    expect(map.get(1)).toBe("#58a6ff");
    expect(map.get(2)).toBe("#f0883e");
    expect(map.get(3)).toBe("#3fb950");
  });
});
