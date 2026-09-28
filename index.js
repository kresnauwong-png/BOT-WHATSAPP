const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const config = require("./config");
const { handleMessage } = require("./commands");

// ISI NOMOR WA BOT DI BAWAH INI (format: 628xxxxxxxxxx, tanpa "+" dan tanpa spasi).
// Contoh: const PHONE_NUMBER_MANUAL = "6281234567890";
// Kalau kosong, bot coba baca dari Variables Railway bernama PHONE_NUMBER.
const PHONE_NUMBER_MANUAL = "6283834979782";

const PHONE_NUMBER = (process.env.PHONE_NUMBER || PHONE_NUMBER_MANUAL).replace(
  /[^0-9]/g,
  ""
);

// Hapus isi folder session (bukan folder-nya, karena bisa jadi Volume Railway)
function clearSession() {
  const dir = path.join(__dirname, "session");
  try {
    for (const f of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }
    console.log("[INFO] Sesi lama dibersihkan.");
  } catch (err) {
    console.error("[WARN] Gagal membersihkan sesi:", err.message);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = Boolean(PHONE_NUMBER) && !state.creds.registered;
  let pairingRequested = false;

  // Log diagnosis supaya jelas bot lagi pakai mode apa
  console.log(
    "[INFO] Mode login:",
    usePairingCode
      ? "PAIRING CODE (nomor: " + PHONE_NUMBER + ")"
      : PHONE_NUMBER
      ? "sudah terdaftar / sesi lama ada"
      : "QR (PHONE_NUMBER kosong, isi dulu!)"
  );

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (usePairingCode) {
        if (!pairingRequested) {
          pairingRequested = true;
          sock
            .requestPairingCode(PHONE_NUMBER)
            .then((code) => {
              console.log("=====================================");
              console.log("KODE PAIRING KAMU: " + code);
              console.log("WhatsApp > Perangkat Tertaut > Tautkan Perangkat");
              console.log("> Tautkan dengan nomor telepon > masukkan kode");
              console.log("=====================================");
            })
            .catch((err) =>
              console.error("Gagal minta kode pairing:", err.message)
            );
        }
      } else {
        console.log("Scan QR berikut dengan WhatsApp:");
        qrcode.generate(qr, { small: true });
      }
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
        console.log("[INFO] WhatsApp ter-logout. Membersihkan sesi dan minta kode pairing baru...");
        clearSession();
        setTimeout(startBot, 3000);
      }
    } else if (connection === "open") {
      console.log("[OK] Bot WhatsApp tersambung");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log("[DEBUG] pesan masuk, type:", type, "jumlah:", messages.length);
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg?.message) continue;
      if (msg.key.fromMe) {
        console.log("[DEBUG] diabaikan: pesan dari nomor bot sendiri (tes pakai nomor lain)");
        continue;
      }
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error("[ERROR] handler:", err.message);
      }
    }
  });
}

startBot().catch((err) => console.error("Gagal start bot:", err));
