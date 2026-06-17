# Plan: Yerel Sunucu ve Genel İyileştirmeler

TL;DR: Yerel sunucu modundaki oyun mantığı hatalarını (santra, sınırlar, gol sonrası top reset), performans/authoritative model iyileştirmesini (Haxball benzeri yaklaşım) ve istenen UI/UX değişikliklerini (kick/ban swap, sohbet geçmişi, /color komutunun geliştirilmesi, top rengi seçimi, MS/FPS UI, otomatik şut, ayarlar renk kısmının kaldırılması, şut dış çizgisinin paylaşılımı) önceliklendirilmiş adımlarla uygulayacağım.

## Steps
1. Keşif (Discovery) — 1 iş günü (kısa)
   - Repro: Kullanıcının belirttiği hataları adım adım doğrula ve log gerektiren noktaları tespit et.
   - Dosyaları hızlıca tarayıp ilgili bölümlerin yerini not et: `server/Game.js`, `server/Room.js`, `src/engine/Physics.js`, `src/engine/Renderer.js`, `src/engine/InputManager.js`, `src/main.js`, UI bileşenleri.

2. Kritikal Sunucu/Oyun Düzeltmeleri (bloklayıcı, yüksek öncelik)
   A. "Yeni maçta ilk santra kırmızı olsun"
      - Neyi düzelt: `Game.start()` veya maç reset fonksiyonu, `kickOffTeam` atamasının önceki maçın son golüne göre kalıcı hale gelmesi engellenecek; yeni maçta `kickOffTeam = 'red'` olarak set edilecek.
      - Dosyalar: `server/Game.js`, `server/Room.js` (game start/reset logic).
      - Test: yeni maç başlat, önceki maçın son skoru mavi de olsa yeni maçta kickoff kırmızı olsun.

   B. "Santra öncesi sınırları yok sayma" (kickoff constraints)
      - Neyi düzelt: `Physics._applyKickOffConstraints()` veya ilgili kod, kickoff state aktifken oyuncu ve top çarpışmalarına/kısıtlarına kesinlikle uymalı; sınırları kontrol eden koşullar bazı senaryolarda atlanıyorsa düzeltilecek.
      - Dosyalar: `src/engine/Physics.js`, `server/Game.js`.
      - Test: kickoff öncesinde oyuncuların sahadan taşma/duvar geçme denemeleri engellensin.

   C. "Gol sonrası top santraya ışınlanmıyor"
      - Neyi düzelt: goal handler topu merkez koordinatına set edecek, ball velocity sıfırlanacak, kickOffReset flag setlenecek ve server `gameState` broadcast edecek; clientlar render ve physics senkronizasyonu ile beklemeli.
      - Dosyalar: `server/Game.js`, `server/Room.js`, `src/engine/Physics.js`.
      - Test: gol sonrası top merkezde, countdown varsa oyun durup tekrar başlasın.

   D. "Local mode performans / Haxball yaklaşımı"
      - Neyi yapacağız: Haxball'ın local-authority seçeneklerini incele ve iki moddan birini ya da hibritini uygula:
         1) Server-authoritative: server fizik tick'ini çalıştırır; client input'ları gönderir; client interpolation yapılır (daha güvenli).
         2) Admin-authority (local mode): oda kurucusu fizik hesabı yapar, periyodik state'i server'a gönderir; server validate eder ve broadcast eder. Ancak validasyon muhakkak olmalı.
      - Uygulama: Mevcut local-mode implementasyonunu Haxball modeline göre yeniden gözden geçir, paketlenmiş delta mesajları, tick-rate ve reconciliation optimizasyonları uygula.
      - Dosyalar: `server/index.js`, `server/Game.js`, `src/engine/Physics.js`, `src/main.js`.
      - Test: 4-8 client ile yerel odada gecikme ve jitter testleri yap.

