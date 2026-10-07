const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const axios = require("axios");
const QRCode = require("qrcode");
const sharp = require("sharp");
const config = require("./config");
const api = require("./downloaderApi");
const rateLimiter = require("./rateLimiter");
const groupFeatures = require("./groupFeatures");

const P = config.PREFIX;
const startedAt = Date.now();
const banned = new Set(); // nomor yang diblokir admin (hilang saat bot restart)
const logger = pino({ level: "silent" });

// Pengaturan per grup & riwayat chat AI (hilang kalau bot restart)
const groupState = new Map(); // groupId -> { antilink: bool, welcome: bool }
const aiHistory = new Map(); // chatId -> [{ role, content }, ...]

function getGroupState(groupId) {
  if (!groupState.has(groupId)) groupState.set(groupId, { antilink: false, welcome: false });
  return groupState.get(groupId);
}

const URL_IN_TEXT_RE = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i;

const DEFAULT_TYPE = {
  tiktok: "video",
  instagram: "video",
  facebook: "video",
  pinterest: "image",
  spotify: "audio",
};

// ---------- Helper ----------
const digits = (jid = "") => jid.split("@")[0].split(":")[0].replace(/\D/g, "");

function unwrap(m) {
  if (!m) return m;
  return (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message ||
    m
  );
}

function getText(c) {
  return (
    c.conversation ||
    c.extendedTextMessage?.text ||
    c.imageMessage?.caption ||
    c.videoMessage?.caption ||
    ""
  );
}

// Cari foto/video: di pesan itu sendiri, atau di pesan yang dibalas
function findMedia(msg, content) {
  const own = content.imageMessage || content.videoMessage;
  if (own) {
    return {
      waMsg: { key: msg.key, message: content },
      kind: content.imageMessage ? "image" : "video",
      mime: own.mimetype,
      size: Number(String(own.fileLength || 0)),
    };
  }
  const ctx = content.extendedTextMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);
  const q = quoted?.imageMessage || quoted?.videoMessage;
  if (q) {
    return {
      waMsg: {
        key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quoted,
      },
      kind: quoted.imageMessage ? "image" : "video",
      mime: q.mimetype,
      size: Number(String(q.fileLength || 0)),
    };
  }
  return null;
}

async function getParticipant(sock, groupId, jid) {
  const meta = await sock.groupMetadata(groupId);
  const num = digits(jid);
  return meta.participants.find((p) => digits(p.id) === num);
}

async function isGroupAdmin(sock, groupId, jid) {
  const p = await getParticipant(sock, groupId, jid);
  return Boolean(p && (p.admin === "admin" || p.admin === "superadmin"));
}

async function isBotAdmin(sock, groupId) {
  return isGroupAdmin(sock, groupId, sock.user.id);
}

async function reply(ctx, text) {
  await rateLimiter.randomDelay();
  await ctx.sock.sendMessage(ctx.from, { text }, { quoted: ctx.msg });
}

async function sendUrlMedia(ctx, item, caption) {
  await rateLimiter.randomDelay();
  let content;
  if (item.type === "video") content = { video: { url: item.url }, caption };
  else if (item.type === "audio") content = { audio: { url: item.url }, mimetype: "audio/mpeg" };
  else content = { image: { url: item.url }, caption };
  await ctx.sock.sendMessage(ctx.from, content, { quoted: ctx.msg });
}

async function sendBuffer(ctx, buffer, mime, caption) {
  await rateLimiter.randomDelay();
  let content;
  if (mime.startsWith("video/")) content = { video: buffer, mimetype: mime, caption };
  else if (mime.startsWith("audio/")) content = { audio: buffer, mimetype: mime };
  else content = { image: buffer, caption };
  await ctx.sock.sendMessage(ctx.from, content, { quoted: ctx.msg });
}

