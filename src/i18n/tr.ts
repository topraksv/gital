/** Every string a user reads. Turkish in the interface, English in code. */

import { formatMinor } from "../domain/money";

/** Helix's `dateTimeLabel`, its formatter made once: "24 Eylül 2026 14:05", on the device's clock. */
const DATE_TIME = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" });

function dateTimeLabel(iso: string): string {
  const value = new Date(iso);
  // A stamp this device cannot read shows as it is rather than throwing in render.
  return Number.isNaN(value.getTime()) ? iso : DATE_TIME.format(value);
}

const DATE = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" });

const MONTH = new Intl.DateTimeFormat("tr-TR", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });

function dateLabel(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? iso : DATE.format(value);
}

/** How far a shop has got, on a list's card and above its items alike. */
function basketProgress(done: number, total: number): string {
  return done === total ? "Hepsi sepette" : `${done}/${total} sepette`;
}

export const tr = {
  common: {
    /** Between the parts of a line as drawn; read aloud, an item's parts are joined by commas. */
    separator: " · ",
    back: "Geri",
    cancel: "Vazgeç",
    deleted: (name: string) => `${name} silindi`,
    /** What a screen reader hears for a card or a row: its name, then its line when it has one. */
    withDetail: (title: string, detail: string) => (detail ? `${title}, ${detail}` : title),
    /** The parts that are there, on one line. */
    joined: (...parts: (string | undefined)[]) => parts.filter(Boolean).join(tr.common.separator),
    done: "Tamam",
    retry: "Tekrar Dene",
    save: "Kaydet",
    undo: "Geri Al",
  },
  errors: {
    title: "Hata",
    bootFailedTitle: "Listeler açılamadı",
    bootFailedHint: "Listelerin cihazında duruyor. Tekrar denemek çoğu zaman yeterli olur; sürerse uygulamayı kapatıp açmayı dene.",
    readFailedTitle: "Listeler okunamadı",
    readFailedHint: "Yeniden deneniyor. Beklemek istemezsen şimdi dene.",
    saveFailed: "Kaydedilemedi. Lütfen tekrar dene.",
    deleteFailed: "Silinemedi. Lütfen tekrar dene.",
    undoFailed: "Geri alınamadı. Lütfen tekrar dene.",
    shareFailed: "Paylaşılamadı. Lütfen tekrar dene.",
  },
  tabs: {
    lists: "Listeler",
    pantry: "Kiler",
    wishes: "İstekler",
    history: "Geçmiş",
    settings: "Ayarlar",
  },
  lists: {
    create: "Yeni Liste",
    createTitle: "Yeni liste",
    createMessage: "Listeye bir ad ver. Sonra değiştirebilirsin.",
    createConfirm: "Oluştur",
    namePlaceholder: "Ör. Market",
    edit: (name: string) => `${name} listesini düzenle`,
    nameLabel: "Listenin adı",
    color: "Renk",
    picture: "Resim",
    /** The default: one of the theme's three tones, picked by the list's id. */
    colorAuto: "Kendiliğinden",
    pictureLetter: "Baş harfi",
    colors: { terracotta: "Kiremit", mustard: "Hardal", green: "Yeşil", teal: "Deniz", lavender: "Lavanta", rose: "Gül" },
    pictures: {
      cart: "Market arabası",
      vegetables: "Sebze",
      fruit: "Meyve",
      bakery: "Fırın",
      breakfast: "Kahvaltılık",
      meat: "Et",
      fish: "Balık",
      coffee: "Kahve",
      dessert: "Tatlı",
      care: "Kişisel bakım",
      cleaning: "Temizlik",
      laundry: "Çamaşır",
      pharmacy: "Eczane",
      baby: "Bebek",
      pet: "Evcil hayvan",
      home: "Ev",
      hardware: "Hırdavat",
      garden: "Bahçe",
      gift: "Hediye",
      party: "Kutlama",
    },
    delete: (name: string) => `${name} listesini sil`,
    share: (name: string) => `${name} listesini paylaş`,
    copied: "Liste panoya kopyalandı",
    openHint: "Listeyi aç",
    emptyTitle: "Henüz liste yok",
    emptyHint: "Market, pazar, eczane — her alışveriş için bir liste aç.",
    /** A list card's second line: what is on it, and how far the shop has got. */
    summary: (total: number, inBasket: number) =>
      total === 0 ? "Boş" : inBasket === 0 ? `${total} ürün` : basketProgress(inBasket, total),
  },
  items: {
    add: "Ekle",
    addLabel: "Listeye ürün ekle",
    addPlaceholder: "2 kg domates, süt ve ekmek",
    emptyTitle: "Bu liste boş",
    emptyHint: "Yukarıya yaz. Virgülle ya da “ve” ile ayırırsan birkaç ürün birden eklenir.",
    /** With what its priced items cost so far (SPEC 3.8). */
    basket: (spentMinor: number | null) => tr.common.joined("Sepette", tr.history.spent(spentMinor)),
    progress: basketProgress,
    openHint: "Düzenlemek için aç",
    sort: "Sırala",
    sortDone: "Bitti",
    reorder: (name: string) => `${name}: sırasını değiştir`,
    moveUp: "Yukarı taşı",
    moveDown: "Aşağı taşı",
    nameLabel: "Ürünün adı",
    quantity: "Miktar",
    noteLabel: "Not",
    notePlaceholder: "Not ya da marka: Pınar olsun",
    urgent: "Acil",
    notFound: "Bulunamadı",
    insteadLabel: "Yerine alınan",
    insteadPlaceholder: "Yerine alınan: Sütaş",
    instead: (name: string) => `Yerine: ${name}`,
    priceLabel: "Ödenen fiyat",
    pricePlaceholder: "Ödenen fiyat: 45,90",
    priceRise: (percent: number) => `Son alışlardan %${percent} pahalı`,
    /** When a product was last bought on any list, and what it cost then (SPEC 3.9). */
    lastBought: (at: string, priceMinor: number | null) =>
      `Son alış: ${dateLabel(at)}${priceMinor == null ? "" : `${tr.common.separator}${formatMinor(priceMinor)}`}`,
    lastPrices: (prices: readonly number[]) => `Son fiyatlar: ${prices.map(formatMinor).join(" → ")}`,
    list: "Liste",
    keepHere: "Bu listede de kalsın",
    moved: (name: string, list: string) => `${name}, ${list} listesine taşındı`,
    copied: (name: string, list: string) => `${name}, ${list} listesine kopyalandı`,
    less: (name: string) => `${name} miktarını azalt`,
    more: (name: string) => `${name} miktarını artır`,
    delete: (name: string) => `${name} ürününü sil`,
    suggestion: (name: string) => `${name} ürününü ekle`,
    restockTitle: "Bitmiş olabilir",
    restockChip: (name: string, everyDays: number) => `${name} · ${everyDays === 1 ? "her gün" : `${everyDays} günde bir`}`,
    restock: (name: string, everyDays: number) =>
      `${name} ürününü ekle, genelde ${everyDays === 1 ? "her gün" : `${everyDays} günde bir`} alınıyor`,
    paste: (list: string) => `${list} listesine metinden ekle`,
    pasteTitle: "Metinden ekle",
    pasteMessage: "Bir listeyi yapıştır: her satır ya da virgül bir ürün. Gital’den paylaşılan bir listenin notları ve acilleri de gelir.",
    pastePlaceholder: "• 2 kg domates\n• süt (Pınar olsun)",
    pasted: (count: number) => `${count} ürün listeye eklendi`,
    pastedNothing: "Eklenecek yeni ürün yok",
    finish: "Alışverişi Bitir",
    finished: (count: number) => `Alışveriş bitti, ${count} ürün geçmişe taşındı`,
  },
  /** Helix's calculator (SPEC 4.4). */
  celebration: {
    title: "Alışveriş bitti",
    bought: (count: number) => `${count}\u00a0ürün alındı`,
    stayed: (count: number) => `${count}\u00a0ürün listede kaldı`,
    month: (spent: string) => `Bu ay: ${spent}`,
    skip: "Kutlamayı kapat",
  },
  calc: {
    title: "Hesap Makinesi",
    open: (field: string) => `${field}: hesap makinesini aç`,
    error: "Hata",
    use: (amount: string) => `Sonucu Kullan · ${amount}`,
    unusable: "Sonuç bir tutar olamaz",
    display: (value: string, preview?: string) => `Hesap makinesi ekranı: ${value}${preview ? `. Önizleme: ${preview}` : ""}`,
    key: (key: string) =>
      ({
        "⌫": "Son basamağı sil",
        C: "Hesabı temizle",
        "÷": "Böl",
        "×": "Çarp",
        "-": "Çıkar",
        "+": "Topla",
        "=": "Sonucu hesapla",
        ",": "Ondalık ayırıcı",
      })[key] ?? key,
  },
  catalogue: {
    open: "Katalogdan seç",
    title: "Katalog",
    aisle: "Reyon",
    didYouMean: (name: string) => `Bunu mu demek istediniz: ${name}?`,
    keep: (typed: string) => `${typed} olarak ekle`,
    aisles: {
      produce: "Sebze",
      fruit: "Meyve",
      bakery: "Fırın",
      dairy: "Kahvaltılık ve süt",
      meat: "Et ve tavuk",
      fish: "Balık",
      staples: "Temel gıda",
      frozen: "Donuk",
      snacks: "Atıştırmalık",
      drinks: "İçecek",
      cleaning: "Temizlik",
      laundry: "Çamaşır",
      paper: "Kağıt ve mutfak",
      care: "Kişisel bakım",
      baby: "Bebek",
      pet: "Evcil hayvan",
      pharmacy: "Sağlık",
      home: "Ev gereçleri",
      other: "Diğer",
    },
  },
  wishes: {
    create: "Yeni Koleksiyon",
    createTitle: "Yeni koleksiyon",
    createMessage: "Ev, giyim, hediye… İsteklerini koleksiyonlara ayır.",
    namePlaceholder: "Ör. Ev",
    emptyTitle: "Henüz istek yok",
    emptyHint: "“Keşke bende olsa” dediklerin için bir koleksiyon aç. Trendyol, Hepsiburada ya da Amazon'dan bir bağlantı yapıştırabilir, ya da yalnız adını yazabilirsin.",
    /** A collection's card: how many are open and what they come to. */
    summary: (open: number, totalMinor: number | null) =>
      tr.common.joined(`${open}\u00a0istek`, totalMinor == null ? undefined : formatMinor(totalMinor)),
    openHint: "Koleksiyonu aç",
    edit: (name: string) => `${name} koleksiyonunu düzenle`,
    delete: (name: string) => `${name} koleksiyonunu sil`,
    add: "Ekle",
    addLabel: "Koleksiyona istek ekle",
    addPlaceholder: "Bir ad ya da bağlantı yapıştır",
    itemsEmptyTitle: "Bu koleksiyon boş",
    itemsEmptyHint: "Beğendiğin bir şeyin adını ya da mağazadaki sayfasının bağlantısını yukarıya yapıştır.",
    openTotal: (totalMinor: number) => `Açık isteklerin toplamı: ${formatMinor(totalMinor)}`,
    bought: "Alındı",
    openWishHint: "Düzenlemek için aç",
    priority: "Öncelik",
    priorities: ["Düşük", "Normal", "Yüksek"] as const,
    wanted: "Öncelikli",
    estimated: (minor: number) => `Tahmini ${formatMinor(minor)}`,
    nameLabel: "İsteğin adı",
    noteLabel: "Not",
    notePlaceholder: "Renk, beden, model…",
    estimateLabel: "Tahmini fiyat",
    estimatePlaceholder: "Tahmini fiyat",
    links: "Bağlantılar",
    linkAdd: "Bağlantı ekle",
    linkPlaceholder: "https://…",
    linkInvalid: "Bu bir web sayfası bağlantısı değil.",
    linkPrice: (shop: string) => `${shop} fiyatı`,
    linkOpen: (shop: string) => `${shop} sayfasını aç`,
    linkRemove: (shop: string) => `${shop} bağlantısını kaldır`,
    cheapest: "En ucuz",
    deleteWish: (name: string) => `${name} isteğini sil`,
  },
  history: {
    emptyTitle: "Henüz biten alışveriş yok",
    emptyHint: "Sepete attıklarını “Alışverişi Bitir” ile buraya taşı. Her birini tek dokunuşla listesine geri ekleyebilirsin.",
    /** A shop's card and the line above what it bought; the count never parts from its noun. */
    summary: (finishedAt: string, bought: number) => `${dateTimeLabel(finishedAt)}${tr.common.separator}${bought}\u00a0ürün`,
    /** What a shop's priced items cost (SPEC 3.8); nothing when none was priced, which is not ₺0. */
    spent: (spentMinor: number | null) => (spentMinor == null ? undefined : formatMinor(spentMinor)),
    openHint: "Alınanları gör",
    total: "Alışverişin toplamı",
    totalMessage: "Fişteki tutarı yaz. Boş bırakırsan girilen fiyatların toplamı kalır.",
    totalPlaceholder: "Fişteki tutar: 612,75",
    editTotal: "Toplamı fişe göre düzelt",
    addBack: (name: string) => `${name} ürününü listeye geri ekle`,
    addedBack: (name: string) => `${name} listeye eklendi`,
    months: "Son 6 ay",
    month: (start: string) => MONTH.format(new Date(start)),
    /** Every bar read aloud as the eye reads it: the month, and what it cost or that nothing was priced. */
    monthsLabel: (months: readonly { start: string; spentMinor: number | null }[]) =>
      `Son 6 ay: ${months.map((month) => `${MONTH_LONG.format(new Date(month.start))} ${month.spentMinor == null ? "fiyat yok" : formatMinor(month.spentMinor)}`).join(", ")}`,
    aisles: "Bu ay reyonlar",
    aislesLabel: (rows: readonly { name: string; spentMinor: number }[]) => `Bu ay reyonlar: ${rows.map((row) => `${row.name} ${formatMinor(row.spentMinor)}`).join(", ")}`,
  },
  pantry: {
    emptyTitle: "Kiler boş",
    emptyHint: "Alışverişi bitirince sepettekiler buraya gelir. Azaldıkça eksilt; biten, geldiği listeye döner.",
    less: (name: string) => `${name}: bir azalt`,
    finish: (name: string) => `${name} bitti, listeye ekle`,
    /** The undo bar's line; a list deleted since takes nothing back. */
    finished: (name: string, list: string | null) => (list == null ? `${name} bitti` : `${name} bitti, ${list} listesine eklendi`),
  },
  tour: {
    step: (step: number, total: number, title: string) => `${total} adımdan ${step}. ${title}`,
    next: "İleri",
    skip: "Geç",
    back: "Geri",
    start: "Başla",
    replay: "Tanıtımı yeniden izle",
    replayHint: "Gital'in beş adımlık kısa tanıtımı",
    slides: [
      { title: "Her alışverişe bir liste", body: "Market, pazar, eczane: her yer için ayrı bir liste tut. Rengini ve resmini sen seçersin." },
      { title: "Yazdığın gibi ekle", body: "“2 kg domates, süt ve ekmek” tek satırda üç ürün olur. Söyleyerek de ekleyebilir, bir mesajdaki listeyi yapıştırabilirsin." },
      { title: "Markette tek elle", body: "Aldığını daireye dokunarak ya da sağa kaydırarak sepete at. Satıra dokunursan ödediğin fiyatı yazarsın." },
      { title: "Alışverişi bitir", body: "Sepettekiler Geçmiş'e gider, ne kadar tuttuğuyla. Alınmayanlar listede kalır." },
      { title: "Gital hatırlar", body: "Bir ürünü en son ne zaman, kaça aldığını söyler; fiyat yükseldiyse uyarır, bitme vakti gelen ürünü önerir." },
    ],
  },
  settings: {
    appSection: "Uygulama",
    helpSection: "Yardım",
    theme: "Tema",
    themeSystem: "Sistem",
    themeLight: "Açık",
    themeDark: "Koyu",
    palette: "Renk Paleti",
    paletteClay: "Amber",
    paletteClayDesc: "Sıcak keten, pişmiş toprak ve pirinç.",
    paletteOcean: "Petrol",
    paletteOceanDesc: "Mineral gri, petrol mavisi ve soluk mercan.",
    paletteForest: "Servi",
    paletteForestDesc: "Taş nötrleri, koyu servi ve yaban eriği.",
  },
} as const;
