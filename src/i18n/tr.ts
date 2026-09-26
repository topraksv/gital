/** Every string a user reads. Turkish in the interface, English in code. */

import { formatMinor } from "../domain/money";

/** Helix's `dateTimeLabel`, its formatter made once: "24 Eylül 2026 14:05", on the device's clock. */
const DATE_TIME = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" });

function dateTimeLabel(iso: string): string {
  const value = new Date(iso);
  // A stamp this device cannot read shows as it is rather than throwing in render.
  return Number.isNaN(value.getTime()) ? iso : DATE_TIME.format(value);
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
  },
  settings: {
    appSection: "Uygulama",
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