// Kirim hasil API (JSON berisi link, atau file langsung)
async function deliver(ctx, result, defaultType, defaultCaption) {
  if (result.kind === "binary") {
    return sendBuffer(ctx, result.buffer, result.mime, defaultCaption);
  }
  const { items, caption } = api.extractMedia(result.data, defaultType);
  if (!items.length) {
    return reply(ctx, "Media tidak ditemukan atau link tidak valid.");
  }
  for (let i = 0; i < items.length; i++) {
    await sendUrlMedia(ctx, items[i], i === 0 ? caption || defaultCaption : undefined);
  }
}

// Pembungkus: cek batas permintaan, status mengetik, dan tangani error
async function work(ctx, fn) {
  if (!rateLimiter.canUserRequest(ctx.sender)) {
    return reply(ctx, "Tunggu sebentar ya, terlalu banyak permintaan dalam 1 menit.");
  }
  if (!rateLimiter.canSendGlobally()) {
    console.log("[WARN] Batas kirim global tercapai, pesan ditunda.");
    return;
  }
  rateLimiter.recordSend(ctx.sender);
  try {
    if (config.SHOW_TYPING_INDICATOR) await ctx.sock.sendPresenceUpdate("composing", ctx.from);
    await fn();
  } catch (err) {
    console.error("[ERROR]", ctx.command, err.message);
    await reply(ctx, "Terjadi kesalahan saat memproses. Coba lagi beberapa saat.");
  } finally {
    try {
      await ctx.sock.sendPresenceUpdate("paused", ctx.from);
    } catch {}
  }
}

// ---------- Command ----------
async function cmdMenu(ctx) {
  const lines = [
    `*MENU ${config.BOT_NAME}*`,
    "",
    "*Downloader*",
    `${P}tiktok <link>`,
    `${P}instagram <link>`,
    `${P}facebook <link>`,
    `${P}pinterest <link>`,
    `${P}spotify <link>`,
    `${P}ytmp3 <link>`,
    `${P}ytmp4 <link>`,
    "",
    "*Tools*",
    `${P}upscale <2k|4k|8k>` + " (kirim/balas foto atau video)",
    `${P}removebg` + " (kirim/balas foto)",
    `${P}sticker` + " (kirim/balas foto)",
    `${P}qr <teks>`,
    `${P}rvo` + " (balas foto/video sekali lihat)",
    `${P}shorten <link>`,
    "",
    "*Game*",
    `${P}fakeff <nama> | <uid> | <level>`,
    `${P}fakeml <nama> | <uid> | <level>`,
    "(uid dan level boleh dikosongkan)",
    "",
    "*AI*",
    `${P}ai <pertanyaan>`,
    "",
    "*Grup (khusus admin grup)*",
    `${P}kick` + " (tag/balas orangnya)",
    `${P}mute`,
    `${P}unmute`,
    `${P}antilink on|off`,
    `${P}welcome on|off`,
    "",
    "*Lainnya*",
    `${P}ping`,
    `${P}quote`,
    `${P}owner`,
    `${P}tagall` + " (khusus grup)",
  ];
  if (ctx.isAdmin) {
    lines.push("", "*Admin*", `${P}status`, `${P}ban <nomor>`, `${P}unban <nomor>`);
  }
  const text = lines.join("\n");

  if (config.MENU_MEDIA_URL && config.MENU_MEDIA_TYPE) {
    await rateLimiter.randomDelay();
    const content =
      config.MENU_MEDIA_TYPE === "video"
        ? { video: { url: config.MENU_MEDIA_URL }, caption: text }
        : { image: { url: config.MENU_MEDIA_URL }, caption: text };
    return ctx.sock.sendMessage(ctx.from, content, { quoted: ctx.msg });
  }
  await reply(ctx, text);
}

async function cmdPing(ctx) {
  await reply(ctx, "Pong! Bot aktif.");
}

async function runDownload(ctx, platform) {
  const url = ctx.args[0];
  if (!url) return reply(ctx, `Format salah.\nContoh: ${P}${ctx.command} https://...`);
  const target = api.detectPlatform(url) || platform;
  await work(ctx, async () => {
    const result = await api.fetchDownload(target, url);
    await deliver(ctx, result, DEFAULT_TYPE[target] || "video", "Berhasil diunduh");
  });
}

