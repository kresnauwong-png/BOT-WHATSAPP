# WA Downloader Bot

Bot WhatsApp berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) yang meneruskan permintaan ke API downloader multi-platform (Next.js) kamu.

## Setup

1. Install Node.js 18+
2. `npm install`
3. Isi `API_BASE_URL` di `config.js` dengan domain API downloader kamu (yang tadi dibuat di Next.js)
4. `npm start`
5. Scan QR yang muncul di terminal dengan WhatsApp (Perangkat Tertaut)

## Command

- `.menu` — daftar command, `.ping` — cek bot aktif
- `.tiktok` `.instagram` `.facebook` `.pinterest` `.spotify` + `<link>`
- `.upscale <2k|4k|8k>` — kirim/balas foto atau video
- `.fakeff` / `.fakeml` — `<nama> | <uid> | <level>` (uid & level opsional)
- Admin: `.status`, `.ban <nomor>`, `.unban <nomor>` (isi `ADMIN_NUMBERS` di config.js)

Sesuaikan `downloaderApi.js` (path endpoint) dan bagian parsing hasil di `index.js` dengan bentuk response API asli kamu.

## Kenapa akun WA bisa kena banned, dan cara menguranginya secara wajar

WhatsApp mendeteksi & menonaktifkan nomor terutama karena:
1. **Kirim pesan massal ke non-kontak / broadcast tak diminta** (paling sering jadi penyebab banned)
2. Volume pesan terlalu tinggi dalam waktu singkat (perilaku tidak natural)
3. Banyak orang yang block/report nomor tersebut
4. Menggunakan modifikasi WhatsApp (GB WhatsApp dll) — bukan masalah di Baileys/resmi
5. Akun baru langsung dipakai kirim banyak pesan (tanpa "pemanasan")

Yang sudah dipasang di project ini untuk membantu:
- `REPLY_DELAY_MIN_MS` / `MAX` — jeda acak sebelum membalas, supaya tidak terlihat seperti robot yang membalas instan
- `MAX_MESSAGES_PER_MINUTE` — batas kirim pesan global per menit
- `MAX_REQUEST_PER_USER_PER_MINUTE` — mencegah satu user spam command berkali-kali
- Reconnect dengan jeda, bukan reconnect beruntun tanpa henti

Yang **perlu kamu jaga sendiri** di luar kode (paling menentukan):
- Jangan gunakan bot ini untuk mengirim pesan ke nomor yang tidak meminta (broadcast/spam)
- Kalau baru pakai nomor baru, mulai dari trafik kecil dulu selama beberapa hari
- Simpan folder `session/` dengan aman — jangan login banyak device berbeda dengan sesi yang sama
- Pertimbangkan WhatsApp Business API resmi kalau bot ini untuk skala bisnis/komersial, karena lebih stabil & tidak berisiko banned dibanding library tidak resmi seperti Baileys

Tidak ada trik teknis yang bisa membuat WhatsApp tidak pernah menonaktifkan nomor — batasan di atas hanya mengurangi risiko dari perilaku bot yang dianggap wajar oleh sistem mereka.
