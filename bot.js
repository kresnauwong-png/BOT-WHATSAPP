const { Telegraf } = require("telegraf");
const axios = require("axios");
const QRCode = require("qrcode");
const sharp = require("sharp");

const config = require("./config");
const api = require("./downloaderApi");
const rateLimiter = require("./rateLimiter");
const economy = require("./economy");

if (!config.BOT_TOKEN) {
  console.error("[FATAL] BOT_TOKEN kosong. Isi lewat Railway Variables (Settings > Variables).");
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// Pengaturan grup disimpan di memori (hilang kalau bot restart)
const antilinkChats = new Set();
const welcomeOffChats = new Set();
const LINK_RE = /(https?:\/\/|t\.me\/)/i;

const DEFAULT_TYPE = {
  tiktok: "video",
  instagram: "video",
  facebook: "video",
  pinterest: "image",
  spotify: "audio",
};

// ---------- Helper ----------
function isAdmin(ctx) {
  return config.ADMIN_IDS.includes(String(ctx.from.id));
}

async function isChatAdmin(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

function argsOf(ctx) {
  const text = ctx.message?.text || "";
  return text.split(/\s+/).slice(1);
}

async function reply(ctx, text) {
  await rateLimiter.randomDelay();
  await ctx.reply(text, { reply_parameters: { message_id: ctx.message.message_id } });
}

async function sendUrlMedia(ctx, item, caption) {
  await rateLimiter.randomDelay();
  if (item.type === "video") return ctx.replyWithVideo(item.url, { caption });
  if (item.type === "audio") return ctx.replyWithAudio(item.url, { caption });
  return ctx.replyWithPhoto(item.url, { caption });
}

async function sendBuffer(ctx, buffer, mime, caption) {
  await rateLimiter.randomDelay();
  const file = { source: buffer };
  if (mime.startsWith("video/")) return ctx.replyWithVideo(file, { caption });
  if (mime.startsWith("audio/")) return ctx.replyWithAudio(file, { caption });
  return ctx.replyWithPhoto(file, { caption });
}

async function deliver(ctx, result, defaultType, defaultCaption) {
  if (result.kind === "binary") {
    return sendBuffer(ctx, result.buffer, result.mime, defaultCaption);
  }
  const { items, caption } = api.extractMedia(result.data, defaultType);
  if (!items.length) return reply(ctx, "Media tidak ditemukan atau link tidak valid.");
  for (let i = 0; i < items.length; i++) {
    await sendUrlMedia(ctx, items[i], i === 0 ? caption || defaultCaption : undefined);
  }
}

// Pembungkus: cek rate limit, kirim status "mengetik", tangani error
async function work(ctx, fn) {
  const uid = String(ctx.from.id);
  if (!rateLimiter.canUserRequest(uid)) {
    return reply(ctx, "Tunggu sebentar ya, terlalu banyak permintaan dalam 1 menit.");
  }
  rateLimiter.recordSend(uid);
  try {
    await ctx.sendChatAction("typing");
    await fn();
  } catch (err) {
    console.error("[ERROR]", err.message);
    await reply(ctx, "Terjadi kesalahan saat memproses. Coba lagi beberapa saat.");
  }
}

function notConfigured(ctx, endpointKey) {
  return reply(ctx, `Fitur ini belum tersedia — endpoint "${endpointKey}" belum diisi di config.js.`);
}

// ---------- Downloader ----------
function registerDownload(cmd, platform) {
  bot.command(cmd, async (ctx) => {
    const url = argsOf(ctx)[0];
    if (!url) return reply(ctx, `Contoh: /${cmd} https://...`);
    const target = api.detectPlatform(url) || platform;
    await work(ctx, async () => {
      const result = await api.fetchDownload(target, url);
      await deliver(ctx, result, DEFAULT_TYPE[target] || "video", "Berhasil diunduh");
    });
  });
}
registerDownload("tiktok", "tiktok");
registerDownload("instagram", "instagram");
registerDownload("ig", "instagram");
registerDownload("facebook", "facebook");
registerDownload("fb", "facebook");
registerDownload("pinterest", "pinterest");
registerDownload("pin", "pinterest");
registerDownload("spotify", "spotify");

bot.command(["ytmp3", "ytmp4"], async (ctx) => {
  const cmd = ctx.message.text.slice(1).split(/\s+/)[0].toLowerCase();
  const endpointKey = cmd === "ytmp3" ? "ytmp3" : "ytmp4";
  if (!config.ENDPOINTS[endpointKey]) return notConfigured(ctx, endpointKey);
  const url = argsOf(ctx)[0];
  if (!url) return reply(ctx, `Contoh: /${cmd} https://youtu.be/xxxx`);
  await work(ctx, async () => {
    const result = await api.callApi(endpointKey, { params: { url }, timeout: 120000 });
    await deliver(ctx, result, cmd === "ytmp3" ? "audio" : "video", "Selesai");
  });
});

// ---------- Tools ----------
function findPhotoFileId(ctx) {
  const m = ctx.message;
  const source = m.photo ? m : m.reply_to_message?.photo ? m.reply_to_message : null;
  if (!source) return null;
  const sizes = source.photo;
  return sizes[sizes.length - 1].file_id;
}

bot.command(["upscale", "hd"], async (ctx) => {
  const scale = (argsOf(ctx)[0] || "4k").toLowerCase();
  if (!["2k", "4k", "8k"].includes(scale)) {
    return reply(ctx, "Pilihan resolusi: 2k, 4k, atau 8k.\nContoh: /upscale 8k");
  }
  const fileId = findPhotoFileId(ctx);
  if (!fileId) {
    return reply(ctx, `Kirim foto dengan caption /upscale ${scale}, atau balas foto dengan /upscale ${scale}.`);
  }
  await work(ctx, async () => {
    await reply(ctx, `Sedang diproses ke ${scale.toUpperCase()}, mohon tunggu...`);
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await axios.get(link.href, { responseType: "arraybuffer", timeout: 30000 });
    const buffer = Buffer.from(res.data);
    if (buffer.length > config.MAX_UPLOAD_MB * 1024 * 1024) {
      return reply(ctx, `File terlalu besar. Maksimal ${config.MAX_UPLOAD_MB} MB.`);
    }
    const result = await api.upscaleMedia(buffer, "image/jpeg", scale);
    await deliver(ctx, result, "image", `Upscale ${scale.toUpperCase()} selesai`);
  });
});

bot.command("removebg", async (ctx) => {
  if (!config.ENDPOINTS.removeBg) return notConfigured(ctx, "removeBg");
  const fileId = findPhotoFileId(ctx);
  if (!fileId) return reply(ctx, "Kirim foto dengan caption /removebg, atau balas foto dengan /removebg.");
  await work(ctx, async () => {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await axios.get(link.href, { responseType: "arraybuffer", timeout: 30000 });
    const buffer = Buffer.from(res.data);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "image/jpeg" }), "input.jpg");
    const result = await api.callApi("removeBg", { method: "post", body: form, timeout: 60000 });
    await deliver(ctx, result, "image", "Selesai");
  });
});

