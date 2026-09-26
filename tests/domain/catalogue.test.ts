import { describe, expect, it } from "vitest";

import { AISLES, CATALOGUE, PRODUCT_PICTURES, catalogueNamed, catalogueProduct, nearMiss, withCatalogue } from "../../src/domain/catalogue";
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
});
