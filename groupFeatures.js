// Pengaturan per grup disimpan di memori (hilang kalau bot restart).
// Kalau mau permanen, ini bisa disambungkan ke file/database nanti.
const antilinkGroups = new Set(); // grup dengan antilink AKTIF
const welcomeOffGroups = new Set(); // grup dengan welcome DIMATIKAN (default: aktif)

const LINK_RE = /(https?:\/\/|chat\.whatsapp\.com|wa\.me\/)/i;

async function isGroupAdmin(sock, groupJid, userJid) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const p = meta.participants.find((x) => x.id === userJid);
    return Boolean(p && (p.admin === "admin" || p.admin === "superadmin"));
  } catch {
    return false;
  }
}

// Mengembalikan true kalau pesan dihapus (supaya command tidak diproses lagi)
async function handleAntilink(sock, msg, text) {
  const from = msg.key.remoteJid;
  if (!from.endsWith("@g.us")) return false;
  if (!antilinkGroups.has(from)) return false;
  if (!LINK_RE.test(text)) return false;

  const sender = msg.key.participant || from;
  if (await isGroupAdmin(sock, from, sender)) return false; // admin dikecualikan

  try {
    await sock.sendMessage(from, { delete: msg.key });
  } catch (err) {
    console.error("[WARN] Gagal hapus pesan antilink:", err.message);
  }
  try {
    await sock.sendMessage(from, {
      text: `@${sender.split("@")[0]} pesan dihapus, antilink aktif di grup ini.`,
      mentions: [sender],
    });
  } catch {}
  return true;
}

async function handleParticipantsUpdate(sock, update) {
  const { id: groupJid, participants, action } = update;
  if (!groupJid.endsWith("@g.us") || welcomeOffGroups.has(groupJid)) return;

  let meta;
  try {
    meta = await sock.groupMetadata(groupJid);
  } catch {
    return;
  }

  for (const p of participants) {
    const tag = "@" + p.split("@")[0];
    const text =
      action === "add"
        ? `Selamat datang ${tag} di *${meta.subject}*! Ketik .menu untuk lihat fitur bot.`
        : action === "remove"
        ? `${tag} telah keluar/dikeluarkan dari grup.`
        : null;
    if (!text) continue;
    try {
      await sock.sendMessage(groupJid, { text, mentions: [p] });
    } catch (err) {
      console.error("[WARN] Gagal kirim welcome/goodbye:", err.message);
    }
  }
}

module.exports = {
  antilinkGroups,
  welcomeOffGroups,
  isGroupAdmin,
  handleAntilink,
  handleParticipantsUpdate,
};
