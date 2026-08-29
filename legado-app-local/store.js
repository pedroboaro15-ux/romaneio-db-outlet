// store.js — persistência local em arquivo JSON (sem banco, sem dependências)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');

const DEFAULT = {
  config: { app_key: '', app_secret: '' },
  freteiros: [],
  romaneios: [],
  clientesCache: {}
};

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULT, null, 2));
}

let db = null;
function load() {
  if (db) return db;
  ensure();
  try {
    db = { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (e) {
    console.error('db.json corrompido, recriando. Backup em db.json.bak');
    try { fs.copyFileSync(FILE, FILE + '.bak'); } catch (_) {}
    db = JSON.parse(JSON.stringify(DEFAULT));
  }
  return db;
}

let saveTimer = null;
function save() {
  load();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  }, 50);
}

function saveNow() {
  clearTimeout(saveTimer);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function id(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { load, save, saveNow, id, FILE };
