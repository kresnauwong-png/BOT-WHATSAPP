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
  },

  // Batas ukuran file untuk upscale (MB)
  MAX_UPLOAD_MB: 20,

  // Maksimal foto yang dikirim sekaligus (misal album Pinterest / slide TikTok)
  MAX_IMAGES: 5,

  // ===== PENGATURAN MENJAGA KESEHATAN AKUN =====
  REPLY_DELAY_MIN_MS: 800,
  REPLY_DELAY_MAX_MS: 2500,
  MAX_MESSAGES_PER_MINUTE: 20,
  MAX_REQUEST_PER_USER_PER_MINUTE: 5,
  SHOW_TYPING_INDICATOR: true,
};
