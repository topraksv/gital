# Değişiklik Kaydı

Her sürümde neyin değiştiği, en yeni üstte. Sürüm numarası `app.json`
içindeki `expo.version`'dır; yeni bir yetenek küçük sürümü, bir düzeltme yamayı,
senden bir şey yapmanı isteyen değişiklik büyük sürümü artırır.

Notlar kısa tutulur: ne değişti, tek cümle. Sebebi ve ölçümü commit'te.
`scripts/release-notes.mjs` bir bölümü etiketinin GitHub sürüm notuna çevirir;
bölümü olmayan sürüm yayımlanamaz.

## 1.4.0

### Minor Changes

- Fotoğraf alanı yeniden çizildi: ürün, istek ve fişte aynı alan; "Fotoğraf çek" ve "Galeriden seç" büyük karolar, fotoğraf varken kaldırma ve değiştirme görselin köşesinde.
- "Bulunamadı" işaretlenince ne olduğu soruluyor: "Hiçbir şey almadım" ya da "Yerine başka bir şey aldım"; ikincisi yerine alınanı ve ödenen fiyatı ister.
- Ekran, Gital açıkken uygulamanın her yerinde açık kalıyor; ayar yalnız telefonda görünüyor.
- Uzun pencereler (katalog, istek) ekranın tepesine yapışmıyor; tutamaçtan ya da başlıktan aşağı çekince kapanıyor.
- İsteğe eklenen bağlantı okunurken satır "Bilgileri okunuyor…" diyor; ad ve fiyat görselden önce geliyor. Webde eklenen isteğin bilgileri, koleksiyon telefonda açılınca kendiliğinden okunuyor.
- Bir mağazanın paylaş metni ("… https://ty.gl/…") yapıştırılınca içindeki bağlantı bulunuyor, yazı not olarak kalıyor.

### Patch Changes

- Gönderilmeden silinip geri alınan bir kayıt artık "Bazı kayıtlar bekliyor" diye takılı kalmıyor. Daha önce takılanlar için Ayarlar → Bekleyen Kayıtlar → Tekrar Dene.

## 1.3.0

### Minor Changes

- Yeni Gital işareti: sepet örgülü, yapraklı G. Uygulama simgesi, açılış ekranı, web simgeleri ve e-postalar bu işaretle geliyor.
- Giriş ekranında işaret kendini çiziyor; "hareketi azalt" açıksa sabit duruyor.
- Gital bağlantısı bir mesaja yapıştırılınca kendi kartıyla görünüyor.

## 1.2.3

### Patch Changes

- Uygulamanın adı Türkçe ekleri doğru alıyor: "Gital'a hoş geldin", "Gital'da", "Gital'ın".
- Kayıt onayı ve e-posta değişikliği e-postaları, şifre yenilemedeki gibi Gital'ın kendi tasarımıyla gidiyor.

## 1.2.2

### Patch Changes

- Bir alana dokununca klavye alanın altında açılıyor, Helix'teki gibi; yazdığın alanı artık kapatmıyor.
- Onay e-postası gönderilemediğinde kayıt "İşlem tamamlanamadı" yerine e-postanın gönderilemediğini söylüyor.

## 1.2.1

### Patch Changes

- "Davet Bağlantısı Oluştur" bazen hiçbir şey göstermiyordu: adın ve olası hata artık panelin içinde soruluyor ve yazılıyor, bağlantı eşitlemeyi beklemeden geliyor.

## 1.2.0

### Minor Changes

- Bir isteğe Trendyol, Hepsiburada ya da Amazon bağlantısı eklenince telefon sayfayı görünmeden açıyor; ürünün adı, resmi ve fiyatı kendiliğinden geliyor, senin yazdığın hiçbir şeyin üstüne yazılmıyor.

## 1.1.0

### Minor Changes

- Biten bir alışverişin fişinin fotoğrafı, Geçmiş'teki sayfasından çekilip ya da seçilip saklanıyor; listenin her üyesi görüyor.
- Giriş, çıkış, hesap dondurma ve silme sürerken Helix'teki gibi, işlemin adını ve kendi rengini taşıyan, nefes alan bir bekleme ekranı gösteriliyor.
- Hesap ve Güvenlik'teki "Önceki giriş" satırı hangi cihazdan girildiğini de söylüyor ("iPhone · Safari", "bu cihaz"); hesabın bütün cihazları sayılıyor.
- Gital'ın kendi logosu var: alevler içinde hızla giden bir market arabası; uygulama simgesi, web simgeleri ve giriş ekranında alevleri kıpırdayan hâli.
- Yeni bir liste adına göre resmini kendisi seçiyor: "Pazar" sebze, "Eczane" eczane; listenin panelinden yine değiştirilebiliyor.
- İstek koleksiyonu açık istekleri önceliğe, en ucuza ya da en pahalıya göre sıralıyor.
- Kiler bir liste gibi kullanılıyor: sürükleyerek sıralanıyor, mesajdan yapıştırılıyor, katalogdan ya da bir setten dolduruluyor, metin olarak paylaşılıyor ve bir ürün listeye gitmeden panelinden çıkarılabiliyor.
- Kiler ve İstekler de yazarken öneri veriyor: Kiler'de ürünler, İstekler'de daha önce yazılan istekler.
- Alışverişte ekranın açık kalıp kalmayacağı Ayarlar'dan seçiliyor.

### Patch Changes

- Paylaşım güncellemesinden sonra açılan liste sunucuya ulaşmıyordu ve davet "yalnız sahip gönderebilir" diyordu; artık liste gidiyor ve davet bağlantısı çalışıyor.
- Davet tek bir bağlantı: tamamı görünüyor ve listeden paylaşılıyor.
- Ekleme alanı ve düğmeleri her ekranda aynı yükseklikte; Kiler'de bir tane kalan üründe − görünmüyor.
- Dar ekranda Eşitle düğmesi satırının altına kaymıyor, yanında kalıyor.
- Kiler'in katalog düğmesi listedeki gibi + düğmesinin önünde; set düğmesi hangi seti eklediğini söylüyor.

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