bot.command(["sticker", "stiker", "s"], async (ctx) => {
  const fileId = findPhotoFileId(ctx);
  if (!fileId) return reply(ctx, "Kirim foto dengan caption /sticker, atau balas foto dengan /sticker.");
  await work(ctx, async () => {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await axios.get(link.href, { responseType: "arraybuffer", timeout: 30000 });
    const webp = await sharp(Buffer.from(res.data))
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp()
      .toBuffer();
    await rateLimiter.randomDelay();
    await ctx.replyWithSticker({ source: webp });
  });
});

bot.command("qr", async (ctx) => {
  const text = argsOf(ctx).join(" ");
  if (!text) return reply(ctx, "Contoh: /qr Halo dunia");
  await work(ctx, async () => {
    const buffer = await QRCode.toBuffer(text, { width: 512, margin: 1 });
    await rateLimiter.randomDelay();
    await ctx.replyWithPhoto({ source: buffer }, { caption: "QR code kamu" });
  });
});

bot.command(["shorten", "short"], async (ctx) => {
  const url = argsOf(ctx)[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    return reply(ctx, "Contoh: /shorten https://contoh.com/link-panjang");
  }
  await work(ctx, async () => {
    const res = await axios.get("https://is.gd/create.php", {
      params: { format: "simple", url },
      timeout: 15000,
    });
    const short = String(res.data).trim();
    if (!short.startsWith("http")) throw new Error(short);
    await reply(ctx, `Link pendek: ${short}`);
  });
});

