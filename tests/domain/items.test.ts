import { describe, expect, it } from "vitest";

import {
  LIST_TEXT_MAX,
  foldName,
  formatList,
  formatQuantity,
  parseEntry,
  parseList,
  pickEntries,
  stepQuantity,
  suggestProducts,
  typedProduct,
  type Entry,
  type ItemChange,
  type KnownProduct,
} from "../../src/domain/items";

describe("parseEntry", () => {
  it.each([
    ["2 kg domates", { name: "Domates", quantityMilli: 2000, unit: "kg" }],
    ["1,5 lt süt", { name: "Süt", quantityMilli: 1500, unit: "lt" }],
    ["1.5 lt süt", { name: "Süt", quantityMilli: 1500, unit: "lt" }],
    ["3 adet yumurta", { name: "Yumurta", quantityMilli: 3000, unit: "adet" }],
    ["3 tane yumurta", { name: "Yumurta", quantityMilli: 3000, unit: "adet" }],
    ["500gr kıyma", { name: "Kıyma", quantityMilli: 500_000, unit: "g" }],
    ["2 paket makarna", { name: "Makarna", quantityMilli: 2000, unit: "paket" }],
    ["250 ml krema", { name: "Krema", quantityMilli: 250_000, unit: "ml" }],
    ["6 yumurta", { name: "Yumurta", quantityMilli: 6000, unit: "adet" }],
  ])("reads the quantity before the name in %j", (text, item) => {
    expect(parseEntry(text)).toEqual([item]);
  });

  it.each([
    ["domates 2 kg", { name: "Domates", quantityMilli: 2000, unit: "kg" }],
    ["süt 2", { name: "Süt", quantityMilli: 2000, unit: "adet" }],
  ])("reads the quantity after the name in %j", (text, item) => {
    expect(parseEntry(text)).toEqual([item]);
  });

  it.each([
    ["İki kilo domates", { name: "Domates", quantityMilli: 2000, unit: "kg" }],
    ["yarım kilo peynir", { name: "Peynir", quantityMilli: 500, unit: "kg" }],
    ["bir ekmek", { name: "Ekmek", quantityMilli: 1000, unit: "adet" }],
    ["on yumurta", { name: "Yumurta", quantityMilli: 10_000, unit: "adet" }],
  ])("reads a number said as a word, as dictation writes it (%j)", (text, item) => {
    expect(parseEntry(text)).toEqual([item]);
  });

  it("keeps an entry without a quantity as a name alone, first letter raised the Turkish way", () => {
    expect(parseEntry("  ıspanak  ")).toEqual([{ name: "Ispanak", quantityMilli: null, unit: null }]);
    expect(parseEntry("irmik")).toEqual([{ name: "İrmik", quantityMilli: null, unit: null }]);
  });

  it("keeps the rest of the name as it was typed", () => {
    expect(parseEntry("2 Coca-Cola")).toEqual([{ name: "Coca-Cola", quantityMilli: 2000, unit: "adet" }]);
  });

  it("splits on commas, new lines, semicolons and the word 've', but not on a decimal comma", () => {
    expect(parseEntry("2 kg domates, 1,5 lt süt\nekmek; peynir ve zeytin,biber").map((item) => item.name)).toEqual([
      "Domates",
      "Süt",
      "Ekmek",
      "Peynir",
      "Zeytin",
      "Biber",
    ]);
  });

  it("turns a dictated sentence into items", () => {
    expect(parseEntry("İki kilo domates ve bir paket makarna ve süt")).toEqual([
      { name: "Domates", quantityMilli: 2000, unit: "kg" },
      { name: "Makarna", quantityMilli: 1000, unit: "paket" },
      { name: "Süt", quantityMilli: null, unit: null },
    ]);
  });

  it("drops what has no name: blanks, and a quantity alone", () => {
    expect(parseEntry(" , \n ve 3 adet, 2 kg")).toEqual([]);
  });

  it.each(["2limon", "2 limon", "3 gofret"])("reads a unit only as a word of its own (%j)", (text) => {
    expect(parseEntry(text)[0]?.unit).not.toBe("lt");
    expect(parseEntry(text)[0]?.unit).not.toBe("g");
  });

  it("does not take a number word from the start of a longer word", () => {
    expect(parseEntry("ikiz bebek bezi")).toEqual([{ name: "İkiz bebek bezi", quantityMilli: null, unit: null }]);
  });

  it.each(["0 süt", "10000 süt", "0,0001 kg un"])("leaves a quantity out of range in the name (%j)", (text) => {
    expect(parseEntry(text)[0]?.quantityMilli).toBeNull();
  });

  it("reads a dot before three digits as the Turkish thousands mark", () => {
    expect(parseEntry("1.000 gr un")).toEqual([{ name: "Un", quantityMilli: 1_000_000, unit: "g" }]);
    expect(parseEntry("1.25 kg peynir")[0]?.quantityMilli).toBe(1250);
  });

  it("reads 'bir de' as 'and also', not as one of something", () => {
    expect(parseEntry("ekmek ve bir de süt")).toEqual([
      { name: "Ekmek", quantityMilli: null, unit: null },
      { name: "Süt", quantityMilli: null, unit: null },
    ]);
    expect(parseEntry("Bir de peynir").map((item) => item.name)).toEqual(["Peynir"]);
    expect(parseEntry("ekmek bir de iki kilo domates")).toEqual([
      { name: "Ekmek", quantityMilli: null, unit: null },
      { name: "Domates", quantityMilli: 2000, unit: "kg" },
    ]);
  });

  it("gives a quantity said alone to the product after it, as a dictated pause writes it", () => {
    expect(parseEntry("2,5 kg, domates")).toEqual([{ name: "Domates", quantityMilli: 2500, unit: "kg" }]);
    expect(parseEntry("süt, iki kilo, domates").map((item) => [item.name, item.quantityMilli])).toEqual([
      ["Süt", null],
      ["Domates", 2000],
    ]);
  });

  it("rounds a quantity to thousandths", () => {
    expect(parseEntry("0,3333 kg biber")[0]?.quantityMilli).toBe(333);
  });
});

