import { describe, expect, it } from "vitest";
import { haversineKm } from "./geo.ts";

describe("haversineKm", () => {
  it("computes Gothenburg → Stockholm ≈ 398 km", () => {
    const km = haversineKm(57.7089, 11.9746, 59.3293, 18.0686);
    expect(km).toBeCloseTo(397, 0);
  });

  it("returns 0 for same point", () => {
    expect(haversineKm(57.7089, 11.9746, 57.7089, 11.9746)).toBe(0);
  });

  it("returns ~20 015 km for antipodal points", () => {
    const km = haversineKm(0, 0, 0, 180);
    expect(km).toBeCloseTo(20015, 0);
  });
});
