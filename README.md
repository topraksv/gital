<div align="center">

# Gital

### Evin alışveriş listesi — birlikte, internetsiz de.

**Paylaşılan market listeleri, daha önce aldıklarının hafızası, favoriler,**
**hazır setler ve linkten, fotoğraftan eklenen bir istek listesi.**

*A shared, offline-first shopping list for a household — lists two people tick
together in the aisle, a memory of what was bought before, and a wish list fed
by links and photos. iOS, Android and the web from one codebase.*

[![ci](https://github.com/topraksv/gital/actions/workflows/ci.yml/badge.svg)](https://github.com/topraksv/gital/actions/workflows/ci.yml)
[![Expo SDK 57](https://img.shields.io/badge/Expo-SDK%2057-0F0F0D?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v57.0.0/)
[![Node 22](https://img.shields.io/badge/Node-22-0F0F0D?logo=nodedotjs&logoColor=5FA04E)](#geliştirici-kurulumu)
[![Proprietary](https://img.shields.io/badge/license-proprietary-2F6B4F)](LICENSE)

</div>

---

## Durum

Planlama aşamasında. Ortam, teslim hattı ve ürün tanımı kuruluyor; uygulama
henüz kullanılabilir değil. İlk sürüm yayımlandığında bağlantısı burada olacak.

## Geliştirici kurulumu

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"   # .nvmrc: Node 22
npm ci
npm run verify        # tipler, testler, lint ratchet
npx expo start        # geliştirme sunucusu
```

## Lisans

Tescilli. Kaynak şeffaflık ve referans amacıyla yayımlanır; kullanım, kopyalama
ve türev çalışma izne tabidir. Ayrıntı: [LICENSE](LICENSE).
