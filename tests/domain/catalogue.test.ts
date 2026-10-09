import { describe, expect, it } from "vitest";

import { AISLES, CATALOGUE, aisleShares, PRODUCT_PICTURES, catalogueNamed, catalogueProduct, knowsProduct, listSections, nearMiss, searchCatalogue, withCatalogue } from "../../src/domain/catalogue";
import { foldName, parseEntry, suggestProducts, typedProduct } from "../../src/domain/items";

describe("the catalogue", () => {
  it("holds several hundred products, one per spelling, across every aisle", () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(300);
    expect(new Set(CATALOGUE.map((product) => product.key)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((product) => product.aisle))).toEqual(new Set(AISLES));
  });

  it("keys each product by its folded name, and draws each with a picture it has", () => {
    for (const product of CATALOGUE) {
      expect(product.key).toBe(foldName(product.name));
      expect(PRODUCT_PICTURES).toContain(product.picture);
    }
    expect(new Set(CATALOGUE.map((product) => product.picture))).toEqual(new Set(PRODUCT_PICTURES));
  });

  it("names each product as the quick-add field would read it back", () => {
    for (const product of CATALOGUE) expect(parseEntry(product.name)).toEqual([{ name: product.name, quantityMilli: null, unit: null }]);
  });

  it("finds a product however its name was typed, and only by its whole name", () => {
    expect(catalogueProduct("SUT")?.name).toBe("Süt");
    expect(catalogueProduct("  domates ")).toMatchObject({ aisle: "produce", picture: "tomato" });
    expect(catalogueProduct("Domates salatası")).toBeUndefined();
    expect(catalogueProduct("Domatesss")).toBeUndefined();
  });

  it("offers what the household never had, after what it did, and never twice", () => {
    const known = [{ key: "sut", name: "Süt", times: 4 }];
    const merged = withCatalogue(known);
    expect(merged[0]).toBe(known[0]);
    expect(merged.filter((product) => product.key === "sut")).toHaveLength(1);
    expect(merged.find((product) => product.key === "sucuk")).toEqual({ key: "sucuk", name: "Sucuk", times: 0 });
  });

  it("answers `sut` and a slip of one letter from the catalogue alone", () => {
    const names = (text: string) => suggestProducts(withCatalogue([]), typedProduct(text)!, []).map((product) => product.name);
    expect(names("sut")[0]).toBe("Süt");
    expect(names("domtes")).toContain("Domates");
    expect(names("peynr")).toContain("Beyaz peynir");
  });

  it("knows a product by the catalogue or by the rows given, however typed", () => {
    const knows = knowsProduct([{ name: "Yarım yağlı süt" }]);
    expect(["yarim yagli sut", "süt", "Domates"].map(knows)).toEqual([true, true, true]);
    expect(knows("yağlı süt")).toBe(false);
  });

  describe("searchCatalogue", () => {
    const names = (text: string, known: { name: string; times: number }[] = []) => searchCatalogue(known, text).map((product) => product.name);

    it("shows every match, not the five a suggestion row holds", () => {
      const known = ["Elma a", "Elma b", "Elma c", "Elma d", "Elma e", "Elma f", "Elma g"].map((name) => ({ name, times: 1 }));
      expect(names("elma", known).length).toBeGreaterThan(5);
    });

    it("folds Turkish case and marks, ı and i alike", () => {
      expect(names("sut")[0]).toBe("Süt");
      expect(names("SÜT")[0]).toBe("Süt");
      expect(names("kirmizi")).toEqual(["Kırmızı mercimek"]);
      expect(names("ıslak")[0]).toBe("Islak mendil");
      expect(names("INCIR")[0]).toBe("İncir");
    });

    it("finds a later word's start, after the names that begin with it", () => {
      expect(names("peynir")).toContain("Beyaz peynir");
      expect(names("cikolata")[0]).toBe("Çikolata");
      expect(names("cikolata")).toContain("Bitter çikolata");
      expect(names("su").slice(0, 2)).toEqual(["Süt", "Süzme yoğurt"]);
    });

    it("forgives one slip once four letters are typed, and not before", () => {
      expect(names("domtes")[0]).toBe("Domates");
      expect(names("domtes")).toContain("Cherry domates");
      expect(names("peynr")).toContain("Beyaz peynir");
      expect(names("sit")).toEqual([]);
    });

    it("ranks the household's products by how often they were had, its own beside the catalogue's, each once", () => {
      const known = [{ name: "Ezine peyniri", times: 3 }, { name: "Krem peynir", times: 1 }, { name: "ezine peyniri", times: 0 }];
      expect(names("peynir", known).slice(0, 2)).toEqual(["Ezine peyniri", "Krem peynir"]);
      expect(names("peynir", known).filter((name) => name === "Krem peynir")).toHaveLength(1);
      expect(names("ezine", known)).toEqual(["Ezine peyniri"]);
    });

    it("searches every aisle at once", () => {
      const aisles = new Set(searchCatalogue([], "kuru").map((product) => catalogueProduct(product.name)?.aisle));
      expect(aisles.size).toBeGreaterThan(1);
    });

    it("finds nothing while nothing is typed", () => {
      expect(searchCatalogue([], "")).toEqual([]);
      expect(searchCatalogue([{ name: "Süt", times: 2 }], "   ")).toEqual([]);
    });
  });

  it("names an entry as the catalogue writes it when only case or marks differ", () => {
    const entry = { name: "Sut", quantityMilli: 1000, unit: "lt" as const };
    expect(catalogueNamed(entry)).toEqual({ ...entry, name: "Süt" });
    const own = { name: "Ezine peyniri", quantityMilli: null, unit: null };
    expect(catalogueNamed(own)).toBe(own);
  });

  it("asks about a near miss: letters held down, or one slipped, once four are typed", () => {
    expect(nearMiss("Domatesss", [])?.name).toBe("Domates");
    expect(nearMiss("Domtes", [])?.name).toBe("Domates");
    expect(nearMiss("Mandalinaa", [])?.name).toBe("Mandalina");
  });

  it("never asks about a product it knows, one the household made, or too few letters", () => {
    expect(nearMiss("domates", [])).toBeNull();
    expect(nearMiss("Domtes", [{ key: "domtes", name: "Domtes", times: 1 }])).toBeNull();
    expect(nearMiss("Stu", [])).toBeNull();
    expect(nearMiss("Ezine peyniri", [])).toBeNull();
  });

  describe("listSections", () => {
    const item = (name: string, urgent = false, notFound = false) => ({ name, urgent, notFound });
    const shape = (open: ReturnType<typeof item>[]) => listSections(open).map(({ key, aisle, items }) => [key, aisle ?? null, items.map((each) => each.name)]);

    it("puts a product where its person moved it, over the catalogue and over Diğer (5.4)", () => {
      const moved = new Map([["sut", "drinks" as const], ["ezine peyniri", "dairy" as const]]);
      expect(listSections([item("Süt"), item("Ezine peyniri"), item("Domates")], moved).map(({ key, items }) => [key, items.map((each) => each.name)])).toEqual([
        ["produce", ["Domates"]],
        ["dairy", ["Ezine peyniri"]],
        ["drinks", ["Süt"]],
      ]);
    });

    it("groups what is plainly left in the order the market is walked, each aisle in the list's own order", () => {
      expect(shape([item("Süt"), item("Elma"), item("Ezine peyniri"), item("Domates"), item("Yoğurt"), item("Muz")])).toEqual([
        ["produce", "produce", ["Domates"]],
        ["fruit", "fruit", ["Elma", "Muz"]],
        ["dairy", "dairy", ["Süt", "Yoğurt"]],
        ["other", "other", ["Ezine peyniri"]],
      ]);
    });

    it("keeps the urgent above the aisles and the not found below, as the list stores them, and heads nothing in one aisle", () => {
      const open = [item("Ekmek", true), item("Süt"), item("Yoğurt"), item("Pil", true, true), item("Muz", false, true)];
      expect(shape(open)).toEqual([
        ["urgent", null, ["Ekmek"]],
        ["dairy", null, ["Süt", "Yoğurt"]],
        ["notFoundUrgent", null, ["Pil"]],
        ["notFound", null, ["Muz"]],
      ]);
      expect(listSections([])).toEqual([]);
    });
  });

  it("adds what each aisle cost, the dearest first, what the catalogue does not know as one", () => {
    const bought = [
      { name: "Süt", priceMinor: 4590 },
      { name: "Domates", priceMinor: 3000 },
      { name: "Yoğurt", priceMinor: 6000 },
      { name: "Ezine peyniri", priceMinor: 25000 },
      { name: "Salatalık", priceMinor: 1500 },
    ];
    expect(aisleShares(bought)).toEqual([
      { aisle: "other", spentMinor: 25000 },
      { aisle: "dairy", spentMinor: 10590 },
      { aisle: "produce", spentMinor: 4500 },
    ]);
    expect(aisleShares([{ name: "Muz", priceMinor: 100 }, { name: "Elma", priceMinor: 0 }, { name: "Domates", priceMinor: 100 }])).toEqual([
      { aisle: "produce", spentMinor: 100 },
      { aisle: "fruit", spentMinor: 100 },
    ]);
    expect(aisleShares([])).toEqual([]);
  });
});