// ---------- Game ----------
async function fakeLobby(ctx, game) {
  const [name, uid, level] = argsOf(ctx).join(" ").split("|").map((s) => s.trim());
  if (!name) {
    return reply(
      ctx,
      `Contoh:\n/${ctx.message.text.slice(1).split(/\s+/)[0]} Nama Kamu\n/${ctx.message.text
        .slice(1)
        .split(/\s+/)[0]} Nama Kamu | 123456789 | 70`
    );
  }
  const params = { name };
  if (uid) params.uid = uid;
  if (level) params.level = level;
  await work(ctx, async () => {
    const result = await api.fakeLobby(game, params);
    await deliver(ctx, result, "image", "Selesai");
  });
}
bot.command("fakeff", (ctx) => fakeLobby(ctx, "ff"));
bot.command("fakeml", (ctx) => fakeLobby(ctx, "ml"));

// ---------- AI ----------
bot.command(["ai", "tanya"], async (ctx) => {
  const question = argsOf(ctx).join(" ");
  if (!question) return reply(ctx, "Contoh: /ai Apa itu fotosintesis?");
  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(ctx, "Fitur AI belum aktif. Admin bot perlu mengisi ANTHROPIC_API_KEY di Railway Variables.");
  }
  await work(ctx, async () => {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      { model: config.AI_MODEL, max_tokens: 1024, messages: [{ role: "user", content: question }] },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 60000,
      }
    );
    const answer = (res.data.content || []).map((b) => b.text || "").join("\n").trim();
    await reply(ctx, answer || "Tidak ada jawaban dari AI.");
  });
});

bot.command("quote", async (ctx) => {
  await work(ctx, async () => {
    const res = await axios.get("https://api.quotable.io/random", { timeout: 15000 });
    await reply(ctx, `"${res.data.content}"\n— ${res.data.author}`);
  });
});

bot.command("owner", async (ctx) => {
  const contact = config.OWNER_USERNAME ? `@${config.OWNER_USERNAME}` : "(username belum diisi)";
  await reply(ctx, `*Owner Bot*\nNama: ${config.OWNER_NAME}\nKontak: ${contact}`);
});

bot.command("ping", async (ctx) => reply(ctx, "Pong! Bot aktif."));

// ---------- IQC (kartu quote) ----------
bot.command("iqc", async (ctx) => {
  const text = argsOf(ctx).join(" ");
  if (!text) return reply(ctx, "Contoh: /iqc Teks kamu di sini BY:Nama");
  await work(ctx, async () => {
    const encoded = encodeURIComponent(text);
    const apiUrl = `${config.API_BASE_URL}/api/iqc?text=${encoded}&theme=dark`;
    await rateLimiter.randomDelay();
    await ctx.replyWithPhoto(apiUrl);
  });
});

// ---------- Sistem poin ----------
bot.command("claim", async (ctx) => {
  const uid = String(ctx.from.id);
  const result = economy.claim(uid);
  if (!result.ok) {
    return reply(ctx, `Kamu sudah klaim hari ini. Coba lagi setelah jam ${economy.RESET_HOUR_WIB}:00 WIB besok.`);
  }
  await reply(ctx, `Berhasil klaim +${result.amount} poin!\nSaldo kamu sekarang: ${result.user.points} poin.`);
});

