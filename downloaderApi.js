const axios = require("axios");
const config = require("./config");

// ---------- Panggil API ----------
// Mengembalikan { kind: "json", data } atau { kind: "binary", buffer, mime }
async function callApi(endpointKey, { method = "get", params, body, timeout = 30000 } = {}) {
  const path = config.ENDPOINTS[endpointKey];
  if (!path) throw new Error(`Endpoint "${endpointKey}" belum diatur di config.js`);

  const res = await axios({
    method,
    url: config.API_BASE_URL + path,
    params,
    data: body,
    timeout,
    responseType: "arraybuffer",
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const mime = String(res.headers["content-type"] || "").split(";")[0].trim();
  const buffer = Buffer.from(res.data);

  if (!mime || /json|text/i.test(mime)) {
    try {
      return { kind: "json", data: JSON.parse(buffer.toString("utf8")) };
    } catch {
      throw new Error("Respon API bukan JSON yang valid");
    }
  }
  return { kind: "binary", buffer, mime };
}

// ---------- Deteksi platform dari link ----------
function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  if (/pinterest\.|pin\.it/i.test(url)) return "pinterest";
  if (/spotify\.com/i.test(url)) return "spotify";
  return null;
}

// ---------- Baca hasil JSON API secara fleksibel ----------
// Mencari semua link di dalam JSON, menebak jenisnya (video/foto/audio),
// lalu memilih yang paling cocok. Jadi bentuk JSON API kamu tidak harus persis.
const URL_RE = /^https?:\/\//i;
const SKIP_KEY = /thumb|cover|avatar|author|profile|icon|logo|banner|preview/i;

function typeFromUrl(url) {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(mp4|mov|webm|mkv)$/.test(clean)) return "video";
  if (/\.(mp3|m4a|ogg|opus|wav|aac)$/.test(clean)) return "audio";
  if (/\.(jpe?g|png|webp|gif)$/.test(clean)) return "image";
  return null;
}

function typeFromKey(key) {
  if (/audio|mp3|music|sound/i.test(key)) return "audio";
  if (/image|img|photo|pic/i.test(key)) return "image";
  if (/video|mp4|nowm|no_?wm|play/i.test(key)) return "video";
  return null;
}

function score(key) {
  let s = 0;
  if (/no_?wm|nowm|no_?watermark|without/i.test(key)) s += 3;
  else if (/wm|watermark/i.test(key)) s -= 3;
  if (/hd|high|original/i.test(key)) s += 2;
  return s;
}

function walk(node, key, out, depth = 0) {
  if (depth > 6 || node == null) return;
  if (typeof node === "string") {
    if (URL_RE.test(node) && !SKIP_KEY.test(key)) out.push({ url: node, key });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, key, out, depth + 1));
    return;
  }
  if (typeof node === "object") {
    const hint = [node.type, node.extension, node.ext, node.format, node.quality]
      .filter((x) => typeof x === "string")
      .join("_");
    const base = hint ? `${key}.${hint}` : key;
    for (const [k, v] of Object.entries(node)) walk(v, `${base}.${k}`, out, depth + 1);
  }
}

function pickCaption(data) {
  const keys = ["title", "caption", "desc", "description", "text"];
  let found = "";
  (function look(node, depth) {
    if (found || depth > 4 || node == null || typeof node !== "object") return;
    for (const k of keys) {
      if (typeof node[k] === "string" && node[k].trim() && !URL_RE.test(node[k])) {
        found = node[k].trim();
        return;
      }
    }
    for (const v of Object.values(node)) look(v, depth + 1);
  })(data, 0);
  return found.slice(0, 300);
}

function extractMedia(data, defaultType = "video") {
  const found = [];
  walk(data, "", found);

  const seen = new Set();
  const items = [];
  for (const f of found) {
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    items.push({
      url: f.url,
      type: typeFromUrl(f.url) || typeFromKey(f.key) || defaultType,
      score: score(f.key),
    });
  }

  const order = [...new Set([defaultType, "video", "image", "audio"])];
  for (const type of order) {
    const list = items.filter((i) => i.type === type).sort((a, b) => b.score - a.score);
    if (!list.length) continue;
    const chosen = type === "image" ? list.slice(0, config.MAX_IMAGES) : [list[0]];
    return { items: chosen, caption: pickCaption(data) };
  }
  return { items: [], caption: "" };
}

// ---------- Fitur ----------
function fetchDownload(platform, url) {
  return callApi(platform, { params: { url } });
}

// Upload file ke API upscaler (multipart: field "file" dan "scale")
function upscaleMedia(buffer, mime, scale) {
  const form = new FormData();
  const ext = (mime.split("/")[1] || "bin").split(";")[0];
  form.append("file", new Blob([buffer], { type: mime }), `input.${ext}`);
  form.append("scale", scale);
  return callApi("upscale", { method: "post", body: form, timeout: 300000 });
}

function fakeLobby(game, params) {
  return callApi(game === "ff" ? "fakeLobbyFF" : "fakeLobbyML", { params, timeout: 60000 });
}

module.exports = {
  callApi,
  detectPlatform,
  extractMedia,
  fetchDownload,
  upscaleMedia,
  fakeLobby,
};
