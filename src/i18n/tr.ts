/** Every string a user reads. Turkish in the interface, English in code. */

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
    back: "Geri",
    cancel: "Vazgeç",
    deleted: (name: string) => `${name} silindi`,
    /** What a screen reader hears for a card or a row: its name, then its line when it has one. */
    withDetail: (title: string, detail: string) => (detail ? `${title}, ${detail}` : title),
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
    renameTitle: "Listeyi yeniden adlandır",
    renameMessage: "Listenin yeni adı.",
    rename: (name: string) => `${name} listesini yeniden adlandır`,
    delete: (name: string) => `${name} listesini sil`,
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
    basket: "Sepette",
    progress: basketProgress,
    openHint: "Düzenlemek için aç",
    nameLabel: "Ürünün adı",
    quantity: "Miktar",
    noteLabel: "Not",
    notePlaceholder: "Not ya da marka: Pınar olsun",
    urgent: "Acil",
    /** An item's second line as drawn; read aloud, `common.withDetail` joins it with commas. */
    detail: (parts: readonly string[]) => parts.join(" · "),
    less: (name: string) => `${name} miktarını azalt`,
    more: (name: string) => `${name} miktarını artır`,
    delete: (name: string) => `${name} ürününü sil`,
    suggestion: (name: string) => `${name} ürününü ekle`,
    finish: "Alışverişi Bitir",
    finished: (count: number) => `Alışveriş bitti, ${count} ürün geçmişe taşındı`,
  },
  history: {
    emptyTitle: "Henüz biten alışveriş yok",
    emptyHint: "Sepete attıklarını “Alışverişi Bitir” ile buraya taşı. Her birini tek dokunuşla listesine geri ekleyebilirsin.",
    /** A shop's card and the line above what it bought. */
    summary: (finishedAt: string, bought: number) => `${dateTimeLabel(finishedAt)} · ${bought} ürün`,
    openHint: "Alınanları gör",
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
