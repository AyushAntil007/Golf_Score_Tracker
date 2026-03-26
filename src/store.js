const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

const defaultState = {
  users: [],
  sessions: [],
  charities: [
    { id: 'c1', name: 'First Tee', description: 'Youth golf and life skills', featured: true },
    { id: 'c2', name: 'Golf For Good', description: 'Community golf development', featured: false }
  ],
  subscriptions: [],
  scores: [],
  draws: [],
  winners: [],
  donations: []
};

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeStore(state) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
}

function id(prefix = '') {
  return `${prefix}${crypto.randomUUID()}`;
}

function hash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { readStore, writeStore, id, hash };
