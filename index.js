// Polyfill: beberapa versi Node belum otomatis menyediakan Web Crypto API
// secara global, padahal Baileys butuh ini. Tanpa ini muncul error
// "crypto is not defined" dan bot gagal minta kode pairing / konek.
const nodeCrypto = require("crypto");
if (!globalThis.crypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");

const config = require("./config");
const { handleMessage } = require("./commands");
const groupFeatures = require("./groupFeatures");

// ISI NOMOR WA BOT DI BAWAH INI (format: 628xxxxxxxxxx, tanpa "+" dan tanpa spasi).
// Contoh: const PHONE_NUMBER_MANUAL = "6281234567890";
// Kalau kosong, bot coba baca dari Variables Railway bernama PHONE_NUMBER.
const PHONE_NUMBER_MANUAL = "6285134217812";

const PHONE_NUMBER = (process.env.PHONE_NUMBER || PHONE_NUMBER_MANUAL).replace(
  /[^0-9]/g,
  ""
);

// Status ini SENGAJA di luar startBot(), supaya tidak ter-reset tiap kali
// bot reconnect otomatis. Reconnect setelah minta kode itu NORMAL di Baileys;
// yang tidak boleh adalah minta kode BARU setiap kali reconnect itu terjadi,
// karena itu bikin kode sebelumnya langsung tidak berlaku sebelum sempat dipakai.
let codeIssued = false;

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
  // Set FORCE_CLEAR_SESSION=true di Railway Variables SEKALI untuk membersihkan
  // total sesi lama yang mungkin tercampur (misal dari percobaan QR sebelumnya),
  // lalu hapus lagi variable ini setelah berhasil tertaut supaya tidak
  // membersihkan sesi terus-menerus di kemudian hari.
  if (process.env.FORCE_CLEAR_SESSION === "true") {
    console.log("[INFO] FORCE_CLEAR_SESSION aktif, membersihkan total sesi lama...");
    clearSession();
    codeIssued = false;
  }

  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestBaileysVersion();

  const usePairingCode = Boolean(PHONE_NUMBER) && !state.creds.registered;

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
    // Nama perangkat yang tampil di WhatsApp. Penting agar kode pairing diterima.
    browser: Browsers.ubuntu(config.BOT_NAME),
  });

  // Minta kode pairing. codeIssued ada di level modul (lihat atas), jadi
  // begitu 1 kode berhasil didapat, reconnect berikutnya TIDAK minta kode baru.
  async function requestCode(attempt = 1) {
    if (codeIssued) return;
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      codeIssued = true;
      console.log("=====================================");
      console.log("KODE PAIRING KAMU: " + code);
      console.log("Masukkan DALAM 60 DETIK ke WhatsApp:");
      console.log("Setelan > Perangkat Tertaut > Tautkan Perangkat");
      console.log("> Tautkan dengan nomor telepon > masukkan kode");
      console.log("=====================================");
    } catch (err) {
      console.error("[WARN] Gagal minta kode pairing (percobaan " + attempt + "):", err.message);
      if (attempt < 3) setTimeout(() => requestCode(attempt + 1), 4000);
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    console.log(
      "[DEBUG] connection.update:",
      connection || "-",
      "| qr:",
      Boolean(qr)
    );

    if (qr) {
      if (usePairingCode) {
        requestCode();
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
        "| alasan:",
        lastDisconnect?.error?.message,
        "| Reconnect:",
        shouldReconnect
      );
      // Reconnect otomatis dengan jeda supaya tidak terlihat seperti
      // percobaan koneksi berulang yang mencurigakan
      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("[INFO] WhatsApp ter-logout. Membersihkan sesi dan minta kode pairing baru...");
        clearSession();
        codeIssued = false;
        setTimeout(startBot, 3000);
      }
    } else if (connection === "open") {
      console.log("[OK] Bot WhatsApp tersambung");
    }
  });

  sock.ev.on("group-participants.update", (update) => {
    groupFeatures.handleParticipantsUpdate(sock, update).catch((err) =>
      console.error("[ERROR] group-participants.update:", err.message)
    );
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
