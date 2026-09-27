# Değişiklik Kaydı

Her sürümde neyin değiştiği, en yeni üstte. Sürüm numarası `app.json`
içindeki `expo.version`'dır; yeni bir yetenek küçük sürümü, bir düzeltme yamayı,
senden bir şey yapmanı isteyen değişiklik büyük sürümü artırır.

Notlar kısa tutulur: ne değişti, tek cümle. Sebebi ve ölçümü commit'te.
`scripts/release-notes.mjs` bir bölümü etiketinin GitHub sürüm notuna çevirir;
bölümü olmayan sürüm yayımlanamaz.

## 1.0.0

### Minor Changes

- Listeler: liste açılıyor, yeniden adlandırılıyor, siliniyor; silme altı saniye geri alınabiliyor; her listenin rengi ve yirmi çizimden bir resmi var.
- Tek alan "2 kg domates, 1,5 lt süt ve ekmek" yazısını miktarlarıyla üç ürün olarak ekliyor; yazarak da söyleyerek de.
- İşaretlenen ürün üstü çizili "Sepette" grubuna iniyor; telefonda sağa kaydırmak işaretliyor, sola kaydırmak siliyor.
- Ürünün paneli not, marka, "Acil", "Bulunamadı", "Yerine: …", fiyat, fotoğraf, reyon, başka listeye taşıma ya da kopyalama alıyor.
- "Alışverişi Bitir" sepettekileri Geçmiş'e taşıyor, alınmayanlar listede kalıyor; bitiş konfeti ve ayın özetiyle kutlanıyor.
- Geçmiş biten alışverişleri, harcananı, altı aylık toplamları ve reyonların payını gösteriyor; her ürün tek dokunuşla listesine dönüyor.
- Yazarken evin daha önce aldıkları ve yaklaşık 350 ürünlük katalog öneriliyor; "sut" Süt'ü, "domtes" Domates'i buluyor.
- Katalog reyon reyon açılıyor; ürünler yıldızlanıyor, "Kahvaltı" gibi setler tek dokunuşla listeye ekleniyor.
- Liste market sırasına göre reyonlara ayrılıyor, sürükleyerek sıralanıyor, metin olarak paylaşılıyor ve yapıştırılan bir mesajı okuyor.
- Fiyat ve toplam Helix'in hesap makinesiyle hesaplanıyor; son alışlardan pahalı bir fiyat işaretleniyor.
- Liste kendi geçmişinden biteni öneriyor ("Süt · 5 günde bir").
- Kiler evde olanı reyon reyon tutuyor: biten alışveriş dolduruyor, − kullanıyor, biten ürün listesine dönüyor; son kullanma tarihi geri sayıyor.
- İstekler koleksiyonlarda tutuluyor: ad ya da Trendyol, Hepsiburada, Amazon bağlantısı; öncelik, tahmini fiyat, birkaç mağazanın fiyatı ve istenen gün.
- Telefonda barkod okutunca ürünün adı, markası ve resmi Open Food Facts'ten geliyor.
- Hatırlatıcılar: haftalık alışveriş günü, kilerde tarihi yaklaşan ürün, bitmiş olabilecek ürün, istenen gün.
- Hesap: e-posta onaylı kayıt, giriş, şifre yenileme, e-posta ve şifre değiştirme, dondurma, veri sıfırlama ve silme; ekranlar Helix'in.
- Listeler, ürünler, setler, kiler ve fotoğraflar hesabın bütün cihazları arasında eşitleniyor; önce cihazda, bağlantı gelince bulutta.
- Liste ve istek koleksiyonu davet bağlantısıyla paylaşılıyor: düzenleyebilir ya da yalnız görür; değişiklikler saniyeler içinde geliyor, kimin eklediği ve aldığı görünüyor.
- Ayarlar tema (Sistem, Açık, Koyu) ve Helix'in üç paletini seçiyor, geri bildirim ekran görüntüleriyle gönderiliyor, tanıtım turu yeniden oynatılıyor.
- Aydınlatma Metni kayıttan, geri bildirimden ve Ayarlar'dan açılıyor; hesap onu kabul etmeden açılmıyor.
- Web uygulaması https://topraksv.github.io/gital/ adresinde; ana ekrana eklenip bağlantısız da açılıyor.