bot.command(["balance", "saldo", "poin"], async (ctx) => {
  const user = economy.getUser(String(ctx.from.id));
  await reply(ctx, `Saldo poin kamu: ${user.points}`);
});

bot.command("slot", async (ctx) => {
  const bet = parseInt(argsOf(ctx)[0], 10);
  if (!bet || bet <= 0) return reply(ctx, "Contoh: /slot 50");
  const result = economy.spinSlot(String(ctx.from.id), bet);
  if (!result.ok && result.reason === "not_enough") {
    return reply(ctx, `Poin tidak cukup. Saldo kamu: ${result.user.points}`);
  }
  if (!result.ok) return reply(ctx, "Taruhan tidak valid.");
  const line = result.reels.join(" | ");
  const text = result.win
    ? `[ ${line} ]\nJACKPOT! +${result.delta} poin\nSaldo: ${result.user.points}`
    : `[ ${line} ]\nKalah, -${bet} poin\nSaldo: ${result.user.points}`;
  await reply(ctx, text);
});

// ---------- Grup ----------
async function requireChatAdmin(ctx) {
  if (ctx.chat.type === "private") {
    await reply(ctx, "Command ini hanya untuk grup.");
    return false;
  }
  if (!(await isChatAdmin(ctx, ctx.from.id))) {
    await reply(ctx, "Command ini khusus admin grup.");
    return false;
  }
  return true;
}

bot.command(["kick", "remove"], async (ctx) => {
  if (!(await requireChatAdmin(ctx))) return;
  const target = ctx.message.reply_to_message?.from?.id;
  if (!target) return reply(ctx, `Balas pesan orangnya, lalu ketik /${ctx.message.text.slice(1).split(/\s+/)[0]}`);
  await work(ctx, async () => {
    await ctx.telegram.banChatMember(ctx.chat.id, target);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target); // supaya bisa gabung lagi nanti (efek kick, bukan ban)
    await reply(ctx, "Berhasil dikeluarkan dari grup (masih boleh gabung lagi nanti).");
  });
});

bot.command("ban", async (ctx) => {
  if (!(await requireChatAdmin(ctx))) return;
  const target = ctx.message.reply_to_message?.from?.id;
  if (!target) return reply(ctx, "Balas pesan orangnya, lalu ketik /ban");
  await work(ctx, async () => {
    await ctx.telegram.banChatMember(ctx.chat.id, target); // TANPA unban, jadi permanen
    await reply(ctx, "Berhasil di-ban dari grup (tidak bisa gabung lagi sampai di-unban).");
  });
});

bot.command("unban", async (ctx) => {
  if (!(await requireChatAdmin(ctx))) return;
  const target = ctx.message.reply_to_message?.from?.id;
  if (!target) return reply(ctx, "Balas pesan orangnya, lalu ketik /unban");
  await work(ctx, async () => {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target);
    await reply(ctx, "Ban dibuka, orang itu sudah bisa gabung lagi.");
  });
});

async function setMute(ctx, mute) {
  if (!(await requireChatAdmin(ctx))) return;
  await work(ctx, async () => {
    await ctx.telegram.setChatPermissions(ctx.chat.id, {
      can_send_messages: !mute,
      can_send_photos: !mute,
      can_send_videos: !mute,
      can_send_other_messages: !mute,
    });
    await reply(ctx, mute ? "Grup dikunci, hanya admin yang bisa chat." : "Grup dibuka lagi untuk semua.");
  });
}
bot.command("mute", (ctx) => setMute(ctx, true));
bot.command("unmute", (ctx) => setMute(ctx, false));

