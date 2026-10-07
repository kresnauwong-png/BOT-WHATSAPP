const fs = require("fs");
const path = require("path");

// Disimpan sebagai file JSON. Kalau Railway tidak punya Volume terpasang di
// folder ini, data akan RESET tiap bot restart/redeploy — sama seperti
// sesi WhatsApp dulu. Kalau mau permanen, pasang Volume (Settings > Volumes)
// dengan mount path yang sama dengan folder DATA_DIR di bawah.
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "economy.json");

const CLAIM_AMOUNT_MIN = 50;
const CLAIM_AMOUNT_MAX = 200;
const RESET_HOUR_WIB = 6; // reset jam 06:00 waktu Indonesia Barat (UTC+7)

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (err) {
    console.error("[WARN] Gagal simpan data poin:", err.message);
  }
}

// "Hari klaim" dihitung mulai jam 06:00 WIB, bukan jam 00:00, supaya
// cocok sama permintaan reset jam 6 pagi.
function claimDayKey(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000); // geser ke UTC+7
  if (wib.getUTCHours() < RESET_HOUR_WIB) {
    wib.setUTCDate(wib.getUTCDate() - 1);
  }
  return wib.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getUser(uid) {
  const data = load();
  return data[uid] || { points: 0, lastClaimDay: null };
}

function claim(uid) {
  const data = load();
  const user = data[uid] || { points: 0, lastClaimDay: null };
  const today = claimDayKey();

  if (user.lastClaimDay === today) {
    return { ok: false, user };
  }

  const amount = Math.floor(Math.random() * (CLAIM_AMOUNT_MAX - CLAIM_AMOUNT_MIN + 1)) + CLAIM_AMOUNT_MIN;
  user.points += amount;
  user.lastClaimDay = today;
  data[uid] = user;
  save(data);
  return { ok: true, amount, user };
}

function addPoints(uid, amount) {
  const data = load();
  const user = data[uid] || { points: 0, lastClaimDay: null };
  user.points = Math.max(0, user.points + amount);
  data[uid] = user;
  save(data);
  return user;
}

// Slot sederhana: 3 simbol, menang kalau ada kombinasi cocok
const SYMBOLS = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
const MULTIPLIER = { "🍒": 2, "🍋": 3, "🍇": 4, "🔔": 6, "💎": 10, "7️⃣": 20 };

function spinSlot(uid, bet) {
  const user = getUser(uid);
  if (bet <= 0 || !Number.isFinite(bet)) {
    return { ok: false, reason: "invalid_bet", user };
  }
  if (user.points < bet) {
    return { ok: false, reason: "not_enough", user };
  }

  const reels = [0, 0, 0].map(() => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  const win = reels[0] === reels[1] && reels[1] === reels[2];
  const delta = win ? bet * MULTIPLIER[reels[0]] - bet : -bet;

  const updated = addPoints(uid, delta);
  return { ok: true, reels, win, delta, user: updated };
}

module.exports = { getUser, claim, addPoints, spinSlot, claimDayKey, RESET_HOUR_WIB };
