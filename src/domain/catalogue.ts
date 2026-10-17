/**
 * The built-in catalogue (`docs/SPEC.md` 2.12–2.15, 8.1): generic Turkish
 * products, each in the aisle a market shelves it in and with a Noto Emoji
 * picture of its own (`src/ui/product-pictures.ts`). A product is found by its
 * whole folded name and never guessed at: "Domates salatası" is not Domates.
 */

import { NO_QUANTITY, TYPO_FROM, foldName, knownFrom, nearly, suggestProducts, type KnownProduct } from "./items";

/** In the order a Turkish market is walked: fresh food at the door, the household at the back. */
export const AISLES = ["produce", "fruit", "bakery", "dairy", "meat", "fish", "staples", "frozen", "snacks", "drinks", "cleaning", "laundry", "paper", "care", "baby", "pet", "pharmacy", "home"] as const;
export type Aisle = (typeof AISLES)[number];

// Stryker disable all: a name table yields only static mutants, each a whole-suite run; its tests hold the entries.
export const PRODUCT_PICTURES = [
  "avocado", "baby-bottle", "bagel", "baguette", "banana", "bandage", "basket", "battery", "beans", "beer", "bell-pepper", "bird", "blueberries",
  "bone", "bowl", "bread", "broccoli", "broom", "bubbles", "bucket", "bulb", "burger", "butter", "cake", "candle", "candy", "canned", "carrot",
  "cat", "cheese", "cherries", "chestnut", "chocolate", "coconut", "coffee", "comb", "cookie", "corn", "crab", "croissant", "cucumber",
  "cup-straw", "cupcake", "custard", "dog", "doughnut", "droplet", "dumpling", "egg", "eggplant", "falafel", "fish", "flatbread", "foil",
  "fries", "garlic", "ginger", "gloves", "grapes", "green-apple", "herb", "honey", "hot-dog", "hot-pepper", "ice", "ice-cream", "jar", "juice",
  "kiwi", "leafy-green", "lemon", "lipstick", "lollipop", "lotion", "mango", "mask", "matches", "meat", "meat-bone", "melon", "milk", "mushroom",
  "noodles", "olive", "onion", "oyster", "pancakes", "paw", "pea-pod", "peach", "peanuts", "pear", "pie", "pill", "pineapple", "pizza", "plug",
  "popcorn", "potato", "potted-plant", "poultry", "pouring", "pretzel", "razor", "red-apple", "rice", "safety-pin", "salad", "salt", "sandwich",
  "scissors", "sheaf", "shrimp", "soap", "spaghetti", "sparkles", "sponge", "squid", "stew", "strawberry", "stuffed-flatbread", "sunflower",
  "sweet-potato", "tangerine", "tea", "teapot", "thermometer", "tissue", "toilet-paper", "tomato", "toothbrush", "tulip", "tumbler", "waffle",
  "wastebasket", "watermelon", "wine",
] as const;
export type ProductPicture = (typeof PRODUCT_PICTURES)[number];

export interface CatalogueProduct {
  /** `foldName` of the name, as a list's items and the household's products are keyed. */
  key: string;
  name: string;
  aisle: Aisle;
  picture: ProductPicture;
}

