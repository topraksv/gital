/**
 * The price search's strings (SPEC 7.9), apart from `./tr` because only the phone shows them: Metro does not
 * tree-shake, and `tr` is in the web's entry bundle, which carries nothing of the search.
 */

import { formatMinor } from "../domain/money";
import { tr } from "./tr";

export const prices = {
  search: tr.wishes.searchStores,
  searchHint: (stores: number) => `Akakçe, Hepsiburada, Amazon ve ${stores} mağazaya telefonundan bakar.`,
  searching: "Mağazalara bakılıyor…",
  progress: (looked: number, asked: number, found: number) => tr.common.joined(`${looked}/${asked} mağaza`, `${found} sonuç`),
  show: (stores: number) => (stores > 0 ? `Fiyatları Gör · ${stores} mağaza` : "Sonuçları Gör"),
  again: "Yeniden ara",
  none: "Başka mağazada aynısı bulunamadı.",
  title: "Fiyatlar",
  looked: (name: string, stores: number) => tr.common.joined(name, `${stores} mağazaya bakıldı`),
  cheapest: "En ucuz",
  freeShipping: "Kargo bedava",
  saving: (minor: number) => `Bağlantından ${formatMinor(minor)} daha ucuz`,
  tabs: { same: (count: number) => `Aynı ürün · ${count}`, similar: (count: number) => `Benzerleri · ${count}` },
  tabsLabel: "Sonuçlar",
  sameHint: "Aynı ürünü satanlar, en ucuzu üstte. Eklediğin mağaza isteğin bağlantılarına girer.",
  similarHint: "Aynı cins, yakın fiyatlı başka modeller. İsteğine eklenmez; sayfasını açıp bakabilirsin.",
  sameEmpty: "Aynı ürün başka mağazada bulunamadı. Benzerlerine bakabilirsin.",
  similarEmpty: "Benzer bir ürün bulunamadı.",
  suspicious: "Diğerlerinden çok ucuz: ilanı dikkatle oku.",
  mine: "Senin bağlantın",
  add: (shop: string) => `${shop} bağlantısını isteğe ekle`,
  added: (shop: string) => `${shop} isteğe eklendi`,
  open: (shop: string) => `${shop} sayfasını aç`,
  weak: (count: number) => `Az benzer · ${count}`,
  hidden: (count: number) => `Başka cins ${count} sonuç gösterilmedi.`,
  dropTitle: (wish: string) => `${wish} ucuzladı`,
  dropBody: (shop: string, fromMinor: number, toMinor: number) => `${shop}: ${formatMinor(fromMinor)} → ${formatMinor(toMinor)}`,
};
