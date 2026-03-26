const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { readStore, writeStore, id, hash } = require('./store');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
}

function sendText(res, status, payload, headers = {}) {
  res.writeHead(status, headers);
  res.end(payload);
}

async function parseJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function auth(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { error: 'Missing token' };
  const db = readStore();
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return { error: 'Invalid token' };
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return { error: 'Invalid user' };
  return { user, db };
}

function isAdmin(user) {
  return user && user.role === 'admin';
}

function getMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function pickNumbersRandom() {
  const nums = new Set();
  while (nums.size < 5) nums.add(Math.floor(Math.random() * 45) + 1);
  return [...nums].sort((a, b) => a - b);
}

function pickNumbersAlgorithmic(scores) {
  if (!scores.length) return pickNumbersRandom();
  const freq = new Map();
  for (const row of scores) freq.set(row.score, (freq.get(row.score) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([score]) => score);
  while (sorted.length < 5) {
    const candidate = Math.floor(Math.random() * 45) + 1;
    if (!sorted.includes(candidate)) sorted.push(candidate);
  }
  return sorted.slice(0, 5).sort((a, b) => a - b);
}

function countMatches(a, b) {
  const set = new Set(a);
  return b.filter((n) => set.has(n)).length;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath);
  const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain';
  sendText(res, 200, fs.readFileSync(filePath), { 'Content-Type': contentType });
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (serveStatic(req, res, pathname)) return;
    return send(res, 404, { error: 'Not found' });
  }

  if (req.method === 'POST' && pathname === '/api/auth/signup') {
    const body = await parseJson(req);
    const { email, password, name, role = 'subscriber' } = body;
    if (!email || !password) return send(res, 400, { error: 'email + password required' });
    const db = readStore();
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return send(res, 409, { error: 'Email already in use' });
    }
    const user = { id: id('u_'), email, name: name || '', passwordHash: hash(password), role };
    db.users.push(user);
    db.subscriptions.push({ userId: user.id, plan: null, status: 'inactive', renewalDate: null, charityPercent: 10, charityId: db.charities[0]?.id || null });
    writeStore(db);
    return send(res, 201, { id: user.id, email: user.email, role: user.role });
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseJson(req);
    const db = readStore();
    const user = db.users.find((u) => u.email.toLowerCase() === String(body.email || '').toLowerCase());
    if (!user || user.passwordHash !== hash(body.password || '')) return send(res, 401, { error: 'Invalid credentials' });
    const token = id('t_');
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    writeStore(db);
    return send(res, 200, { token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  }

  if (req.method === 'GET' && pathname === '/api/charities') {
    return send(res, 200, readStore().charities);
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    const sub = ctx.db.subscriptions.find((s) => s.userId === ctx.user.id);
    return send(res, 200, { user: { id: ctx.user.id, email: ctx.user.email, role: ctx.user.role, name: ctx.user.name }, subscription: sub });
  }

  if (req.method === 'POST' && pathname === '/api/subscriptions/activate') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    const body = await parseJson(req);
    const { plan, charityId, charityPercent } = body;
    if (!['monthly', 'yearly'].includes(plan)) return send(res, 400, { error: 'Invalid plan' });
    if (charityPercent < 10) return send(res, 400, { error: 'Minimum charity contribution is 10%' });
    const sub = ctx.db.subscriptions.find((s) => s.userId === ctx.user.id);
    sub.plan = plan;
    sub.status = 'active';
    sub.charityId = charityId || sub.charityId;
    sub.charityPercent = charityPercent;
    const now = new Date();
    now.setUTCMonth(now.getUTCMonth() + (plan === 'monthly' ? 1 : 12));
    sub.renewalDate = now.toISOString().slice(0, 10);
    writeStore(ctx.db);
    return send(res, 200, { subscription: sub });
  }

  if (req.method === 'POST' && pathname === '/api/scores') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    const body = await parseJson(req);
    const { score, playedOn } = body;
    if (!Number.isInteger(score) || score < 1 || score > 45) return send(res, 400, { error: 'Score must be 1-45' });
    if (!playedOn) return send(res, 400, { error: 'playedOn date is required' });

    ctx.db.scores.push({ id: id('s_'), userId: ctx.user.id, score, playedOn, createdAt: new Date().toISOString() });
    const userScores = ctx.db.scores.filter((s) => s.userId === ctx.user.id).sort((a, b) => new Date(a.playedOn) - new Date(b.playedOn));
    while (userScores.length > 5) {
      const oldest = userScores.shift();
      ctx.db.scores = ctx.db.scores.filter((s) => s.id !== oldest.id);
    }
    writeStore(ctx.db);
    return send(res, 201, { message: 'Score added' });
  }

  if (req.method === 'GET' && pathname === '/api/scores') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    const scores = ctx.db.scores.filter((s) => s.userId === ctx.user.id).sort((a, b) => new Date(b.playedOn) - new Date(a.playedOn));
    return send(res, 200, scores);
  }

  if (req.method === 'POST' && pathname === '/api/admin/charities') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    const body = await parseJson(req);
    if (!body.name) return send(res, 400, { error: 'name required' });
    const charity = { id: id('c_'), name: body.name, description: body.description || '', featured: Boolean(body.featured) };
    ctx.db.charities.push(charity);
    writeStore(ctx.db);
    return send(res, 201, charity);
  }

  if (req.method === 'POST' && pathname === '/api/admin/draws/simulate') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    const body = await parseJson(req);
    const mode = body.mode || 'random';
    if (!['random', 'algorithmic'].includes(mode)) return send(res, 400, { error: 'Invalid mode' });
    const numbers = mode === 'random' ? pickNumbersRandom() : pickNumbersAlgorithmic(ctx.db.scores);
    const draw = { id: id('d_'), monthKey: getMonthKey(), mode, status: 'simulated', numbers, createdAt: new Date().toISOString() };
    ctx.db.draws.push(draw);
    writeStore(ctx.db);
    return send(res, 201, draw);
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/draws\/[^/]+\/publish$/)) {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    const drawId = pathname.split('/')[4];
    const draw = ctx.db.draws.find((d) => d.id === drawId);
    if (!draw) return send(res, 404, { error: 'Draw not found' });
    draw.status = 'published';

    const activeSubs = ctx.db.subscriptions.filter((s) => s.status === 'active');
    const totalPool = activeSubs.length * 100;
    const pools = { 5: totalPool * 0.4, 4: totalPool * 0.35, 3: totalPool * 0.25 };
    const hits = { 3: [], 4: [], 5: [] };

    for (const sub of activeSubs) {
      const lastFive = ctx.db.scores
        .filter((s) => s.userId === sub.userId)
        .sort((a, b) => new Date(b.playedOn) - new Date(a.playedOn))
        .slice(0, 5)
        .map((s) => s.score);
      if (lastFive.length < 5) continue;
      const matchCount = countMatches(lastFive, draw.numbers);
      if (matchCount >= 3) hits[matchCount].push(sub.userId);
    }

    [3, 4, 5].forEach((tier) => {
      const users = hits[tier];
      if (!users.length) return;
      const each = Number((pools[tier] / users.length).toFixed(2));
      users.forEach((uid) => {
        ctx.db.winners.push({
          id: id('w_'),
          drawId: draw.id,
          userId: uid,
          matchTier: tier,
          prizeAmount: each,
          verificationStatus: 'pending',
          payoutStatus: 'pending'
        });
      });
    });

    writeStore(ctx.db);
    return send(res, 200, { draw, winners: ctx.db.winners.filter((w) => w.drawId === draw.id) });
  }

  if (req.method === 'GET' && pathname === '/api/draws') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    return send(res, 200, ctx.db.draws.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  if (req.method === 'GET' && pathname === '/api/winners/me') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    return send(res, 200, ctx.db.winners.filter((w) => w.userId === ctx.user.id));
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/winners\/[^/]+\/proof$/)) {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    const winnerId = pathname.split('/')[3];
    const winner = ctx.db.winners.find((w) => w.id === winnerId && w.userId === ctx.user.id);
    if (!winner) return send(res, 404, { error: 'Winner entry not found' });
    const body = await parseJson(req);
    winner.proofUrl = body.proofUrl || '';
    winner.verificationStatus = 'pending';
    writeStore(ctx.db);
    return send(res, 200, { message: 'Proof submitted' });
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/winners\/[^/]+\/verify$/)) {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    const winnerId = pathname.split('/')[4];
    const winner = ctx.db.winners.find((w) => w.id === winnerId);
    if (!winner) return send(res, 404, { error: 'Winner not found' });
    const body = await parseJson(req);
    winner.verificationStatus = body.action === 'approve' ? 'approved' : 'rejected';
    writeStore(ctx.db);
    return send(res, 200, winner);
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/admin\/winners\/[^/]+\/mark-paid$/)) {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    const winnerId = pathname.split('/')[4];
    const winner = ctx.db.winners.find((w) => w.id === winnerId);
    if (!winner) return send(res, 404, { error: 'Winner not found' });
    if (winner.verificationStatus !== 'approved') return send(res, 400, { error: 'Winner not approved' });
    winner.payoutStatus = 'paid';
    writeStore(ctx.db);
    return send(res, 200, winner);
  }

  if (req.method === 'GET' && pathname === '/api/admin/reports/overview') {
    const ctx = auth(req);
    if (ctx.error) return send(res, 401, { error: ctx.error });
    if (!isAdmin(ctx.user)) return send(res, 403, { error: 'Admin only' });
    return send(res, 200, {
      totalUsers: ctx.db.users.length,
      activeSubscribers: ctx.db.subscriptions.filter((s) => s.status === 'active').length,
      totalDraws: ctx.db.draws.length,
      totalWinners: ctx.db.winners.length
    });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