async function cmdUpscale(ctx) {
  const scale = (ctx.args[0] || "4k").toLowerCase();
  if (!["2k", "4k", "8k"].includes(scale)) {
    return reply(ctx, `Pilihan resolusi: 2k, 4k, atau 8k.\nContoh: ${P}upscale 8k`);
  }
  const media = findMedia(ctx.msg, ctx.content);
  if (!media) {
    return reply(
      ctx,
      `Kirim foto/video dengan caption ${P}upscale ${scale}, atau balas foto/video dengan ${P}upscale ${scale}.`
    );
  }
  if (media.size > config.MAX_UPLOAD_MB * 1024 * 1024) {
    return reply(ctx, `File terlalu besar. Maksimal ${config.MAX_UPLOAD_MB} MB.`);
  }
  await work(ctx, async () => {
    await reply(ctx, `Sedang diproses ke ${scale.toUpperCase()}, mohon tunggu...`);
    const buffer = await downloadMediaMessage(
      media.waMsg,
      "buffer",
      {},
      { logger, reuploadRequest: ctx.sock.updateMediaMessage }
    );
    const result = await api.upscaleMedia(buffer, media.mime, scale);
    await deliver(ctx, result, media.kind, `Upscale ${scale.toUpperCase()} selesai`);
  });
}

