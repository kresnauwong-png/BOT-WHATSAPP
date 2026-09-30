const onlyDigits = (s) => String(s).replace(/[^0-9]/g, "");

module.exports = {
  // Alamat API downloader kamu (yang di Vercel), tanpa "/" di akhir
  API_BASE_URL: process.env.API_BASE_URL || "https://api-domain-kamu.com",

  // Awalan command, misal: .menu
  PREFIX: ".",

  // Nomor ADMIN (bukan nomor bot!). Format 628xxxxxxxxxx tanpa "+".
  // Bisa juga lewat Variables Railway: ADMIN_NUMBERS=628111,628222
  ADMIN_NUMBERS: [
    // "6281234567890",
    ...(process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(",") : []),
  ]
    .map(onlyDigits)
    .filter(Boolean),

  // Path endpoint di API kamu. SESUAIKAN dengan route di project Next.js.
  ENDPOINTS: {
    tiktok: "/api/download/tiktok",
    instagram: "/api/download/instagram",
    facebook: "/api/download/facebook",
    pinterest: "/api/download/pinterest",
    spotify: "/api/download/spotify",
    upscale: "/api/upscale",
    fakeLobbyFF: "/api/fake-lobby/freefire",
    fakeLobbyML: "/api/fake-lobby/mobilelegends",
    // Fitur baru di bawah ini BELUM ada di API kamu — isi path-nya kalau sudah dibuat.
    // Sebelum diisi, command-command ini otomatis membalas "belum tersedia".
    removeBg: "",
    ytmp3: "",
    ytmp4: "",
  },

  // Batas ukuran file untuk upscale / hapus background (MB)
  MAX_UPLOAD_MB: 20,

  // Foto/video pembuka yang ikut dikirim bersama .menu. Kosongkan (undefined)
  // kalau belum punya videonya — nanti tinggal isi salah satu:
  // MENU_MEDIA_TYPE: "video", MENU_MEDIA_URL: "https://link-video-kamu.mp4"
  MENU_MEDIA_TYPE: process.env.MENU_MEDIA_TYPE || "", // "image" | "video" | ""
  MENU_MEDIA_URL: process.env.MENU_MEDIA_URL || "",

  // Ditampilkan di .owner
  OWNER_NAME: process.env.OWNER_NAME || "Owner Bot",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "6285134217812",

  // ===== AI Chat (.ai <pertanyaan>) =====
  // Ambil API key gratis di https://console.anthropic.com lalu isi di
  // Variables Railway dengan nama ANTHROPIC_API_KEY. Tanpa ini, .ai tidak jalan.
  AI_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  AI_MODEL: process.env.AI_MODEL || "claude-haiku-4-5-20251001",
  // Berapa pasang pesan terakhir yang diingat bot per chat (biar ada konteks)
  AI_HISTORY_LIMIT: 6,

  // Maksimal foto yang dikirim sekaligus (misal album Pinterest / slide TikTok)
  MAX_IMAGES: 5,

  // ===== PENGATURAN MENJAGA KESEHATAN AKUN =====
  REPLY_DELAY_MIN_MS: 800,
  REPLY_DELAY_MAX_MS: 2500,
  MAX_MESSAGES_PER_MINUTE: 20,
  MAX_REQUEST_PER_USER_PER_MINUTE: 5,
  SHOW_TYPING_INDICATOR: true,
};