const SHELVES: Record<Aisle, readonly (readonly [name: string, picture: ProductPicture])[]> = {
  produce: [
    ["Domates", "tomato"], ["Salatalık", "cucumber"], ["Sivri biber", "hot-pepper"], ["Çarliston biber", "hot-pepper"],
    ["Dolmalık biber", "bell-pepper"], ["Kapya biber", "bell-pepper"], ["Patates", "potato"], ["Kuru soğan", "onion"], ["Taze soğan", "herb"],
    ["Sarımsak", "garlic"], ["Havuç", "carrot"], ["Patlıcan", "eggplant"], ["Kabak", "cucumber"], ["Marul", "leafy-green"],
    ["Kıvırcık", "leafy-green"], ["Roka", "leafy-green"], ["Ispanak", "leafy-green"], ["Lahana", "leafy-green"], ["Brokoli", "broccoli"],
    ["Karnabahar", "broccoli"], ["Mısır", "corn"], ["Mantar", "mushroom"], ["Bezelye", "pea-pod"], ["Taze fasulye", "pea-pod"], ["Bamya", "pea-pod"],
    ["Avokado", "avocado"], ["Limon", "lemon"], ["Maydanoz", "herb"], ["Dereotu", "herb"], ["Nane", "herb"], ["Fesleğen", "herb"], ["Tere", "herb"],
    ["Semizotu", "herb"], ["Pırasa", "herb"], ["Kereviz", "herb"], ["Turp", "carrot"], ["Pancar", "sweet-potato"], ["Tatlı patates", "sweet-potato"],
    ["Zencefil", "ginger"], ["Enginar", "leafy-green"], ["Salata", "salad"], ["Cherry domates", "tomato"],
    ["Biber", "hot-pepper"], ["Kırmızı biber", "bell-pepper"], ["Soğan", "onion"], ["Sebze", "broccoli"], ["Yeşillik", "herb"], ["Misket limonu", "lemon"], ["Mor lahana", "leafy-green"], ["Kuşkonmaz", "herb"], ["Bal kabağı", "sweet-potato"], ["Börülce", "pea-pod"], ["Fasulye", "pea-pod"],
  ],
  fruit: [
    ["Elma", "red-apple"], ["Yeşil elma", "green-apple"], ["Armut", "pear"], ["Portakal", "tangerine"], ["Mandalina", "tangerine"],
    ["Greyfurt", "tangerine"], ["Muz", "banana"], ["Karpuz", "watermelon"], ["Kavun", "melon"], ["Üzüm", "grapes"], ["Çilek", "strawberry"],
    ["Kiraz", "cherries"], ["Vişne", "cherries"], ["Şeftali", "peach"], ["Kayısı", "peach"], ["Erik", "grapes"], ["Nar", "red-apple"],
    ["Ayva", "pear"], ["İncir", "grapes"], ["Mango", "mango"], ["Ananas", "pineapple"], ["Kivi", "kiwi"], ["Hindistan cevizi", "coconut"],
    ["Yaban mersini", "blueberries"], ["Böğürtlen", "blueberries"], ["Ahududu", "strawberry"], ["Hurma", "chestnut"],
    ["Meyve", "red-apple"], ["Dut", "blueberries"], ["Trabzon hurması", "tangerine"], ["Yenidünya", "peach"], ["Nektarin", "peach"], ["Ejder meyvesi", "kiwi"],
  ],
  bakery: [
    ["Ekmek", "bread"], ["Tam buğday ekmeği", "bread"], ["Çavdar ekmeği", "bread"], ["Tost ekmeği", "bread"], ["Baget", "baguette"],
    ["Simit", "bagel"], ["Poğaça", "croissant"], ["Açma", "croissant"], ["Kruvasan", "croissant"], ["Pide", "flatbread"], ["Lavaş", "flatbread"],
    ["Yufka", "flatbread"], ["Bazlama", "flatbread"], ["Galeta", "pretzel"], ["Grissini", "pretzel"], ["Börek", "pie"], ["Kek", "cake"],
    ["Hamburger ekmeği", "burger"], ["Sandviç ekmeği", "baguette"],
    ["Köy ekmeği", "bread"], ["Kepekli ekmek", "bread"], ["Ekşi mayalı ekmek", "bread"], ["Somun", "bread"], ["Francala", "baguette"], ["Tortilla", "flatbread"], ["Lahmacun", "flatbread"], ["Krep", "pancakes"], ["Pankek", "pancakes"], ["Sandviç", "sandwich"], ["Tost", "sandwich"], ["Çörek", "croissant"],
  ],
  dairy: [
    ["Süt", "milk"], ["Laktozsuz süt", "milk"], ["Yoğurt", "bowl"], ["Süzme yoğurt", "bowl"], ["Ayran", "milk"], ["Kefir", "milk"],
    ["Beyaz peynir", "cheese"], ["Kaşar peyniri", "cheese"], ["Tulum peyniri", "cheese"], ["Lor peyniri", "cheese"], ["Krem peynir", "cheese"],
    ["Labne", "cheese"], ["Hellim", "cheese"], ["Parmesan", "cheese"], ["Mozzarella", "cheese"], ["Yumurta", "egg"], ["Tereyağı", "butter"],
    ["Margarin", "butter"], ["Kaymak", "butter"], ["Krema", "milk"], ["Bal", "honey"], ["Reçel", "jar"], ["Pekmez", "honey"], ["Tahin", "jar"],
    ["Tahin pekmez", "jar"], ["Siyah zeytin", "olive"], ["Yeşil zeytin", "olive"], ["Fındık ezmesi", "jar"], ["Fıstık ezmesi", "peanuts"],
    ["Kahvaltılık gevrek", "bowl"], ["Yulaf ezmesi", "bowl"], ["Granola", "bowl"], ["Sucuk", "hot-dog"], ["Pastırma", "meat"], ["Sosis", "hot-dog"],
    ["Salam", "hot-dog"], ["Hindi füme", "poultry"], ["Puding", "custard"], ["Sütlaç", "custard"], ["Helva", "cake"],
    ["Peynir", "cheese"], ["Zeytin", "olive"], ["Kaşar", "cheese"], ["Tost peyniri", "cheese"], ["Dil peyniri", "cheese"], ["Çökelek", "cheese"], ["Cheddar", "cheese"], ["Krem şanti", "milk"], ["Kakaolu süt", "milk"], ["Meyveli yoğurt", "bowl"], ["Jambon", "hot-dog"], ["Kavurma", "meat"], ["Mısır gevreği", "bowl"], ["Müsli", "bowl"],
  ],
  meat: [
    ["Kıyma", "meat"], ["Kuşbaşı et", "meat"], ["Biftek", "meat"], ["Antrikot", "meat"], ["Kuzu pirzola", "meat-bone"], ["Kuzu but", "meat-bone"],
    ["Köfte", "falafel"], ["Hamburger köftesi", "burger"], ["Tavuk göğsü", "poultry"], ["Tavuk but", "poultry"], ["Tavuk kanat", "poultry"],
    ["Bütün tavuk", "poultry"], ["Tavuk baget", "poultry"], ["Hindi", "poultry"], ["Ciğer", "meat"], ["Döner", "stuffed-flatbread"], ["Mantı", "dumpling"],
    ["Et", "meat"], ["Kırmızı et", "meat"], ["Dana eti", "meat"], ["Kuzu eti", "meat-bone"], ["Pirzola", "meat-bone"], ["Bonfile", "meat"], ["Tavuk", "poultry"], ["Tavuk eti", "poultry"], ["Tavuk pirzola", "poultry"], ["Şnitzel", "poultry"], ["Nugget", "poultry"], ["İnegöl köfte", "falafel"], ["Dürüm", "stuffed-flatbread"], ["Kebap", "stuffed-flatbread"], ["Tavuk döner", "stuffed-flatbread"],
  ],
  fish: [
    ["Balık", "fish"], ["Somon", "fish"], ["Levrek", "fish"], ["Çipura", "fish"], ["Hamsi", "fish"], ["İstavrit", "fish"], ["Palamut", "fish"],
    ["Uskumru", "fish"], ["Karides", "shrimp"], ["Kalamar", "squid"], ["Midye", "oyster"], ["Ton balığı", "canned"],
    ["Alabalık", "fish"], ["Sardalya", "fish"], ["Lüfer", "fish"], ["Barbun", "fish"], ["Mezgit", "fish"], ["Kalkan", "fish"], ["Ahtapot", "squid"], ["Yengeç", "crab"], ["İstiridye", "oyster"], ["Midye dolma", "oyster"],
  ],
  staples: [
    ["Pirinç", "rice"], ["Baldo pirinç", "rice"], ["Bulgur", "sheaf"], ["Makarna", "spaghetti"], ["Spagetti", "spaghetti"], ["Erişte", "noodles"],
    ["Şehriye", "noodles"], ["Un", "sheaf"], ["Mısır unu", "sheaf"], ["İrmik", "sheaf"], ["Nişasta", "sheaf"], ["Şeker", "candy"],
    ["Toz şeker", "candy"], ["Pudra şekeri", "candy"], ["Tuz", "salt"], ["Karabiber", "salt"], ["Pul biber", "hot-pepper"], ["Kimyon", "salt"],
    ["Kuru nane", "herb"], ["Kekik", "herb"], ["Tarçın", "salt"], ["Sumak", "salt"], ["Zerdeçal", "salt"], ["Kabartma tozu", "salt"],
    ["Vanilya", "salt"], ["Maya", "sheaf"], ["Ayçiçek yağı", "pouring"], ["Zeytinyağı", "olive"], ["Mısır yağı", "pouring"], ["Sirke", "pouring"],
    ["Nar ekşisi", "pouring"], ["Domates salçası", "jar"], ["Biber salçası", "jar"], ["Ketçap", "canned"], ["Mayonez", "jar"], ["Hardal", "jar"],
    ["Kırmızı mercimek", "beans"], ["Yeşil mercimek", "beans"], ["Nohut", "beans"], ["Kuru fasulye", "beans"], ["Barbunya", "beans"],
    ["Konserve mısır", "corn"], ["Konserve bezelye", "canned"], ["Domates konservesi", "canned"], ["Turşu", "jar"], ["Bulyon", "stew"],
    ["Hazır çorba", "stew"], ["Ay çekirdeği", "sunflower"], ["Susam", "sheaf"], ["Kakao", "chocolate"], ["Hindistan cevizi rendesi", "coconut"],
    ["Yağ", "pouring"], ["Sıvı yağ", "pouring"], ["Mercimek", "beans"], ["Bakliyat", "beans"], ["Salça", "jar"], ["Sos", "jar"], ["Soya sosu", "pouring"], ["Elma sirkesi", "pouring"], ["Baharat", "salt"], ["Toz biber", "hot-pepper"], ["Köri", "salt"], ["Defne yaprağı", "herb"], ["Galeta unu", "sheaf"], ["Kinoa", "rice"], ["Kuskus", "rice"], ["Lazanya", "spaghetti"], ["Konserve", "canned"], ["Çorba", "stew"], ["Tarhana", "stew"], ["Mercimek çorbası", "stew"], ["Zeytin ezmesi", "olive"], ["Karbonat", "salt"], ["Bitter kakao", "chocolate"],
  ],
  frozen: [
    ["Dondurma", "ice-cream"], ["Buz", "ice"], ["Dondurulmuş bezelye", "pea-pod"], ["Dondurulmuş sebze", "broccoli"],
    ["Dondurulmuş patates", "fries"], ["Pizza", "pizza"], ["Dondurulmuş mantı", "dumpling"], ["Waffle", "waffle"], ["Milföy", "croissant"],
    ["Dondurulmuş balık", "fish"],
    ["Dondurulmuş pizza", "pizza"], ["Sigara böreği", "pie"], ["Dondurulmuş meyve", "strawberry"], ["Buzlu çay", "cup-straw"],
  ],
  snacks: [
    ["Çikolata", "chocolate"], ["Bitter çikolata", "chocolate"], ["Sütlü çikolata", "chocolate"], ["Gofret", "chocolate"], ["Bisküvi", "cookie"],
    ["Kurabiye", "cookie"], ["Kraker", "cookie"], ["Cips", "fries"], ["Patlamış mısır", "popcorn"], ["Fındık", "chestnut"], ["Ceviz", "chestnut"],
    ["Badem", "chestnut"], ["Antep fıstığı", "peanuts"], ["Yer fıstığı", "peanuts"], ["Leblebi", "beans"], ["Kuru üzüm", "grapes"],
    ["Kuru kayısı", "peach"], ["Kuru incir", "grapes"], ["Lokum", "candy"], ["Şekerleme", "candy"], ["Sakız", "candy"], ["Lolipop", "lollipop"],
    ["Pasta", "cake"], ["Cupcake", "cupcake"], ["Donut", "doughnut"], ["Baklava", "pie"], ["Kuruyemiş", "peanuts"],
    ["Fıstık", "peanuts"], ["Çerez", "peanuts"], ["Kuru meyve", "grapes"], ["Jelibon", "candy"], ["Tatlı", "cake"], ["Kadayıf", "pie"], ["Künefe", "pie"], ["Bar", "chocolate"], ["Pestil", "candy"],
  ],
  drinks: [
    ["Su", "droplet"], ["Damacana su", "droplet"], ["Maden suyu", "bubbles"], ["Soda", "bubbles"], ["Meyve suyu", "juice"],
    ["Portakal suyu", "tangerine"], ["Kola", "cup-straw"], ["Gazoz", "cup-straw"], ["Limonata", "lemon"], ["Soğuk çay", "cup-straw"],
    ["Enerji içeceği", "cup-straw"], ["Şalgam", "juice"], ["Çay", "teapot"], ["Bitki çayı", "tea"], ["Yeşil çay", "tea"], ["Türk kahvesi", "coffee"],
    ["Filtre kahve", "coffee"], ["Hazır kahve", "coffee"], ["Kahve", "coffee"], ["Sıcak çikolata", "coffee"], ["Salep", "coffee"], ["Boza", "milk"],
    ["İçecek", "cup-straw"], ["Gazlı içecek", "cup-straw"], ["Elma suyu", "juice"], ["Vişne suyu", "juice"], ["Nar suyu", "juice"], ["Şeftali suyu", "juice"], ["Smoothie", "juice"], ["Espresso", "coffee"], ["Süt kahve", "coffee"], ["Şarap", "wine"], ["Kırmızı şarap", "wine"], ["Beyaz şarap", "wine"], ["Bira", "beer"], ["Alkolsüz bira", "beer"], ["Rakı", "tumbler"], ["Viski", "tumbler"], ["Votka", "tumbler"], ["Cin", "tumbler"],
  ],
  cleaning: [
    ["Bulaşık deterjanı", "soap"], ["Bulaşık makinesi tableti", "soap"], ["Parlatıcı", "sparkles"], ["Yüzey temizleyici", "lotion"],
    ["Çamaşır suyu", "bucket"], ["Cam sil", "sparkles"], ["Kireç çözücü", "lotion"], ["Tuz ruhu", "bucket"], ["Sünger", "sponge"], ["Bez", "sponge"],
    ["Mikrofiber bez", "sponge"], ["Çöp poşeti", "wastebasket"], ["Paspas", "broom"], ["Süpürge", "broom"], ["Eldiven", "gloves"],
    ["Oda kokusu", "sparkles"], ["Böcek ilacı", "lotion"],
    ["Deterjan", "soap"], ["Arap sabunu", "soap"], ["Bulaşık süngeri", "sponge"], ["Tel sünger", "sponge"], ["Toz bezi", "sponge"], ["Çöp torbası", "wastebasket"], ["Kova", "bucket"], ["Klor", "bucket"], ["Yağ çözücü", "lotion"], ["Banyo temizleyici", "lotion"], ["Lavabo açıcı", "lotion"], ["Faraş", "broom"], ["Mop", "broom"], ["Sinek ilacı", "lotion"],
  ],
  laundry: [
    ["Çamaşır deterjanı", "basket"], ["Sıvı deterjan", "lotion"], ["Yumuşatıcı", "lotion"], ["Leke çıkarıcı", "lotion"],
    ["Çamaşır mandalı", "safety-pin"], ["Kireç önleyici", "lotion"], ["Çamaşır filesi", "basket"],
    ["Toz deterjan", "basket"], ["Kapsül deterjan", "basket"], ["Ütü suyu", "droplet"], ["Çamaşır sepeti", "basket"],
  ],
  paper: [
    ["Tuvalet kağıdı", "toilet-paper"], ["Kağıt havlu", "toilet-paper"], ["Peçete", "tissue"], ["Mendil", "tissue"], ["Islak mendil", "tissue"],
    ["Alüminyum folyo", "foil"], ["Streç film", "foil"], ["Pişirme kağıdı", "foil"], ["Buzdolabı poşeti", "foil"], ["Kürdan", "scissors"],
    ["Kağıt bardak", "cup-straw"], ["Kağıt tabak", "bowl"], ["Pipet", "cup-straw"], ["Kağıt", "toilet-paper"], ["Havlu", "toilet-paper"], ["Selpak", "tissue"],
  ],
  care: [
    ["Şampuan", "lotion"], ["Saç kremi", "lotion"], ["Duş jeli", "lotion"], ["Sabun", "soap"], ["Sıvı sabun", "soap"], ["Diş macunu", "toothbrush"],
    ["Diş fırçası", "toothbrush"], ["Diş ipi", "toothbrush"], ["Ağız gargarası", "lotion"], ["Deodorant", "lotion"], ["Parfüm", "sparkles"],
    ["Tıraş bıçağı", "razor"], ["Tıraş köpüğü", "lotion"], ["Nemlendirici", "lotion"], ["Güneş kremi", "lotion"], ["Pamuk", "soap"],
    ["Kulak çubuğu", "toothbrush"], ["Hijyenik ped", "tissue"], ["Makyaj temizleyici", "lotion"], ["Ruj", "lipstick"],
    ["El kremi", "lotion"], ["Vücut losyonu", "lotion"], ["Yüz temizleme jeli", "lotion"], ["Tonik", "lotion"], ["Kolonya", "lotion"], ["Dezenfektan", "lotion"], ["Saç boyası", "lotion"], ["Jilet", "razor"], ["Tarak", "comb"], ["Saç fırçası", "comb"], ["Maskara", "lipstick"], ["Oje", "lipstick"], ["Fondöten", "lipstick"], ["Dudak kremi", "lipstick"], ["Tampon", "tissue"], ["Ped", "tissue"],
  ],
  baby: [
    ["Bebek bezi", "safety-pin"], ["Bebek maması", "baby-bottle"], ["Biberon", "baby-bottle"], ["Bebek şampuanı", "lotion"],
    ["Bebek ıslak mendili", "tissue"], ["Pişik kremi", "lotion"], ["Emzik", "baby-bottle"],
    ["Mama", "baby-bottle"], ["Bebek sütü", "baby-bottle"], ["Bebek kremi", "lotion"], ["Bebek yağı", "lotion"], ["Bebek bisküvisi", "cookie"],
  ],
  pet: [
    ["Kedi maması", "cat"], ["Köpek maması", "dog"], ["Kedi kumu", "cat"], ["Kuş yemi", "bird"], ["Köpek ödülü", "bone"], ["Kedi ödülü", "paw"],
    ["Kedi konservesi", "cat"], ["Köpek konservesi", "dog"], ["Balık yemi", "fish"], ["Kum", "cat"],
  ],
  pharmacy: [
    ["Ağrı kesici", "pill"], ["Vitamin", "pill"], ["Yara bandı", "bandage"], ["Maske", "mask"], ["Ateş ölçer", "thermometer"],
    ["Burun spreyi", "lotion"], ["Pastil", "candy"],
    ["İlaç", "pill"], ["Şurup", "pill"], ["Aspirin", "pill"], ["Gazlı bez", "bandage"], ["Göz damlası", "droplet"], ["Probiyotik", "pill"], ["Magnezyum", "pill"], ["Balık yağı", "pill"],
  ],
  home: [
    ["Ampul", "bulb"], ["Pil", "battery"], ["Mum", "candle"], ["Kibrit", "matches"], ["Çakmak", "matches"], ["Uzatma kablosu", "plug"],
    ["Makas", "scissors"], ["Bant", "toilet-paper"],
    ["Çiçek", "tulip"], ["Saksı", "potted-plant"], ["Toprak", "potted-plant"], ["Gübre", "potted-plant"], ["Çöp kovası", "wastebasket"], ["Şarj kablosu", "plug"], ["Priz", "plug"], ["Led ampul", "bulb"], ["Koli bandı", "toilet-paper"],
  ],
};
// Stryker restore all

