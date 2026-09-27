const axios = require("axios");
const config = require("./config");

// Sesuaikan mapping path ini dengan endpoint asli di project Next.js kamu
const ENDPOINTS = {
  tiktok: "/api/download/tiktok",
  instagram: "/api/download/instagram",
  facebook: "/api/download/facebook",
  pinterest: "/api/download/pinterest",
  spotify: "/api/download/spotify",
};

/**
 * Panggil API downloader sesuai platform
 * @param {"tiktok"|"instagram"|"facebook"|"pinterest"|"spotify"} platform
 * @param {string} url - link media yang mau didownload
 */
async function fetchDownload(platform, url) {
  const path = ENDPOINTS[platform];
  if (!path) throw new Error(`Platform "${platform}" belum didukung`);

  const { data } = await axios.get(`${config.API_BASE_URL}${path}`, {
    params: { url },
    timeout: 20_000,
  });

  return data; // sesuaikan bentuk response dengan API asli kamu
}

function detectPlatform(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/facebook\.com|fb\.watch/i.test(url)) return "facebook";
  if (/pinterest\.com|pin\.it/i.test(url)) return "pinterest";
  if (/spotify\.com/i.test(url)) return "spotify";
  return null;
}

module.exports = { fetchDownload, detectPlatform };
