const config = require("./config");

// Menyimpan riwayat pengiriman pesan global & per user (in-memory)
const globalSendLog = [];
const userSendLog = new Map();

function cleanOld(arr, windowMs) {
  const now = Date.now();
  while (arr.length && now - arr[0] > windowMs) arr.shift();
}

/**
 * Cek apakah bot boleh mengirim pesan sekarang (batas global per menit)
 */
function canSendGlobally() {
  cleanOld(globalSendLog, 60_000);
  return globalSendLog.length < config.MAX_MESSAGES_PER_MINUTE;
}

/**
 * Cek apakah user tertentu masih dalam batas wajar (mencegah 1 orang spam)
 */
function canUserRequest(userId) {
  const log = userSendLog.get(userId) || [];
  cleanOld(log, 60_000);
  userSendLog.set(userId, log);
  return log.length < config.MAX_REQUEST_PER_USER_PER_MINUTE;
}

function recordSend(userId) {
  globalSendLog.push(Date.now());
  const log = userSendLog.get(userId) || [];
  log.push(Date.now());
  userSendLog.set(userId, log);
}

function randomDelay() {
  const { REPLY_DELAY_MIN_MS, REPLY_DELAY_MAX_MS } = config;
  const ms =
    REPLY_DELAY_MIN_MS +
    Math.random() * (REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { canSendGlobally, canUserRequest, recordSend, randomDelay };