export const CATALOGUE: readonly CatalogueProduct[] = AISLES.flatMap((aisle) =>
  SHELVES[aisle].map(([name, picture]) => ({ key: foldName(name), name, aisle, picture })),
);

const BY_KEY = new Map(CATALOGUE.map((product) => [product.key, product]));

/** The catalogue's product of this name, however it was typed. */
export function catalogueProduct(name: string): CatalogueProduct | undefined {
  return BY_KEY.get(foldName(name));
}

// A possessive ending, after a vowel or a consonant; the consonant it softened back ("ekmeği" is ekmek).
const POSSESSIVE = /(?<=[aeiou])s[iu]$|(?<=[^aeiou])[iu]$/u;
const SOFTENED: Record<string, string> = { g: "k", b: "p", d: "t" };

/**
 * A name's picture (SPEC 8.1): its catalogue product's, else the one of the
 * product its last word names, bare or possessed. A Turkish compound ends in
 * what it is, so "Pınar süt" is milk, "Köy ekmeği" bread and "Domates
 * salatası" a salad, never a tomato. Only the picture is taken so: the aisle
 * stays the whole name's (5.4).
 */
export function pictureOf(name: string): ProductPicture | undefined {
  const whole = catalogueProduct(name);
  if (whole) return whole.picture;
  const words = foldName(name).split(" ");
  if (words.length < 2) return undefined;
  const head = words.at(-1)!;
  const bare = head.replace(POSSESSIVE, "");
  const last = bare.at(-1)!;
  // The unsoftened spelling is tried off a bare word too: "Taze kebab" is a kebap.
  const heads = [head, bare, bare.slice(0, -1) + (SOFTENED[last] ?? last)];
  return heads.map((key) => BY_KEY.get(key)).find(Boolean)?.picture;
}