async function cmdFakeLobby(ctx, game) {
  const [name, uid, level] = ctx.args.join(" ").split("|").map((s) => s.trim());
  if (!name) {
    return reply(
      ctx,
      `Contoh:\n${P}${ctx.command} Nama Kamu\n${P}${ctx.command} Nama Kamu | 123456789 | 70`
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

async function cmdStatus(ctx) {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  const uptime = `${Math.floor(sec / 3600)} jam ${Math.floor((sec % 3600) / 60)} menit`;
  await reply(
    ctx,
    [
      "*STATUS BOT*",
      `Aktif selama: ${uptime}`,
      `Nomor diblokir: ${banned.size}`,
      `API: ${config.API_BASE_URL}`,
    ].join("\n")
  );
}

async function cmdBan(ctx, ban) {
  const num = digits(ctx.args[0] || "");
  if (!num) return reply(ctx, `Contoh: ${P}${ctx.command} 6281234567890`);
  if (ban) banned.add(num);
  else banned.delete(num);
  await reply(ctx, ban ? `Nomor ${num} diblokir.` : `Blokir nomor ${num} dibuka.`);
}

async function cmdOwner(ctx) {
  await reply(
    ctx,
    `*Owner Bot*\nNama: ${config.OWNER_NAME}\nNomor: wa.me/${config.OWNER_NUMBER}`
  );
}

async function cmdSticker(ctx) {
  const media = findMedia(ctx.msg, ctx.content);
  if (!media || (media.kind !== "image" && media.kind !== "video")) {
    return reply(ctx, `Kirim foto dengan caption ${P}sticker, atau balas foto dengan ${P}sticker.`);
  }
  if (media.kind === "video") {
    return reply(ctx, "Stiker dari video belum didukung, kirim foto ya.");
  }
  await work(ctx, async () => {
    const buffer = await downloadMediaMessage(
      media.waMsg,
      "buffer",
      {},
      { logger, reuploadRequest: ctx.sock.updateMediaMessage }
    );
    const webp = await sharp(buffer)
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp()
      .toBuffer();
    await rateLimiter.randomDelay();
    await ctx.sock.sendMessage(ctx.from, { sticker: webp }, { quoted: ctx.msg });
  });
}

// ---------- RVO (lihat foto/video sekali lihat) ----------
async function cmdRvo(ctx) {
  // unwrap() sudah buka viewOnceMessage, jadi cukup balas pesan view-once-nya
  const media = findMedia(ctx.msg, ctx.content);
  if (!media) {
    return reply(ctx, `Balas foto/video "sekali lihat" dengan ${P}rvo untuk melihatnya di sini.`);
  }
  await work(ctx, async () => {
    const buffer = await downloadMediaMessage(
      media.waMsg,
      "buffer",
      {},
      { logger, reuploadRequest: ctx.sock.updateMediaMessage }
    );
    if (media.kind === "video") {
      await ctx.sock.sendMessage(
        ctx.from,
        { video: buffer, caption: "Video sekali lihat", mimetype: media.mime },
        { quoted: ctx.msg }
      );
    } else {
      await ctx.sock.sendMessage(
        ctx.from,
        { image: buffer, caption: "Foto sekali lihat", mimetype: media.mime },
        { quoted: ctx.msg }
      );
    }
  });
}

async function cmdQr(ctx) {
  const text = ctx.args.join(" ");
  if (!text) return reply(ctx, `Contoh: ${P}qr Halo dunia`);
  await work(ctx, async () => {
    const buffer = await QRCode.toBuffer(text, { width: 512, margin: 1 });
    await rateLimiter.randomDelay();
    await ctx.sock.sendMessage(
      ctx.from,
      { image: buffer, caption: "QR code kamu" },
      { quoted: ctx.msg }
    );
  });
}

async function cmdShorten(ctx) {
  const url = ctx.args[0];
  if (!url || !/^https?:\/\//i.test(url)) {
    return reply(ctx, `Contoh: ${P}shorten https://contoh.com/link-panjang`);
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
}

async function cmdQuote(ctx) {
  await work(ctx, async () => {
    const res = await axios.get("https://api.quotable.io/random", { timeout: 15000 });
    await reply(ctx, `"${res.data.content}"\n— ${res.data.author}`);
  });
}

async function cmdTagAll(ctx) {
  if (!ctx.from.endsWith("@g.us")) return reply(ctx, "Command ini hanya untuk grup.");
  await work(ctx, async () => {
    const meta = await ctx.sock.groupMetadata(ctx.from);
    const mentions = meta.participants.map((p) => p.id);
    const text = ["*TAG SEMUA ANGGOTA*", ...mentions.map((m) => "@" + m.split("@")[0])].join("\n");
    await rateLimiter.randomDelay();
    await ctx.sock.sendMessage(ctx.from, { text, mentions }, { quoted: ctx.msg });
  });
}

// Command generik untuk endpoint yang butuh path diisi dulu di config.js
function notConfigured(endpointKey) {
  return async (ctx) => reply(ctx, `Fitur ini belum tersedia — endpoint "${endpointKey}" belum diisi di config.js.`);
}

async function cmdYt(ctx, kind) {
  const endpointKey = kind === "audio" ? "ytmp3" : "ytmp4";
  if (!config.ENDPOINTS[endpointKey]) return notConfigured(endpointKey)(ctx);
  const url = ctx.args[0];
  if (!url) return reply(ctx, `Contoh: ${P}${ctx.command} https://youtu.be/xxxx`);
  await work(ctx, async () => {
    const result = await api.callApi(endpointKey, { params: { url }, timeout: 120000 });
    await deliver(ctx, result, kind === "audio" ? "audio" : "video", "Selesai");
  });
}

async function cmdRemoveBg(ctx) {
  if (!config.ENDPOINTS.removeBg) return notConfigured("removeBg")(ctx);
  const media = findMedia(ctx.msg, ctx.content);
  if (!media || media.kind !== "image") {
    return reply(ctx, `Kirim foto dengan caption ${P}removebg, atau balas foto dengan ${P}removebg.`);
  }
  await work(ctx, async () => {
    const buffer = await downloadMediaMessage(
      media.waMsg,
      "buffer",
      {},
      { logger, reuploadRequest: ctx.sock.updateMediaMessage }
    );
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: media.mime }), "input.jpg");
    const result = await api.callApi("removeBg", { method: "post", body: form, timeout: 60000 });
    await deliver(ctx, result, "image", "Selesai");
  });
}

async function cmdAi(ctx) {
  const question = ctx.args.join(" ");
  if (!question) return reply(ctx, `Contoh: ${P}ai jelaskan apa itu fotosintesis`);
  if (!config.AI_API_KEY) {
    return reply(
      ctx,
      "Fitur AI chat belum aktif. Isi ANTHROPIC_API_KEY di Variables Railway dulu (ambil di console.anthropic.com)."
    );
  }
  await work(ctx, async () => {
    const chatId = ctx.from;
    const history = aiHistory.get(chatId) || [];
    const messages = [...history, { role: "user", content: question }];

    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: config.AI_MODEL,
        max_tokens: 1024,
        messages,
      },
      {
        headers: {
          "x-api-key": config.AI_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 60000,
      }
    );

    const answer = (res.data.content || [])
      .map((b) => b.text || "")
      .join("")
      .trim() || "(tidak ada jawaban)";

    const updated = [...messages, { role: "assistant", content: answer }].slice(
      -config.AI_HISTORY_LIMIT * 2
    );
    aiHistory.set(chatId, updated);

    await reply(ctx, answer);
  });
}

