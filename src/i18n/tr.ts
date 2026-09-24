/** Every string a user reads. Turkish in the interface, English in code. */

/** How far a shop has got, on a list's card and above its items alike. */
function basketProgress(done: number, total: number): string {
  return done === total ? "Hepsi sepette" : `${done}/${total} sepette`;
}

export const tr = {
  common: {
    back: "Geri",
    cancel: "Vazgeç",
    deleted: (name: string) => `${name} silindi`,
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
    open: (name: string, summary: string) => `${name}, ${summary}`,
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
    open: (name: string, quantity: string) => (quantity ? `${name}, ${quantity}` : name),
    openHint: "Düzenlemek için aç",
    nameLabel: "Ürünün adı",
    quantity: "Miktar",
    less: (name: string) => `${name} miktarını azalt`,
    more: (name: string) => `${name} miktarını artır`,
    delete: (name: string) => `${name} ürününü sil`,
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
