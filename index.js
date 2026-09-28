const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const config = require("./config");
const { fetchDownload, detectPlatform } = require("./downloaderApi");
const rateLimiter = require("./rateLimiter");

// Isi nomor WA bot di sini (format:6283834979782)
// atau set via environment variable PHONE_NUMBER di Railway (Settings > Variables).
// Kalau diisi, bot akan pakai kode pairing (lebih stabil di hosting cloud)
// daripada QR code yang sering gagal kalau di-screenshot dari log.
const PHONE_NUMBER = process.env.PHONE_NUMBER || "";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = Boolean(PHONE_NUMBER) && !state.creds.registered;

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  if (usePairingCode) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log("=====================================");
        console.log("KODE PAIRING KAMU:", code);
        console.log("Buka WhatsApp > Perangkat Tertaut >");
        console.log("Tautkan dengan nomor telepon > masukkan kode ini");
        console.log("=====================================");
      } catch (err) {
        console.error("Gagal minta kode pairing:", err.message);
      }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode) {
      console.log("Scan QR berikut dengan WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(
        "Koneksi terputus:",
        statusCode,
        "Reconnect:",
        shouldReconnect
      );
      // Reconnect otomatis dengan jeda supaya tidak terlihat seperti
      // percobaan koneksi berulang yang mencurigakan
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("Logged out. Hapus folder ./session lalu scan ulang.");
      }
    } else if (connection === "open") {
      console.log("[OK] Bot WhatsApp tersambung");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text.startsWith(config.PREFIX)) return;

    const body = text.slice(config.PREFIX.length).trim();
    const [command, ...args] = body.split(/\s+/);
    const url = args[0];

    // ===== Proteksi rate limit (menjaga akun tetap wajar) =====
    if (!rateLimiter.canUserRequest(from)) {
      await safeReply(
        sock,
        from,
        "Tunggu sebentar ya, terlalu banyak permintaan dalam 1 menit."
      );
      return;
    }
    if (!rateLimiter.canSendGlobally()) {
      console.log("Batas kirim global tercapai, pesan ditunda.");
      return;
    }

    const knownCommands = ["tiktok", "ig", "instagram", "fb", "facebook", "pin", "pinterest", "spotify"];

    if (command === "menu") {
      await safeReply(
        sock,
        from,
        [
          "*Menu Bot Downloader*",
          "",
          `${config.PREFIX}tiktok <link>`,
          `${config.PREFIX}instagram <link>`,
          `${config.PREFIX}facebook <link>`,
          `${config.PREFIX}pinterest <link>`,
          `${config.PREFIX}spotify <link>`,
        ].join("\n")
      );
      return;
    }

    if (!knownCommands.includes(command)) return;

    if (!url) {
      await safeReply(sock, from, `Format salah. Contoh: ${config.PREFIX}${command} https://...`);
      return;
    }

    const platform =
      detectPlatform(url) ||
      { ig: "instagram", fb: "facebook", pin: "pinterest" }[command] ||
      command;

    try {
      rateLimiter.recordSend(from);
      if (config.SHOW_TYPING_INDICATOR) {
        await sock.sendPresenceUpdate("composing", from);
      }

      const result = await fetchDownload(platform, url);

      // Jeda acak sebelum membalas — perilaku lebih natural, tidak instan
      await rateLimiter.randomDelay();

      // Sesuaikan bagian ini dengan bentuk response API kamu.
      // Contoh asumsi: { success: true, mediaUrl: "...", caption: "..." }
      if (result?.mediaUrl) {
        await sock.sendMessage(from, {
          video: { url: result.mediaUrl },
          caption: result.caption || "Berhasil diunduh ✅",
        });
      } else {
        await safeReply(sock, from, "Media tidak ditemukan atau link tidak valid.");
      }
    } catch (err) {
      console.error("Error saat fetch API:", err.message);
      await safeReply(
        sock,
        from,
        "Terjadi kesalahan saat mengambil media. Coba lagi beberapa saat."
      );
    }
  });
}

async function safeReply(sock, to, text) {
  await rateLimiter.randomDelay();
  await sock.sendMessage(to, { text });
}

startBot().catch((err) => console.error("Gagal start bot:", err));