async function cmdAiReset(ctx) {
  aiHistory.delete(ctx.from);
  await reply(ctx, "Riwayat obrolan AI di chat ini sudah dihapus.");
}

// ---------- Command grup ----------
function requireGroup(ctx) {
  return ctx.from.endsWith("@g.us");
}

async function requireGroupAdmin(ctx) {
  if (!requireGroup(ctx)) {
    await reply(ctx, "Command ini hanya untuk grup.");
    return false;
  }
  const ok = ctx.isAdmin || (await isGroupAdmin(ctx.sock, ctx.from, ctx.sender));
  if (!ok) await reply(ctx, "Command ini khusus admin grup.");
  return ok;
}

async function cmdAntilink(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  const mode = (ctx.args[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, `Contoh: ${P}antilink on`);
  getGroupState(ctx.from).antilink = mode === "on";
  await reply(ctx, `Antilink di grup ini: ${mode === "on" ? "AKTIF" : "MATI"}`);
}

async function cmdWelcome(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  const mode = (ctx.args[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, `Contoh: ${P}welcome on`);
  getGroupState(ctx.from).welcome = mode === "on";
  await reply(ctx, `Pesan selamat datang di grup ini: ${mode === "on" ? "AKTIF" : "MATI"}`);
}

async function cmdMute(ctx, mute) {
  if (!(await requireGroupAdmin(ctx))) return;
  if (!(await isBotAdmin(ctx.sock, ctx.from))) {
    return reply(ctx, "Bot harus jadi admin grup dulu untuk memakai command ini.");
  }
  await ctx.sock.groupSettingUpdate(ctx.from, mute ? "announcement" : "not_announcement");
  await reply(ctx, mute ? "Grup dikunci, hanya admin yang bisa chat." : "Grup dibuka lagi untuk semua anggota.");
}

function extractTargets(ctx) {
  const mentioned = ctx.content.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length) return mentioned;
  const quotedParticipant = ctx.content.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) return [quotedParticipant];
  const num = digits(ctx.args[0] || "");
  return num ? [num + "@s.whatsapp.net"] : [];
}

async function cmdKick(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  if (!(await isBotAdmin(ctx.sock, ctx.from))) {
    return reply(ctx, "Bot harus jadi admin grup dulu untuk memakai command ini.");
  }
  const targets = extractTargets(ctx);
  if (!targets.length) {
    return reply(ctx, `Tandai/balas orangnya, atau: ${P}kick 6281234567890`);
  }
  await work(ctx, async () => {
    await ctx.sock.groupParticipantsUpdate(ctx.from, targets, "remove");
    await reply(ctx, "Berhasil mengeluarkan anggota.");
  });
}