describe("foldName", () => {
  it("makes one key of the ways people type the same product", () => {
    expect(new Set(["Süt", "süt", "SÜT", "sut", "  süt "].map(foldName)).size).toBe(1);
    expect(foldName("Çiğ Şeker")).toBe(foldName("cig seker"));
    expect(foldName("IŞIK")).toBe(foldName("isik"));
    expect(foldName("İrmik")).toBe("irmik");
    expect(foldName("süt  tozu")).toBe(foldName("süt tozu"));
  });

  it("keeps different products apart", () => {
    expect(foldName("süt")).not.toBe(foldName("sütlaç"));
  });
});

describe("formatQuantity", () => {
  it.each([
    [2000, "kg", "2 kg"],
    [1500, "lt", "1,5 lt"],
    [500_000, "g", "500 g"],
    [3000, "adet", "3 adet"],
    [500, "adet", "0,5 adet"],
  ] as const)("writes %j %s as %j", (milli, unit, text) => {
    expect(formatQuantity({ quantityMilli: milli, unit })).toBe(text);
  });

  it("writes nothing for an item without a quantity", () => {
    expect(formatQuantity({ quantityMilli: null, unit: null })).toBe("");
  });
});

describe("formatList", () => {
  const item = (name: string, more: Partial<ItemChange> = {}) => ({
    name,
    quantityMilli: null,
    unit: null,
    note: null,
    urgent: false,
    ...more,
  });

  it("writes the name, then a line per item in the order given, quantity first", () => {
    expect(
      formatList("Market", [
        item("Ekmek", { urgent: true }),
        item("Domates", { quantityMilli: 2000, unit: "kg" }),
        item("Süt", { quantityMilli: 1500, unit: "lt", note: "Pınar olsun" }),
      ]),
    ).toBe("Market\n❗ Ekmek\n• 2 kg Domates\n• 1,5 lt Süt (Pınar olsun)");
  });
});

describe("parseList", () => {
  const item = (name: string, more: Partial<ItemChange> = {}) => ({
    name,
    quantityMilli: null,
    unit: null,
    note: null,
    urgent: false,
    ...more,
  });

  it("reads formatList's text back as the same items, notes and urgency", () => {
    const items = [
      item("Ekmek", { urgent: true }),
      item("Domates", { quantityMilli: 2000, unit: "kg" }),
      item("Süt", { quantityMilli: 1500, unit: "lt", note: "Pınar olsun, yoksa Sütaş" }),
      item("Peynir", { note: "Ezine (tam yağlı)" }),
      item("Tuz ve karabiber"),
      item("Yarım yağlı süt", { note: "iki tane" }),
      item("Pil 4", { urgent: true }),
      item("Kalem 2", { quantityMilli: 3000, unit: "paket" }),
    ];
    expect(parseList(formatList("Market", items))).toEqual(items);
  });

  it("takes only the bulleted lines of a list with bullets, whatever the bullet", () => {
    expect(parseList("Akşama şunları al:\n- 2 kilo domates\n* süt (tam yağlı)\n–  ekmek\n❗️ yumurta\n• \n\nteşekkürler")).toEqual([
      item("Domates", { quantityMilli: 2000, unit: "kg" }),
      item("Süt", { note: "tam yağlı" }),
      item("Ekmek"),
      item("Yumurta", { urgent: true }),
    ]);
  });

  it("reads a list without bullets as the quick-add field reads an entry", () => {
    expect(parseList("2 kg domates, süt\niki kilo un ve ekmek (taze)")).toEqual([
      item("Domates", { quantityMilli: 2000, unit: "kg" }),
      item("Süt"),
      item("Un", { quantityMilli: 2000, unit: "kg" }),
      item("Ekmek (taze)"),
    ]);
    expect(parseList("  \n ")).toEqual([]);
    expect(parseList("Market\n•\n-")).toEqual([]);
  });

  it("drops the line a paste cut at its limit ends in, rather than keep half a name", () => {
    const cut = `${"• süt\n".repeat(664)}• 2 kg domates salçası`.slice(0, LIST_TEXT_MAX);
    expect(cut.endsWith("• 2 kg domates s")).toBe(true);
    expect(parseList(cut).map((entry) => entry.name)).toEqual(Array(664).fill("Süt"));
  });
});