/** Whether a name is a product the catalogue or these rows know, for `parseEntry`. */
export function knowsProduct(rows: readonly { name: string }[]): (name: string) => boolean {
  const keys = new Set(rows.map((row) => foldName(row.name)));
  return (name) => BY_KEY.has(foldName(name)) || keys.has(foldName(name));
}

/** The household's products, then the catalogue's it has never had, each once (2.13). */
export function withCatalogue(known: readonly KnownProduct[]): KnownProduct[] {
  const had = new Set(known.map((product) => product.key));
  return [...known, ...CATALOGUE.filter((product) => !had.has(product.key)).map(({ key, name }) => ({ key, name, times: 0 }))];
}

/**
 * The catalogue panel's search (2.12): every aisle, the household's products
 * and favourites among the catalogue's, each once, ranked as the quick-add
 * suggestions are (2.13). Typed text is a name, never an entry: "2 süt" and
 * "tuz ve biber" are searched as written rather than read for a quantity or
 * split, and one letter is enough. What the list holds stays in, as the tick
 * it wears is how a second tap takes it off.
 */
export function searchCatalogue(known: readonly { name: string; times: number }[], text: string): KnownProduct[] {
  const key = foldName(text);
  if (key === "") return [];
  return suggestProducts(withCatalogue(knownFrom(known)), { quantity: NO_QUANTITY, key, whole: key }, [], Infinity);
}