// Dipanggil dari index.js saat ada yang masuk/keluar grup
async function handleGroupParticipantsUpdate(sock, update) {
  const { id: groupId, participants, action } = update;
  if (action !== "add") return;
  const state = getGroupState(groupId);
  if (!state.welcome) return;
  try {
    const meta = await sock.groupMetadata(groupId);
    for (const jid of participants) {
      await rateLimiter.randomDelay();
      await sock.sendMessage(groupId, {
        text: `Selamat datang @${jid.split("@")[0]} di grup *${meta.subject}*! 👋`,
        mentions: [jid],
      });
    }
  } catch (err) {
    console.error("[ERROR] welcome message:", err.message);
  }
}

// Dipanggil dari handleMessage untuk cek link sebelum command diproses
async function checkAntilink(sock, msg, from, sender, text) {
  if (!from.endsWith("@g.us")) return false;
  const state = getGroupState(from);
  if (!state.antilink) return false;
  if (!URL_IN_TEXT_RE.test(text)) return false;
  if (await isGroupAdmin(sock, from, sender)) return false;

  try {
    await sock.sendMessage(from, { delete: msg.key });
    await rateLimiter.randomDelay();
    await sock.sendMessage(from, {
      text: `@${sender.split("@")[0]} link tidak diperbolehkan di grup ini.`,
      mentions: [sender],
    });
  } catch (err) {
    console.error("[ERROR] antilink:", err.message);
  }
  return true;
}

function getTargetUser(ctx) {
  const mentioned = ctx.content.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned && mentioned[0]) return mentioned[0];
  const quotedParticipant = ctx.content.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) return quotedParticipant;
  return null;
}

async function requireGroupAdmin(ctx) {
  if (!ctx.from.endsWith("@g.us")) {
    await reply(ctx, "Command ini hanya untuk grup.");
    return false;
  }
  const ok = await groupFeatures.isGroupAdmin(ctx.sock, ctx.from, ctx.sender);
  if (!ok) {
    await reply(ctx, "Command ini khusus admin grup.");
    return false;
  }
  return true;
}

async function cmdKick(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  const target = getTargetUser(ctx);
  if (!target) return reply(ctx, `Tag orangnya atau balas pesannya, lalu ketik ${P}kick`);
  await work(ctx, async () => {
    await ctx.sock.groupParticipantsUpdate(ctx.from, [target], "remove");
    await reply(ctx, "Berhasil dikeluarkan dari grup.");
  });
}

async function cmdMute(ctx, mute) {
  if (!(await requireGroupAdmin(ctx))) return;
  await work(ctx, async () => {
    await ctx.sock.groupSettingUpdate(ctx.from, mute ? "announcement" : "not_announcement");
    await reply(ctx, mute ? "Grup dikunci, hanya admin yang bisa chat." : "Grup dibuka lagi untuk semua.");
  });
}

async function cmdAntilink(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  const mode = (ctx.args[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, `Contoh: ${P}antilink on atau ${P}antilink off`);
  if (mode === "on") groupFeatures.antilinkGroups.add(ctx.from);
  else groupFeatures.antilinkGroups.delete(ctx.from);
  await reply(ctx, `Antilink ${mode === "on" ? "diaktifkan" : "dimatikan"} di grup ini.`);
}

async function cmdWelcome(ctx) {
  if (!(await requireGroupAdmin(ctx))) return;
  const mode = (ctx.args[0] || "").toLowerCase();
  if (!["on", "off"].includes(mode)) return reply(ctx, `Contoh: ${P}welcome on atau ${P}welcome off`);
  if (mode === "on") groupFeatures.welcomeOffGroups.delete(ctx.from);
  else groupFeatures.welcomeOffGroups.add(ctx.from);
  await reply(ctx, `Pesan welcome/goodbye ${mode === "on" ? "diaktifkan" : "dimatikan"} di grup ini.`);
}

async function cmdAi(ctx) {
  const question = ctx.args.join(" ");
  if (!question) return reply(ctx, `Contoh: ${P}ai Apa itu fotosintesis?`);
  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(
      ctx,
      "Fitur AI belum aktif. Admin bot perlu mengisi ANTHROPIC_API_KEY di Railway (Settings > Variables)."
    );
  }
  await work(ctx, async () => {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: config.AI_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: question }],
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: 60000,
      }
    );
    const answer = (res.data.content || [])
      .map((b) => b.text || "")
      .join("\n")
      .trim();
    await reply(ctx, answer || "Tidak ada jawaban dari AI.");
  });
}