describe("stepQuantity", () => {
  it.each([
    [1000, "adet", 1, 2000],
    [2000, "paket", -1, 1000],
    [1500, "kg", 1, 2000],
    [1300, "kg", 1, 1500],
    [1300, "kg", -1, 1000],
    [250_000, "g", -1, 200_000],
    [250_000, "ml", 1, 300_000],
    [500, "adet", 1, 1000],
  ] as const)("steps %j %s by %j to %j", (milli, unit, direction, next) => {
    expect(stepQuantity({ quantityMilli: milli, unit }, direction)).toEqual({ quantityMilli: next, unit });
  });

  it("reads an item without a quantity as one, so + makes it two", () => {
    const none = { quantityMilli: null, unit: null };
    expect(stepQuantity(none, 1)).toEqual({ quantityMilli: 2000, unit: "adet" });
    expect(stepQuantity(none, -1)).toBeNull();
  });

  it("stops at one step and at the largest quantity", () => {
    expect(stepQuantity({ quantityMilli: 1000, unit: "adet" }, -1)).toBeNull();
    expect(stepQuantity({ quantityMilli: 500, unit: "kg" }, -1)).toBeNull();
    expect(stepQuantity({ quantityMilli: 50_000, unit: "g" }, -1)).toBeNull();
    expect(stepQuantity({ quantityMilli: 9_999_000, unit: "adet" }, 1)).toBeNull();
  });
});

describe("typedProduct", () => {
  it.each([
    ["sü", "su"],
    ["ekmek, 2 kg dom", "dom"],
    ["süt ve PEY", "pey"],
    ["İki kilo doma", "doma"],
    ["süt, bir de pe", "pe"],
    ["2 lim", "lim"],
    ["Beyaz pe", "beyaz pe"],
    ["bir", "bir"],
    ["0 dom", "0 dom"],
  ])("reads the product begun at the end of %j as %j", (text, key) => {
    expect(typedProduct(text)?.key).toBe(key);
  });

  it.each(["", "s", "süt, ", "süt, ı", "2"])("has nothing to suggest for %j", (text) => {
    expect(typedProduct(text)).toBeNull();
  });
});

describe("pickEntries", () => {
  const pick = (text: string, name: string) => pickEntries(typedProduct(text)!, name);

  it("keeps what was typed before and the quantity, and the product's name as it is", () => {
    expect(pick("ekmek, 2 lt tu", "Tuz ve karabiber")).toEqual([
      { name: "Ekmek", quantityMilli: null, unit: null },
      { name: "Tuz ve karabiber", quantityMilli: 2000, unit: "lt" },
    ]);
  });

  it("reads a number word that begins the product's name as its name", () => {
    expect(pick("yarım ya", "Yarım yağlı süt")).toEqual([{ name: "Yarım yağlı süt", quantityMilli: null, unit: null }]);
    expect(pick("süt, bir de yarım ya", "Yağ")).toEqual([
      { name: "Süt", quantityMilli: null, unit: null },
      { name: "Yağ", quantityMilli: 500, unit: "adet" },
    ]);
  });
});

describe("suggestProducts", () => {
  const known = (key: string, times: number): KnownProduct => ({ key, name: key, times });
  const keys = (products: KnownProduct[]) => products.map((product) => product.key);
  const listed = (name: string): Entry => ({ name, quantityMilli: null, unit: null });

  it("puts a name that begins with what is typed before one with a word that does, each by how often it was had", () => {
    const products = [known("beyaz peynir", 9), known("pekmez", 1), known("peynir", 3), known("biber", 5)];
    expect(keys(suggestProducts(products, typedProduct("pe")!, []))).toEqual(["peynir", "pekmez", "beyaz peynir"]);
  });

  it("keeps the order it was given for a tie, and matches no word in the middle", () => {
    const products = [known("sut", 2), known("sucuk", 2), known("tursu", 8)];
    expect(keys(suggestProducts(products, typedProduct("su")!, []))).toEqual(["sut", "sucuk"]);
  });

  it("puts first a product the quantity's words begin", () => {
    const products = [known("yag", 4), known("yarim yagli sut", 1)];
    expect(keys(suggestProducts(products, typedProduct("yarım ya")!, []))).toEqual(["yarim yagli sut", "yag"]);
  });

  it("leaves out what the list already holds, unless a quantity is typed for it, and stops at five", () => {
    const products = ["sua", "sub", "suc", "sud", "sue", "suf", "sug"].map((key) => known(key, 1));
    expect(keys(suggestProducts(products, typedProduct("su")!, [listed("Sua")]))).toEqual(["sub", "suc", "sud", "sue", "suf"]);
    expect(keys(suggestProducts([known("sut", 1)], typedProduct("3 su")!, [listed("Süt")]))).toEqual(["sut"]);
  });
});
