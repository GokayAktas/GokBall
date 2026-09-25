# ⚽ GokBall

**GokBall**, tarayıcıda çalışan ücretsiz, gerçek zamanlı çok oyunculu bir futbol oyunudur. Klasik HaxBall tarzı 2D top oyununu modern bir arayüzle sunar: bir oda oluştur, arkadaşlarınla aynı odaya katıl, kırmızı ve mavi takımlara ayrıl ve gol atmak için mücadele et. Kurulum gerekmez — tarayıcıdan [gokball.vercel.app](https://gokball.vercel.app/) adresine gir ve oynamaya başla.

## Özellikler

- **Gerçek zamanlı maçlar** — 60Hz fizik motoru, istemci tarafı tahmin (client prediction) ve snapshot interpolasyonu ile akıcı, düşük gecikmeli oyun deneyimi
- **Oda sistemi** — Oda oluşturma, oda listesinden gezinme, şifreli odalar
- **Takımlar ve izleyiciler** — Kırmızı/Mavi takımlarına katıl veya kamera arkasından izle
- **Forma seçimi** — Süper Lig ve dünya kulüplerinden hazır forma renkleri
- **Canlı sohbet** — Maç içi sohbet, gol duyuruları ve sistem mesajları
- **Maç istatistikleri** — Gol, asist, kurtarış ve maç sonu MVP sıralaması
- **Maç ayarları** — Skor limiti, süre limiti, oyun hızı, uzatma ve farklı stadyum haritaları
- **Kişiselleştirme** — Takma ad, tuş atamaları, zoom ve görsel ayarlar
- **Ses efektleri** — Vuruş ve gol sesleri

## Kontroller

| Tuş | Aksiyon |
| --- | --- |
| `W` / `↑` | Yukarı |
| `S` / `↓` | Aşağı |
| `A` / `←` | Sol |
| `D` / `→` | Sağ |
| `X` / `Space` | Vuruş (şut) |
| `P` | Oyunu duraklat / devam et (oda sahibi) |
| `Enter` | Sohbet |

Tüm tuşlar oyun içi **Ayarlar** ekranından yeniden atanabilir.

## Teknoloji

| Katman | Teknoloji |
| --- | --- |
| İstemci | Vanilla JavaScript, Vite, HTML5 Canvas |
| Sunucu | Node.js, Express, Socket.IO |
| Ağ | Sunucu otoriter fizik + oda sahibi (host-authority) modu, client prediction, snapshot interpolasyon |

### Mimari

- Oyun mantığı sunucuda ve oda sahibinin istemcisinde çalışır; diğer istemciler kendi oyuncusunu tahmin eder (prediction) ve diğer oyuncuları snapshot interpolasyonu ile çizer.
- Oda sahibi sekmesini arka plana alırsa fizik döngüsü `setInterval` yedeğiyle çalışmaya devam eder.
- Tekilleştirme (reconciliation) için girdi geçmişi ve sıra numaraları kullanılır.

## Kurulum

Gereksinimler: **Node.js 18+**

```bash
# Depoyu klonla
git clone https://github.com/GokayAktas/GokBall.git
cd GokBall

# Bağımlılıkları yükle
npm install

# 1. terminal: oyun sunucusunu başlat (port 3001)
npm run server

# 2. terminal: geliştirme istemcisini başlat (port 3000)
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini aç ve oyna.

### Üretim derlemesi

```bash
npm run build      # dist/ klasörüne derler
npm start          # Express + Socket.IO sunucusu derlenmiş istemciyi sunar
```

Ağ yapılandırması için ortam değişkenleri: `VITE_SERVER_URL`, `CLIENT_ORIGINS`, `ALLOW_ALL_ORIGINS`, `FORCE_WEBSOCKET` (bkz. `server/index.js`).

## Proje Yapısı

```
src/            İstemci kodu (UI ekranları, oyun motoru, ağ katmanı)
  engine/       Fizik, Renderer, Camera, InputManager, AudioManager
  ui/           Ekranlar (MainMenu, RoomList, CreateRoom, RoomLobby, Settings)
  network/      NetworkManager, SnapshotBuffer
server/         Node.js + Socket.IO oyun sunucusu
public/         Statik dosyalar (logo, favicon, sitemap, robots)
maps/           Stadyum/harita tanımları
```

## Katkı

Katkılara açıktır! Bir issue aç ya da pull request gönder.

## Lisans

Tüm hakları saklıdır © 2026 GokBall
