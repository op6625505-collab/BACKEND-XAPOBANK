const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'promos.json');

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) { /* ignore */ }
}

function readFileCodes() {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
    return [];
  } catch (e) {
    console.warn('promoService: failed to read file codes', e && e.message);
    return [];
  }
}

function writeFileCodes(arr) {
  try {
    ensureDataDir();
    const clean = Array.from(new Set((arr || []).map(s => String(s || '').trim().toLowerCase()).filter(Boolean)));
    fs.writeFileSync(FILE_PATH, JSON.stringify(clean, null, 2), 'utf8');
    return clean;
  } catch (e) {
    console.warn('promoService: failed to write file codes', e && e.message);
    return readFileCodes();
  }
}

function getEnvCodes() {
  try {
    return String(process.env.PROMO_CODES || '').split(',').map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
  } catch (e) { return []; }
}

function getAllowedCodes() {
  const env = getEnvCodes();
  const file = readFileCodes();
  const fallback = ['welcome', 'first100', 'xapo-h7k2m9qz'];
  if (env.length > 0) return Array.from(new Set(env.concat(file)));
  if (file.length > 0) return Array.from(new Set(file.concat(fallback)));
  return fallback.slice();
}

function addCode(code) {
  if (!code) return getAllowedCodes();
  const normalized = String(code).trim().toLowerCase();
  const file = readFileCodes();
  if (!file.includes(normalized)) file.push(normalized);
  return writeFileCodes(file);
}

function removeCode(code) {
  if (!code) return getAllowedCodes();
  const normalized = String(code).trim().toLowerCase();
  const file = readFileCodes().filter(c => c !== normalized);
  return writeFileCodes(file);
}

module.exports = { getAllowedCodes, addCode, removeCode, FILE_PATH };
