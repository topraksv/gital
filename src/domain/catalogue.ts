/**
 * The built-in catalogue (`docs/SPEC.md` 2.12–2.15, 8.1): generic Turkish
 * products, each in the aisle a market shelves it in and with a Noto Emoji
 * picture of its own (`src/ui/product-pictures.ts`). A product is found by its
 * whole folded name and never guessed at: "Domates salatası" is not Domates.
 */

import { foldName, type KnownProduct } from "./items";

/** In the order a Turkish market is walked: fresh food at the door, the household at the back. */
export const AISLES = ["produce", "fruit", "bakery", "dairy", "meat", "fish", "staples", "frozen", "snacks", "drinks", "cleaning", "laundry", "paper", "care", "baby", "pet", "pharmacy", "home"] as const;
export type Aisle = (typeof AISLES)[number];

export const PRODUCT_PICTURES = [
  "avocado", "baby-bottle", "bagel", "baguette", "banana", "bandage", "basket", "battery", "beans", "bell-pepper", "bird", "blueberries", "bone",
  "bowl", "bread", "broccoli", "broom", "bubbles", "bucket", "bulb", "burger", "butter", "cake", "candle", "candy", "canned", "carrot", "cat",
  "cheese", "cherries", "chestnut", "chocolate", "coconut", "coffee", "cookie", "corn", "crab", "croissant", "cucumber", "cup-straw", "cupcake",
  "custard", "dog", "doughnut", "droplet", "dumpling", "egg", "eggplant", "falafel", "fish", "flatbread", "foil", "fries", "garlic", "ginger",
  "gloves", "grapes", "green-apple", "herb", "honey", "hot-dog", "hot-pepper", "ice", "ice-cream", "jar", "juice", "kiwi", "leafy-green", "lemon",
  "lipstick", "lollipop", "lotion", "mango", "mask", "matches", "meat", "meat-bone", "melon", "milk", "mushroom", "noodles", "olive", "onion", "paw",
  "pea-pod", "peach", "peanuts", "pear", "pie", "pill", "pineapple", "pizza", "plug", "popcorn", "potato", "poultry", "pouring", "pretzel", "razor",
  "red-apple", "rice", "safety-pin", "salad", "salt", "scissors", "sheaf", "shrimp", "soap", "spaghetti", "sparkles", "sponge", "squid",
  "strawberry", "sunflower", "sweet-potato", "tangerine", "tea", "teapot", "thermometer", "tissue", "toilet-paper", "tomato", "toothbrush", "waffle",
  "wastebasket", "watermelon",
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
  ],
  fruit: [
    ["Elma", "red-apple"], ["Yeşil elma", "green-apple"], ["Armut", "pear"], ["Portakal", "tangerine"], ["Mandalina", "tangerine"],
    ["Greyfurt", "tangerine"], ["Muz", "banana"], ["Karpuz", "watermelon"], ["Kavun", "melon"], ["Üzüm", "grapes"], ["Çilek", "strawberry"],
    ["Kiraz", "cherries"], ["Vişne", "cherries"], ["Şeftali", "peach"], ["Kayısı", "peach"], ["Erik", "grapes"], ["Nar", "red-apple"],
    ["Ayva", "pear"], ["İncir", "grapes"], ["Mango", "mango"], ["Ananas", "pineapple"], ["Kivi", "kiwi"], ["Hindistan cevizi", "coconut"],
    ["Yaban mersini", "blueberries"], ["Böğürtlen", "blueberries"], ["Ahududu", "strawberry"], ["Hurma", "chestnut"],
  ],
  bakery: [
    ["Ekmek", "bread"], ["Tam buğday ekmeği", "bread"], ["Çavdar ekmeği", "bread"], ["Tost ekmeği", "bread"], ["Baget", "baguette"],
    ["Simit", "bagel"], ["Poğaça", "croissant"], ["Açma", "croissant"], ["Kruvasan", "croissant"], ["Pide", "flatbread"], ["Lavaş", "flatbread"],
    ["Yufka", "flatbread"], ["Bazlama", "flatbread"], ["Galeta", "pretzel"], ["Grissini", "pretzel"], ["Börek", "pie"], ["Kek", "cake"],
    ["Hamburger ekmeği", "burger"], ["Sandviç ekmeği", "baguette"],
  ],
  dairy: [
    ["Süt", "milk"], ["Laktozsuz süt", "milk"], ["Yoğurt", "bowl"], ["Süzme yoğurt", "bowl"], ["Ayran", "milk"], ["Kefir", "milk"],
    ["Beyaz peynir", "cheese"], ["Kaşar peyniri", "cheese"], ["Tulum peyniri", "cheese"], ["Lor peyniri", "cheese"], ["Krem peynir", "cheese"],
    ["Labne", "cheese"], ["Hellim", "cheese"], ["Parmesan", "cheese"], ["Mozzarella", "cheese"], ["Yumurta", "egg"], ["Tereyağı", "butter"],
    ["Margarin", "butter"], ["Kaymak", "butter"], ["Krema", "milk"], ["Bal", "honey"], ["Reçel", "jar"], ["Pekmez", "honey"], ["Tahin", "jar"],
    ["Tahin pekmez", "jar"], ["Siyah zeytin", "olive"], ["Yeşil zeytin", "olive"], ["Fındık ezmesi", "jar"], ["Fıstık ezmesi", "peanuts"],
    ["Kahvaltılık gevrek", "bowl"], ["Yulaf ezmesi", "bowl"], ["Granola", "bowl"], ["Sucuk", "hot-dog"], ["Pastırma", "meat"], ["Sosis", "hot-dog"],
    ["Salam", "hot-dog"], ["Hindi füme", "poultry"], ["Puding", "custard"], ["Sütlaç", "custard"], ["Helva", "cake"],
  ],
  meat: [
    ["Kıyma", "meat"], ["Kuşbaşı et", "meat"], ["Biftek", "meat"], ["Antrikot", "meat"], ["Kuzu pirzola", "meat-bone"], ["Kuzu but", "meat-bone"],
    ["Köfte", "falafel"], ["Hamburger köftesi", "burger"], ["Tavuk göğsü", "poultry"], ["Tavuk but", "poultry"], ["Tavuk kanat", "poultry"],
    ["Bütün tavuk", "poultry"], ["Tavuk baget", "poultry"], ["Hindi", "poultry"], ["Ciğer", "meat"], ["Döner", "meat"], ["Mantı", "dumpling"],
  ],
  fish: [
    ["Balık", "fish"], ["Somon", "fish"], ["Levrek", "fish"], ["Çipura", "fish"], ["Hamsi", "fish"], ["İstavrit", "fish"], ["Palamut", "fish"],
    ["Uskumru", "fish"], ["Karides", "shrimp"], ["Kalamar", "squid"], ["Midye", "crab"], ["Ton balığı", "canned"],
  ],
  staples: [
    ["Pirinç", "rice"], ["Baldo pirinç", "rice"], ["Bulgur", "sheaf"], ["Makarna", "spaghetti"], ["Spagetti", "spaghetti"], ["Erişte", "noodles"],
    ["Şehriye", "noodles"], ["Un", "sheaf"], ["Mısır unu", "sheaf"], ["İrmik", "sheaf"], ["Nişasta", "sheaf"], ["Şeker", "candy"],
    ["Toz şeker", "candy"], ["Pudra şekeri", "candy"], ["Tuz", "salt"], ["Karabiber", "salt"], ["Pul biber", "hot-pepper"], ["Kimyon", "salt"],
    ["Kuru nane", "herb"], ["Kekik", "herb"], ["Tarçın", "salt"], ["Sumak", "salt"], ["Zerdeçal", "salt"], ["Kabartma tozu", "salt"],
    ["Vanilya", "salt"], ["Maya", "sheaf"], ["Ayçiçek yağı", "pouring"], ["Zeytinyağı", "olive"], ["Mısır yağı", "pouring"], ["Sirke", "pouring"],
    ["Nar ekşisi", "pouring"], ["Domates salçası", "jar"], ["Biber salçası", "jar"], ["Ketçap", "canned"], ["Mayonez", "jar"], ["Hardal", "jar"],
    ["Kırmızı mercimek", "beans"], ["Yeşil mercimek", "beans"], ["Nohut", "beans"], ["Kuru fasulye", "beans"], ["Barbunya", "beans"],
    ["Konserve mısır", "corn"], ["Konserve bezelye", "canned"], ["Domates konservesi", "canned"], ["Turşu", "jar"], ["Bulyon", "canned"],
    ["Hazır çorba", "canned"], ["Ay çekirdeği", "sunflower"], ["Susam", "sheaf"], ["Kakao", "chocolate"], ["Hindistan cevizi rendesi", "coconut"],
  ],
  frozen: [
    ["Dondurma", "ice-cream"], ["Buz", "ice"], ["Dondurulmuş bezelye", "pea-pod"], ["Dondurulmuş sebze", "broccoli"],
    ["Dondurulmuş patates", "fries"], ["Pizza", "pizza"], ["Dondurulmuş mantı", "dumpling"], ["Waffle", "waffle"], ["Milföy", "croissant"],
    ["Dondurulmuş balık", "fish"],
  ],
  snacks: [
    ["Çikolata", "chocolate"], ["Bitter çikolata", "chocolate"], ["Sütlü çikolata", "chocolate"], ["Gofret", "chocolate"], ["Bisküvi", "cookie"],
    ["Kurabiye", "cookie"], ["Kraker", "cookie"], ["Cips", "fries"], ["Patlamış mısır", "popcorn"], ["Fındık", "chestnut"], ["Ceviz", "chestnut"],
    ["Badem", "chestnut"], ["Antep fıstığı", "peanuts"], ["Yer fıstığı", "peanuts"], ["Leblebi", "beans"], ["Kuru üzüm", "grapes"],
    ["Kuru kayısı", "peach"], ["Kuru incir", "grapes"], ["Lokum", "candy"], ["Şekerleme", "candy"], ["Sakız", "candy"], ["Lolipop", "lollipop"],
    ["Pasta", "cake"], ["Cupcake", "cupcake"], ["Donut", "doughnut"], ["Baklava", "pie"], ["Kuruyemiş", "peanuts"],
  ],
  drinks: [
    ["Su", "droplet"], ["Damacana su", "droplet"], ["Maden suyu", "bubbles"], ["Soda", "bubbles"], ["Meyve suyu", "juice"],
    ["Portakal suyu", "tangerine"], ["Kola", "cup-straw"], ["Gazoz", "cup-straw"], ["Limonata", "lemon"], ["Soğuk çay", "cup-straw"],
    ["Enerji içeceği", "cup-straw"], ["Şalgam", "juice"], ["Çay", "teapot"], ["Bitki çayı", "tea"], ["Yeşil çay", "tea"], ["Türk kahvesi", "coffee"],
    ["Filtre kahve", "coffee"], ["Hazır kahve", "coffee"], ["Kahve", "coffee"], ["Sıcak çikolata", "coffee"], ["Salep", "coffee"], ["Boza", "milk"],
  ],
  cleaning: [
    ["Bulaşık deterjanı", "soap"], ["Bulaşık makinesi tableti", "soap"], ["Parlatıcı", "sparkles"], ["Yüzey temizleyici", "lotion"],
    ["Çamaşır suyu", "bucket"], ["Cam sil", "sparkles"], ["Kireç çözücü", "lotion"], ["Tuz ruhu", "bucket"], ["Sünger", "sponge"], ["Bez", "sponge"],
    ["Mikrofiber bez", "sponge"], ["Çöp poşeti", "wastebasket"], ["Paspas", "broom"], ["Süpürge", "broom"], ["Eldiven", "gloves"],
    ["Oda kokusu", "sparkles"], ["Böcek ilacı", "lotion"],
  ],
  laundry: [
    ["Çamaşır deterjanı", "basket"], ["Sıvı deterjan", "lotion"], ["Yumuşatıcı", "lotion"], ["Leke çıkarıcı", "lotion"],
    ["Çamaşır mandalı", "safety-pin"], ["Kireç önleyici", "lotion"], ["Çamaşır filesi", "basket"],
  ],
  paper: [
    ["Tuvalet kağıdı", "toilet-paper"], ["Kağıt havlu", "toilet-paper"], ["Peçete", "tissue"], ["Mendil", "tissue"], ["Islak mendil", "tissue"],
    ["Alüminyum folyo", "foil"], ["Streç film", "foil"], ["Pişirme kağıdı", "foil"], ["Buzdolabı poşeti", "foil"], ["Kürdan", "scissors"],
  ],
  care: [
    ["Şampuan", "lotion"], ["Saç kremi", "lotion"], ["Duş jeli", "lotion"], ["Sabun", "soap"], ["Sıvı sabun", "soap"], ["Diş macunu", "toothbrush"],
    ["Diş fırçası", "toothbrush"], ["Diş ipi", "toothbrush"], ["Ağız gargarası", "lotion"], ["Deodorant", "lotion"], ["Parfüm", "sparkles"],
    ["Tıraş bıçağı", "razor"], ["Tıraş köpüğü", "lotion"], ["Nemlendirici", "lotion"], ["Güneş kremi", "lotion"], ["Pamuk", "soap"],
    ["Kulak çubuğu", "toothbrush"], ["Hijyenik ped", "tissue"], ["Makyaj temizleyici", "lotion"], ["Ruj", "lipstick"],
  ],
  baby: [
    ["Bebek bezi", "safety-pin"], ["Bebek maması", "baby-bottle"], ["Biberon", "baby-bottle"], ["Bebek şampuanı", "lotion"],
    ["Bebek ıslak mendili", "tissue"], ["Pişik kremi", "lotion"], ["Emzik", "baby-bottle"],
  ],
  pet: [
    ["Kedi maması", "cat"], ["Köpek maması", "dog"], ["Kedi kumu", "cat"], ["Kuş yemi", "bird"], ["Köpek ödülü", "bone"], ["Kedi ödülü", "paw"],
  ],
  pharmacy: [
    ["Ağrı kesici", "pill"], ["Vitamin", "pill"], ["Yara bandı", "bandage"], ["Maske", "mask"], ["Ateş ölçer", "thermometer"],
    ["Burun spreyi", "lotion"], ["Pastil", "candy"],
  ],
  home: [
    ["Ampul", "bulb"], ["Pil", "battery"], ["Mum", "candle"], ["Kibrit", "matches"], ["Çakmak", "matches"], ["Uzatma kablosu", "plug"],
    ["Makas", "scissors"], ["Bant", "toilet-paper"],
  ],
};

export const CATALOGUE: readonly CatalogueProduct[] = AISLES.flatMap((aisle) =>
  SHELVES[aisle].map(([name, picture]) => ({ key: foldName(name), name, aisle, picture })),
);

const BY_KEY = new Map(CATALOGUE.map((product) => [product.key, product]));

/** The catalogue's product of this name, however it was typed. */
export function catalogueProduct(name: string): CatalogueProduct | undefined {
  return BY_KEY.get(foldName(name));
}

/** The household's products, then the catalogue's it has never had, each once (2.13). */
export function withCatalogue(known: readonly KnownProduct[]): KnownProduct[] {
  const had = new Set(known.map((product) => product.key));
  return [...known, ...CATALOGUE.filter((product) => !had.has(product.key)).map(({ key, name }) => ({ key, name, times: 0 }))];
}