3. Gameplay / Feature Geliştirmeleri (orta öncelik)
   - `Auto-kick when hold and ball close`: InputManager'da "kick-hold" state ve Physics içinde mesafe check. (files: `src/engine/InputManager.js`, `src/engine/Physics.js`, `src/main.js`)
   - `Top rengi seçim hakkı`: Room oluşturma UI'ına ball color seçeneği ekle; server bunu stadium/ball config olarak saklayıp zorunlu uygulasın. (files: `src/ui/screens/CreateRoom.js`, `src/ui/screens/RoomLobby.js`, `server/Room.js`)
   - `Şut dış çizgisi diğer oyuncular tarafından görülsün`: disc modeline `charging` veya `kickIntent` bayrağı ekle, server bu state'i broadcast etsin, Renderer tüm clientlarda çizecek. (files: `src/engine/Physics.js`, `server/Game.js`, `src/engine/Renderer.js`)

4. Komutlar / Sohbet (orta öncelik)
   - `/color` komutu: server-side: 1/2/3 renk desteği, angle parametreleri; client preview ile uyumlu hale getirme; haxcolors görsel eşleştirmesi için renk açı matematiği uyumlandırılacak. (files: `server/Room.js`, `src/ui/screens/Settings.js`)
   - Lobby chat persistence: `Room.chat` içine mesaj dizisi tut ve `roomJoin/roomCreated` veya `gameStarted` anında history gönder. (files: `server/Room.js`, `src/ui/components/Chat.js`)

5. UI/UX İyileştirmeleri (düşük-orta öncelik)
   - Ban/Kick buton yer değişimi, modal stilleri ve mesaj kutusu iyileştirmeleri. (files: `src/ui/components/InGameMenu.js`, `src/ui/UIManager.js`, `src/styles/index.css`)
   - MS/FPS HUD'ı görsel olarak zenginleştir. (files: `src/main.js`, `src/styles/index.css`)
   - Ayarlar: renk kısmını kaldır (Settings UI). (files: `src/ui/screens/Settings.js`, `src/ui/components/SettingsModal.js`)

6. Test & QA — adımlı test planı
   - Her büyük değişiklikten sonra lokal olarak test: `node server/index.js` ve `npm run dev` ile client.
   - Senaryolar: kickoff davranışı, kickoff-öncesi sınır, gol sonrası reset, auto-kick, admin renk değişimi, chat persistence.

7. Rollout
   - Küçük, bağımsız commit'ler: (a) kickoff+goal fixes, (b) physics/kick constraints, (c) auto-kick + charging broadcast, (d) local-mode refactor, (e) UI tweaks.
   - Her adımın ardından push/CI ve manuel QA.

**Relevant files**
- `server/Game.js` — match lifecycle, goal handling, kickoff assignment
- `server/Room.js` — room state, teamColors, chat history, admin commands (/color)
- `server/index.js` — tick/transport/validation hooks
- `src/engine/Physics.js` — kickoff constraints, disc model, auto-kick logic
- `src/engine/InputManager.js` — key hold + rebind handling
- `src/engine/Renderer.js` — draw kick outline and theme sync
- `src/main.js` — local authority wiring, HUD updates
- `src/ui/components/Chat.js` — show persisted lobby messages in-game
- `src/ui/components/InGameMenu.js` — ban/kick buttons and improved modals
- `src/ui/screens/CreateRoom.js` & `RoomLobby.js` — ball color selection
- `src/ui/screens/Settings.js`, `src/ui/components/SettingsModal.js` — remove color controls

**Verification**
1. Manual scenarios (smoke tests):
   - New match kickoff always red
   - Kickoff-before-boundaries enforced
   - Goal -> ball centered and game paused/respawn
   - Hold-kick auto-fires when ball in range
   - Admin changes colors -> applied and ball color selection used
   - Chat messages from lobby appear in in-game chat after match start
2. Performance profiling: multiple clients in local room, check FPS and network traffic; tune tick rate and message batching.

**Decisions / Assumptions**
- Server remains authoritative by default; admin-authority (local) mode applied with validation to avoid cheating.
- Some visual parity with Haxball may require adaptive tuning; we'll aim for behavioral parity rather than pixel-perfect visuals.
- No automated test suite exists; we'll rely on scripted/manual tests and logs.

**Further Considerations**
1. Rollout order: fix core game logic bugs first (kickoff, boundaries, goal reset), sonra performans ve UX.
2. Eğer istersen, her adım için PR'ler açıp seni review'a dahil ederim.

Onay verirsen uygulamaya (implementasyona) başlıyorum; adımları küçük commitler halinde yapıp her tamamlandıktan sonra kısa durum raporu vereceğim.
