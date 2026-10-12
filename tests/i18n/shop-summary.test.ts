import { describe, expect, it } from "vitest";

import { tr } from "../../src/i18n/tr";

const T0 = new Date("2026-09-24T10:00:00.000Z");

describe("a shop's summary", () => {
  it("shows a stamp it cannot read as it is instead of throwing", () => {
    expect(tr.history.summary("2026-09-24 10:00:00+00 bozuk", 2)).toBe("2026-09-24 10:00:00+00 bozuk · 2\u00a0ürün");
    expect(tr.history.summary(T0.toISOString(), 1)).toMatch(/2026.* · 1\u00a0ürün$/);
  });

  it("says what the shop cost when anything was priced, and nothing when not, which is not ₺0", () => {
    expect(tr.history.spent(5840)).toBe("₺58,40");
    expect(tr.history.spent(0)).toBe("₺0,00");
    expect(tr.history.spent(null)).toBeUndefined();
    expect(tr.items.basket(5840)).toBe("Sepette · ₺58,40");
    expect(tr.items.basket(null)).toBe("Sepette");
  });
});
