module.exports = {
  // Ganti dengan base URL API downloader kamu (project Next.js yang sudah dibuat)
  API_BASE_URL: process.env.API_BASE_URL || "https://api-domain-kamu.com",

  // Prefix command, misal: .tiktok <link>
  PREFIX: ".",

  // Nomor admin (format: 62812xxxxxxx@s.whatsapp.net) yang boleh pakai command khusus
  ADMIN_NUMBERS: [
    // "6281234567890@s.whatsapp.net",
  ],

  // ===== PENGATURAN ANTI-BAN / MENJAGA KESEHATAN AKUN =====
  // Ini BUKAN cara membypass deteksi WhatsApp, melainkan praktik wajar
  // supaya bot berperilaku seperti pengguna manusia biasa & tidak memicu
  // sistem anti-spam WhatsApp.

  // Jeda minimum & maksimum (ms) sebelum bot membalas pesan
  REPLY_DELAY_MIN_MS: 800,
  REPLY_DELAY_MAX_MS: 2500,

  // Maksimal pesan yang boleh dikirim bot per menit (global)
  MAX_MESSAGES_PER_MINUTE: 20,

  // Maksimal request per user per menit (mencegah 1 user spam command)
  MAX_REQUEST_PER_USER_PER_MINUTE: 5,

  // Tampilkan status "mengetik..." sebelum membalas (perilaku manusiawi)
  SHOW_TYPING_INDICATOR: true,
};
