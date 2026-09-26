/** Calendar days (Helix's `dates.ts`, ported in part): local, zone-free, whole days. */

import { describe, expect, it } from "vitest";

import { addMonthsToKey, daysBetweenISO, isISODate, monthCells, monthKeyOf, todayISO } from "../../src/domain/dates";

describe("dates", () => {
  it("reads a real day and refuses one that is not", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-1-1")).toBe(false);
    expect(isISODate(null)).toBe(false);
  });

  it("takes today on the device's own calendar", () => {
    expect(todayISO(new Date(2026, 8, 26, 23, 59))).toBe("2026-09-26");
  });

  it("moves between months across a year", () => {
    expect(monthKeyOf("2026-09-26")).toBe("2026-09");
    expect(addMonthsToKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToKey("2026-01", -1)).toBe("2025-12");
  });

  it("lays a month out from Monday, blank before its first day", () => {
    const cells = monthCells("2026-09");
    // 1 September 2026 is a Tuesday.
    expect(cells.slice(0, 2)).toEqual([null, "2026-09-01"]);
    expect(cells.at(-1)).toBe("2026-09-30");
    expect(cells).toHaveLength(31);
  });

  it("counts whole days between two, whatever the clock's zone", () => {
    expect(daysBetweenISO("2026-09-26", "2026-10-01")).toBe(5);
    expect(daysBetweenISO("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetweenISO("2026-09-26", "2026-09-25")).toBe(-1);
  });
});