bot.command("antilink", async (ctx) => {
  if (!(await requireChatAdmin(ctx))) return;
  const mode = (argsOf(ctx)[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, "Contoh: /antilink on atau /antilink off");
  if (mode === "on") antilinkChats.add(ctx.chat.id);
  else antilinkChats.delete(ctx.chat.id);
  await reply(ctx, `Antilink ${mode === "on" ? "diaktifkan" : "dimatikan"} di grup ini.`);
});

bot.command("welcome", async (ctx) => {
  if (!(await requireChatAdmin(ctx))) return;
  const mode = (argsOf(ctx)[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, "Contoh: /welcome on atau /welcome off");
  if (mode === "on") welcomeOffChats.delete(ctx.chat.id);
  else welcomeOffChats.add(ctx.chat.id);
  await reply(ctx, `Pesan welcome ${mode === "on" ? "diaktifkan" : "dimatikan"} di grup ini.`);
});

bot.on("new_chat_members", async (ctx) => {
  if (welcomeOffChats.has(ctx.chat.id)) return;
  for (const member of ctx.message.new_chat_members) {
    await ctx.reply(`Selamat datang ${member.first_name} di *${ctx.chat.title}*! Ketik /menu untuk lihat fitur bot.`, {
      parse_mode: "Markdown",
    });
  }
});

bot.on("left_chat_member", async (ctx) => {
  if (welcomeOffChats.has(ctx.chat.id)) return;
  await ctx.reply(`${ctx.message.left_chat_member.first_name} telah keluar/dikeluarkan dari grup.`);
});

// Antilink: jalan untuk SEMUA pesan teks di grup yang antilink-nya aktif
bot.on("text", async (ctx, next) => {
  if (ctx.chat.type === "private") return next();
  if (!antilinkChats.has(ctx.chat.id)) return next();
  if (!LINK_RE.test(ctx.message.text)) return next();
  if (await isChatAdmin(ctx, ctx.from.id)) return next();
  try {
    await ctx.deleteMessage();
    await ctx.reply(`${ctx.from.first_name}, pesan dihapus, antilink aktif di grup ini.`);
  } catch (err) {
    console.error("[WARN] Gagal hapus pesan antilink:", err.message);
  }
});

// ---------- Admin bot ----------
bot.command("status", async (ctx) => {
  if (!isAdmin(ctx)) return reply(ctx, "Command ini khusus admin.");
  await reply(ctx, `*STATUS BOT*\nAktif\nAPI: ${config.API_BASE_URL}`);
});

// ---------- Menu ----------
bot.command(["menu", "help", "start"], async (ctx) => {
  const lines = [
    `*MENU ${config.BOT_NAME}*`,
    "",
    "*Downloader*",
    "/tiktok <link>",
    "/instagram <link>",
    "/facebook <link>",
    "/pinterest <link>",
    "/spotify <link>",
    "/ytmp3 <link>",
    "/ytmp4 <link>",
    "",
    "*Tools*",
    "/upscale <2k|4k|8k> (kirim/balas foto)",
    "/removebg (kirim/balas foto)",
    "/sticker (kirim/balas foto)",
    "/qr <teks>",
    "/shorten <link>",
    "",
    "*Game*",
    "/fakeff <nama> | <uid> | <level>",
    "/fakeml <nama> | <uid> | <level>",
    "(uid dan level boleh dikosongkan)",
    "",
    "*AI*",
    "/ai <pertanyaan>",
    "",
    "*Grup (khusus admin grup)*",
    "/kick atau /remove (balas orangnya, bisa gabung lagi)",
    "/ban (balas orangnya, permanen)",
    "/unban (balas orangnya)",
    "/mute",
    "/unmute",
    "/antilink on|off",
    "/welcome on|off",
    "",
    "*Poin & Game*",
    "/claim (gratis tiap hari, reset 06:00)",
    "/balance",
    "/slot <jumlah>",
    "",
    "*Kreatif*",
    "/iqc <teks> BY:nama",
    "",
    "*Lainnya*",
    "/ping",
    "/quote",
    "/owner",
  ];
  await reply(ctx, lines.join("\n"));
});

bot.catch((err) => console.error("[ERROR] Uncaught:", err.message));

bot.launch().then(() => console.log("[OK] Bot Telegram aktif"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