/** An entry under the catalogue's spelling of its product, when it names one: "sut" is kept as Süt. */
export function catalogueNamed<T extends { name: string }>(entry: T): T {
  const product = catalogueProduct(entry.name);
  return product && product.name !== entry.name ? { ...entry, name: product.name } : entry;
}

// A letter held down: "domatesss" is domates however many times the s repeats.
const squeezed = (key: string) => key.replace(/(.)\1+/gu, "$1");

/**
 * The catalogue product a name nearly is (2.14), to ask about before it is
 * added as typed: letters held down, or one slipped, once `TYPO_FROM` are
 * typed. `null` for a name the catalogue or the household already knows,
 * which is no miss.
 */
export function nearMiss(name: string, known: readonly KnownProduct[]): CatalogueProduct | null {
  const key = foldName(name);
  if (key.length < TYPO_FROM || BY_KEY.has(key) || known.some((product) => product.key === key)) return null;
  const held = squeezed(key);
  return CATALOGUE.find((product) => squeezed(product.key) === held) ?? CATALOGUE.find((product) => nearly(key, product.key)) ?? null;
}

/** Where a product is walked past (5.4): where its person moved it, else the catalogue's aisle, else Diğer. */
export function aisleOf(name: string, moved: ReadonlyMap<string, Aisle>): Aisle | "other" {
  const key = foldName(name);
  return moved.get(key) ?? BY_KEY.get(key)?.aisle ?? "other";
}