// ---------- Daftar command ----------
const routes = new Map();
function add(names, run, opts = {}) {
  for (const n of names) routes.set(n, { run, ...opts });
}
add(["menu", "help"], cmdMenu);
add(["ping"], cmdPing);
add(["tiktok", "tt"], (c) => runDownload(c, "tiktok"));
add(["instagram", "ig"], (c) => runDownload(c, "instagram"));
add(["facebook", "fb"], (c) => runDownload(c, "facebook"));
add(["pinterest", "pin"], (c) => runDownload(c, "pinterest"));
add(["spotify", "sp"], (c) => runDownload(c, "spotify"));
add(["upscale", "hd"], cmdUpscale);
add(["fakeff", "ffl"], (c) => cmdFakeLobby(c, "ff"));
add(["fakeml", "mll"], (c) => cmdFakeLobby(c, "ml"));
add(["owner"], cmdOwner);
add(["sticker", "stiker", "s"], cmdSticker);
add(["qr"], cmdQr);
add(["rvo", "readviewonce", "once"], cmdRvo);
add(["shorten", "short"], cmdShorten);
add(["quote"], cmdQuote);
add(["tagall"], cmdTagAll);
add(["ytmp3"], (c) => cmdYt(c, "audio"));
add(["ytmp4"], (c) => cmdYt(c, "video"));
add(["removebg"], cmdRemoveBg);
add(["ai", "tanya"], cmdAi);
add(["kick"], cmdKick);
add(["mute"], (c) => cmdMute(c, true));
add(["unmute"], (c) => cmdMute(c, false));
add(["antilink"], cmdAntilink);
add(["welcome"], cmdWelcome);
add(["ai", "tanya"], cmdAi);
add(["airesert", "aireset"], cmdAiReset);
add(["antilink"], cmdAntilink);
add(["welcome"], cmdWelcome);
add(["mute", "lock"], (c) => cmdMute(c, true));
add(["unmute", "unlock"], (c) => cmdMute(c, false));
add(["kick"], cmdKick);
add(["status"], cmdStatus, { admin: true });
add(["ban"], (c) => cmdBan(c, true), { admin: true });
add(["unban"], (c) => cmdBan(c, false), { admin: true });

// ---------- Pintu masuk ----------
async function handleMessage(sock, msg) {
  const from = msg.key.remoteJid;
  if (!from || from === "status@broadcast") return;

  const content = unwrap(msg.message);
  const text = getText(content);
  const sender = msg.key.participant || from;

  console.log("[DEBUG] dari:", sender, "| teks:", text.slice(0, 80));

  if (await groupFeatures.handleAntilink(sock, msg, text)) return;

  if (!text.startsWith(P)) {
    console.log("[DEBUG] diabaikan: teks tidak diawali prefix", P);
    return;
  }
  if (banned.has(digits(sender))) return;

  const [command, ...args] = text.slice(P.length).trim().split(/\s+/);
  const route = routes.get((command || "").toLowerCase());
  if (!route) return;

  const isAdmin = config.ADMIN_NUMBERS.includes(digits(sender));
  const ctx = { sock, msg, content, from, sender, command: command.toLowerCase(), args, isAdmin };

  if (route.admin && !isAdmin) {
    return reply(ctx, "Command ini khusus admin.");
  }
  await route.run(ctx);
}

module.exports = { handleMessage };
