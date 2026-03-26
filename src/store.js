const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

const defaultState = {
  users: [],
  sessions: [],
  charities: [
    {
      id: 'c1',
      name: 'First Tee',
      description: 'Youth golf and life skills through golf access, coaching, and mentorship.',
      featured: true,
      isActive: true,
      imageUrl: '',
      upcomingEvents: ['Spring Skills Camp', 'Junior Community Challenge'],
      createdAt: new Date().toISOString()
    },
    {
      id: 'c2',
      name: 'Golf For Good',
      description: 'Community golf development and inclusion programmes for underserved players.',
      featured: false,
      isActive: true,
      imageUrl: '',
      upcomingEvents: ['Summer Charity Fourball'],
      createdAt: new Date().toISOString()
    }
  ],
  subscriptions: [],
  scores: [],
  draws: [],
  drawEntries: [],
  prizePoolSnapshots: [],
  winners: [],
  donations: [],
  auditLogs: []
};

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState, null, 2));
  }
}

function readStore() {
  ensureStore();
  const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  return {
    ...defaultState,
    ...raw,
    charities: raw.charities || defaultState.charities,
    subscriptions: raw.subscriptions || [],
    scores: raw.scores || [],
    draws: raw.draws || [],
    drawEntries: raw.drawEntries || [],
    prizePoolSnapshots: raw.prizePoolSnapshots || [],
    winners: raw.winners || [],
    donations: raw.donations || [],
    auditLogs: raw.auditLogs || []
  };
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