/** A run of a list's open items: one aisle's, or the urgent or not-found ones, which no aisle heads. */
export interface Section<T> {
  key: string;
  items: T[];
  aisle?: Aisle | "other";
}

/**
 * A list's open items as they are drawn and dragged (SPEC 5.2): the urgent
 * first, then the rest aisle by aisle in `AISLES`' order, what the catalogue
 * does not know after them, and what was not found last, urgent first. Each
 * run keeps the list's own order, which is how a drag within an aisle is kept.
 * The aisles are headed only when there are two or more of them. `moved` is
 * where the person put a product, by folded name (5.4).
 */
export function listSections<T extends { name: string; urgent?: boolean; notFound?: boolean }>(
  open: readonly T[],
  moved: ReadonlyMap<string, Aisle> = new Map(),
): Section<T>[] {
  const shelves = new Map<Aisle | "other", T[]>([...AISLES, "other" as const].map((aisle) => [aisle, []]));
  for (const item of open) if (!item.urgent && !item.notFound) shelves.get(aisleOf(item.name, moved))!.push(item);
  const filled = [...shelves].filter(([, items]) => items.length > 0);
  const headed = filled.length > 1;
  return [
    { key: "urgent", items: open.filter((item) => item.urgent && !item.notFound) },
    ...filled.map(([aisle, items]) => ({ key: aisle, items, ...(headed && { aisle }) })),
    { key: "notFoundUrgent", items: open.filter((item) => item.urgent && item.notFound) },
    { key: "notFound", items: open.filter((item) => !item.urgent && item.notFound) },
  ].filter((section) => section.items.length > 0);
}

/**
 * What each aisle cost (SPEC 3.9), the dearest first and a tie in `AISLES`'
 * order, from the priced items bought: a receipt's total names no product, so
 * it cannot be split between aisles.
 */
export function aisleShares(bought: readonly { name: string; priceMinor: number }[]): { aisle: Aisle | "other"; spentMinor: number }[] {
  const order = [...AISLES, "other" as const];
  const spent = new Map<Aisle | "other", number>();
  for (const { name, priceMinor } of bought) {
    const aisle = catalogueProduct(name)?.aisle ?? "other";
    spent.set(aisle, (spent.get(aisle) ?? 0) + priceMinor);
  }
  return [...spent]
    .map(([aisle, spentMinor]) => ({ aisle, spentMinor }))
    .sort((a, b) => b.spentMinor - a.spentMinor || order.indexOf(a.aisle) - order.indexOf(b.aisle));
}
