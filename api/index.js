const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { generatePass, currencyForKiosk } = require('../src/passGenerator');
const { renderLandingPage } = require('../src/pages');
const db = require('../src/db');
const pushService = require('../src/pushService');
const googleWallet = require('../src/googleWallet');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Preload the pass logo so it can be served at a public URL (Google Wallet needs a
// reachable PNG for the loyalty class logo). Read at require-time so Vercel bundles it.
const LOGO_BUF = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'pass-template.pass', 'logo@3x.png')); }
  catch (e) { return null; }
})();
const HERO_BUF = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', 'assets', 'hero.png')); }
  catch (e) { return null; }
})();

const app = express();

// Enable CORS for all origins (kiosk access)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json());

// Get base URL
function getBaseUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}`;
}

// Read a cookie value from the request
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Public logo for the Google Wallet loyalty class (must be a reachable PNG/JPEG).
app.get('/logo.png', (req, res) => {
  if (!LOGO_BUF) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('png').send(LOGO_BUF);
});

// Hero/banner art for the Google Wallet loyalty class.
app.get('/hero.png', (req, res) => {
  if (!HERO_BUF) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('png').send(HERO_BUF);
});

// One-shot: push the current design (logo/hero/colours) to the existing Google
// Wallet class. Call after deploying a design change; harmless to repeat.
app.post('/api/wallet/class/refresh', async (req, res) => {
  try {
    const result = await googleWallet.updateClass();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auth middleware for Apple Wallet
async function authenticatePass(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('ApplePass ')) {
    return res.status(401).send('Unauthorized');
  }
  const token = authHeader.replace('ApplePass ', '');
  const member = await db.getMemberByAuthToken(token);
  if (!member) return res.status(401).send('Unauthorized');
  req.member = member;
  next();
}

// Landing page
app.get('/', async (req, res) => {
  const baseUrl = getBaseUrl(req);
  const passUrl = `${baseUrl}/pass`;
  try {
    const qrDataUrl = await QRCode.toDataURL(passUrl, {
      width: 480, margin: 2, color: { dark: '#141413', light: '#ffffff' }
    });
    res.send(renderLandingPage({ qrDataUrl }));
  } catch (e) { res.status(500).send('Error'); }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'pentatonic-wallet', timestamp: new Date().toISOString() });
});

// Generate new pass
app.get('/pass', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const { buffer, memberId, member } = await generatePass(baseUrl, null, { kiosk: req.query.kiosk, currency: req.query.currency });
    // Login "ticket": remember this member's browser so a later sticker tap recognises them
    res.append('Set-Cookie', `mec_session=${member.profile_token}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
    if (req.query.kiosk) { try { await db.logTap(member.id, String(req.query.kiosk)); } catch (e) {} }
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="pentatonic-member.pkpass"',
      'Content-Length': buffer.length,
    });
    res.send(buffer);
    console.log(`Generated pass: ${memberId} (${member.points} pts)`);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed', message: error.message });
  }
});

// Re-download existing pass
app.get('/pass/:memberId', async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const { buffer, member } = await generatePass(baseUrl, req.params.memberId, { kiosk: req.query.kiosk, currency: req.query.currency });
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="pentatonic-${member.id.slice(0,8)}.pkpass"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
    console.log(`Re-downloaded pass: ${member.id.slice(0,8)}... (${member.points} pts)`);
  } catch (error) {
    console.error('Error:', error);
    res.status(404).json({ error: 'Member not found' });
  }
});

// Kiosk "tap the sticker" entry point.
// Recognises a returning phone via its login cookie; otherwise onboards a new visitor.
// ?kiosk=<city> identifies which kiosk was tapped (drives currency + tap logging).
app.get('/start', async (req, res) => {
  const kiosk = req.query.kiosk ? String(req.query.kiosk) : null;
  const baseUrl = getBaseUrl(req);
  try {
    const token = getCookie(req, 'mec_session');
    const member = token ? await db.getMemberByProfileToken(token) : null;
    if (member) {
      // Returning visitor — log the tap and report who it is (kiosk experience reads this)
      try { await db.logTap(member.id, kiosk); } catch (e) {}
      console.log(`Tap: returning ${member.id.slice(0, 8)}... @ ${kiosk || 'unknown'}`);
      return res.json({
        status: 'returning',
        kiosk,
        member: {
          id: member.id,
          name: member.name,
          points: member.points,
          tier: member.tier,
          currency: member.reward_currency || 'USD',
        },
      });
    }
    // New visitor — onboard. Android -> Google Wallet (if configured), else Apple pass.
    console.log(`Tap: new visitor @ ${kiosk || 'unknown'} -> onboarding`);
    const q = kiosk ? `?kiosk=${encodeURIComponent(kiosk)}` : '';
    const isAndroid = /android/i.test(req.headers['user-agent'] || '');
    const target = (isAndroid && googleWallet.isConfigured()) ? '/gpass' : '/pass';
    return res.redirect(302, `${baseUrl}${target}${q}`);
  } catch (error) {
    console.error('start error:', error);
    return res.status(500).json({ error: 'start failed', message: error.message });
  }
});

// Android: Google Wallet loyalty pass. Creates/fetches the member (same account model
// as Apple), sets the login cookie, then redirects to the "Add to Google Wallet" link.
app.get('/gpass', async (req, res) => {
  try {
    if (!googleWallet.isConfigured()) {
      return res.status(503).json({
        error: 'Google Wallet not configured yet',
        message: 'Set GOOGLE_WALLET_ISSUER_ID and GOOGLE_SERVICE_ACCOUNT_BASE64 to enable Android passes.',
      });
    }
    const baseUrl = getBaseUrl(req);
    const kiosk = req.query.kiosk ? String(req.query.kiosk) : null;
    let member = req.query.member ? await db.getMember(req.query.member) : null;
    if (!member) member = await db.createMember(uuidv4());
    // Resolve + persist currency (same rule as the Apple pass)
    const kioskCurrency = req.query.currency || currencyForKiosk(kiosk);
    const currency = kioskCurrency || member.reward_currency || 'USD';
    if (kioskCurrency && kioskCurrency !== member.reward_currency) {
      await db.setMemberCurrency(member.id, currency);
    }
    const rewardValue = member.reward_balance || 0;
    const url = googleWallet.buildSaveUrl(member, { currency, rewardValue, baseUrl });
    res.append('Set-Cookie', `mec_session=${member.profile_token}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
    if (kiosk) { try { await db.logTap(member.id, kiosk); } catch (e) {} }
    console.log(`Google pass: ${member.id.slice(0, 8)}... (${member.points} pts, ${currency})`);
    return res.redirect(302, url);
  } catch (error) {
    console.error('gpass error:', error);
    return res.status(500).json({ error: 'Failed', message: error.message });
  }
});

// Apple Wallet Web Service endpoints
app.post('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', authenticatePass, async (req, res) => {
  const { deviceLibraryId, serialNumber } = req.params;
  const { pushToken } = req.body;
  if (!pushToken) return res.status(400).send('Missing push token');
  try {
    await db.registerDevice(deviceLibraryId, pushToken, serialNumber);
    console.log(`Device registered: ${deviceLibraryId}`);
    res.status(201).send();
  } catch (e) { res.status(500).send('Failed'); }
});

app.delete('/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber', authenticatePass, async (req, res) => {
  const { deviceLibraryId, serialNumber } = req.params;
  await db.unregisterDevice(deviceLibraryId, serialNumber);
  res.status(200).send();
});

app.get('/v1/devices/:deviceLibraryId/registrations/:passTypeId', async (req, res) => {
  const serialNumbers = await db.getSerialNumbersForDevice(req.params.deviceLibraryId);
  if (serialNumbers.length === 0) return res.status(204).send();
  res.json({ serialNumbers, lastUpdated: new Date().toISOString() });
});

app.get('/v1/passes/:passTypeId/:serialNumber', authenticatePass, async (req, res) => {
  try {
    const baseUrl = getBaseUrl(req);
    const memberId = req.params.serialNumber;
    const userAgent = req.headers['user-agent'] || null;

    // Log the refresh event
    await db.logPassRefresh(memberId, null, userAgent);
    console.log(`[Refresh] Pass ${memberId.slice(0, 8)}... refreshed`);

    const { buffer } = await generatePass(baseUrl, memberId);
    res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Last-Modified': new Date().toUTCString() });
    res.send(buffer);
  } catch (e) { res.status(500).send('Error'); }
});

app.post('/v1/log', (req, res) => {
  console.log('[Wallet Log]:', JSON.stringify(req.body));
  res.status(200).send();
});

// API endpoints
app.get('/api/members/:memberId', async (req, res) => {
  const member = await db.getMember(req.params.memberId);
  if (!member) return res.status(404).json({ error: 'Not found' });
  const history = await db.getPointsHistory(member.id);
  res.json({ id: member.id, name: member.name, points: member.points, tier: member.tier, memberSince: member.member_since, history });
});

app.post('/api/members/:memberId/points', async (req, res) => {
  const { memberId } = req.params;
  const { points, reason } = req.body;
  if (typeof points !== 'number') return res.status(400).json({ error: 'Points must be number' });
  const member = await db.updateMemberPoints(memberId, points, reason);
  if (!member) return res.status(404).json({ error: 'Not found' });
  console.log(`Points: ${memberId} ${points > 0 ? '+' : ''}${points}`);
  // Apple: APNs push tells the phone to re-fetch. Google: server-side object PATCH (Google
  // then syncs to the phone itself). Both best-effort; a member only has one of the two.
  try { await pushService.notifyPassUpdate(memberId); } catch (e) { console.error('Push failed:', e.message); }
  try {
    await googleWallet.updateObject(member.id, {
      points: member.points,
      currency: member.reward_currency || 'USD',
      rewardValue: member.reward_balance || 0,
      tier: member.tier,
    });
  } catch (e) { console.error('Google update failed:', e.message); }
  res.json({ success: true, member: { id: member.id, points: member.points, tier: member.tier } });
});

// Grant a money reward (separate from points — a kiosk gives either one).
// Body: { amount: number, currency?: string }  (currency defaults to the member's kiosk currency)
app.post('/api/members/:memberId/reward', async (req, res) => {
  const { memberId } = req.params;
  const { amount, currency } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'Amount must be number' });
  const member = await db.addReward(memberId, amount, currency || null);
  if (!member) return res.status(404).json({ error: 'Not found' });
  console.log(`Reward: ${memberId.slice(0, 8)}... ${amount > 0 ? '+' : ''}${amount} ${member.reward_currency}`);
  try { await pushService.notifyPassUpdate(memberId); } catch (e) { console.error('Push failed:', e.message); }
  try {
    await googleWallet.updateObject(member.id, {
      points: member.points,
      currency: member.reward_currency || 'USD',
      rewardValue: member.reward_balance || 0,
      tier: member.tier,
    });
  } catch (e) { console.error('Google update failed:', e.message); }
  res.json({ success: true, member: { id: member.id, reward_balance: member.reward_balance, currency: member.reward_currency, tier: member.tier } });
});

// Profile update endpoint
app.put('/api/members/:memberId', async (req, res) => {
  const { memberId } = req.params;
  const { name } = req.body;
  if (typeof name !== 'string' || name.length > 100) {
    return res.status(400).json({ error: 'Name must be a string (max 100 chars)' });
  }
  const member = await db.updateMemberProfile(memberId, { name: name.trim() || null });
  if (!member) return res.status(404).json({ error: 'Not found' });
  console.log(`Profile: ${memberId.slice(0, 8)}... name="${name}"`);
  try { await pushService.notifyPassUpdate(memberId); } catch (e) { console.error('Push failed:', e.message); }
  res.json({ success: true, member: { id: member.id, name: member.name, points: member.points, tier: member.tier } });
});

// Profile history API (for loading more)
app.get('/api/members/:memberId/history', async (req, res) => {
  const { token, page = 1 } = req.query;
  const member = await db.validateProfileToken(req.params.memberId, token);
  if (!member) return res.status(403).json({ error: 'Unauthorized' });

  const pageNum = parseInt(page) || 1;
  const limit = 20;
  const history = await db.getPointsHistory(member.id, limit * pageNum);
  const offset = (pageNum - 1) * limit;
  const pageHistory = history.slice(offset, offset + limit);
  const hasMore = history.length > offset + limit;

  res.json({ history: pageHistory, hasMore, page: pageNum });
});

// Profile edit page (requires token for security)
app.get('/profile/:memberId', async (req, res) => {
  const { token } = req.query;
  const member = await db.validateProfileToken(req.params.memberId, token);
  if (!member) {
    return res.status(403).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access Denied</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Poppins',-apple-system,sans-serif;font-weight:300;background:#141413;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;color:#fff;text-align:center}h1{font-size:22px;font-weight:500;margin-bottom:12px}p{color:#9E9B96;font-size:14px;line-height:1.5;max-width:320px}</style></head><body><div><h1>Access denied</h1><p>Please open your profile from the link on the back of your wallet pass.</p></div></body></html>`);
  }

  const history = await db.getPointsHistory(member.id, 21); // Fetch 21 to check if there's more
  const baseUrl = getBaseUrl(req);
  const hasName = !!member.name;
  const hasMore = history.length > 20;
  const displayHistory = history.slice(0, 20);

  // Format history for display
  const historyHtml = displayHistory.length > 0
    ? displayHistory.map(h => {
        const date = new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const sign = h.points_change >= 0 ? '+' : '';
        const colorClass = h.points_change >= 0 ? 'positive' : 'negative';
        return `<div class="history-item"><span class="history-points ${colorClass}">${sign}${h.points_change}</span><span class="history-reason">${h.reason || 'Points update'}</span><span class="history-date">${date}</span></div>`;
      }).join('')
    : '<p class="history-empty">No points history yet</p>';

  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Card — Mastercard Experience Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--mc-red:#EB001B;--mc-orange:#F79E1B;--mc-interlock:#FF5F00;--muted:#9E9B96;--line:rgba(255,255,255,0.10)}
body{font-family:'Poppins',-apple-system,'Helvetica Neue',sans-serif;font-weight:300;background:#141413;color:#fff;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:40px 24px}
.card{max-width:420px;width:100%}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.brand svg{display:block}
.brand .t{font-size:15px;font-weight:500;letter-spacing:0.01em}
.brand .t small{display:block;font-size:11px;font-weight:300;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin-top:2px}
.member-id{color:var(--muted);font-size:12px;font-weight:300;letter-spacing:0.10em;text-transform:uppercase;margin-bottom:22px}
.stats{display:flex;gap:16px;margin-bottom:26px}
.stat{flex:1;border:1px solid var(--line);border-radius:14px;padding:16px}
.stat-value{font-size:26px;font-weight:500;line-height:1.1}
.stat-label{font-size:10px;font-weight:600;color:var(--mc-interlock);text-transform:uppercase;letter-spacing:0.10em;margin-top:6px}
.form-group{margin-bottom:20px}
label{display:block;font-size:10px;font-weight:600;color:var(--mc-interlock);text-transform:uppercase;letter-spacing:0.10em;margin-bottom:8px}
input{width:100%;padding:14px 16px;border:1px solid rgba(255,255,255,0.25);border-radius:12px;background:transparent;color:#fff;font-family:'Poppins',sans-serif;font-size:16px;font-weight:300;transition:border-color 150ms ease-out}
input:focus{outline:none;border-color:#fff}
.btn{width:100%;background:#fff;color:#141413;padding:14px;border:none;border-radius:12px;font-family:'Poppins',sans-serif;font-weight:500;font-size:14px;letter-spacing:0.01em;cursor:pointer;transition:opacity 150ms ease-out}
.btn:hover{opacity:0.88}
.btn:disabled{background:rgba(255,255,255,0.3);cursor:not-allowed}
.btn-edit{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,0.35);margin-top:14px}
.btn-edit:hover{border-color:#fff;opacity:1}
.btn-download{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,0.35);margin-top:28px;display:block;text-decoration:none;text-align:center}
.btn-download:hover{border-color:#fff;opacity:1}
.message{border-radius:12px;font-size:14px;font-weight:300}
.message.success,.message.error{padding:14px 16px;margin-bottom:20px;border:1px solid var(--line)}
.success{border-left:3px solid var(--mc-orange)!important}
.error{border-left:3px solid var(--mc-red)!important}
.info{color:var(--muted);font-size:13px;margin-top:20px;line-height:1.5}
.name-display{margin-bottom:24px}
.name-value{font-size:22px;font-weight:400;line-height:1.1;margin-bottom:6px}
.name-label{font-size:10px;font-weight:600;color:var(--mc-interlock);text-transform:uppercase;letter-spacing:0.10em;margin-bottom:6px}
.hidden{display:none}
.history{margin-top:32px;padding-top:24px;border-top:1px solid var(--line)}
.history-title{font-size:10px;font-weight:600;color:var(--mc-interlock);text-transform:uppercase;letter-spacing:0.10em;margin-bottom:14px}
.history-item{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}
.history-item:last-child{border-bottom:none}
.history-points{font-size:14px;font-weight:500;min-width:60px}
.history-points.positive{color:var(--mc-orange)}
.history-points.negative{color:var(--mc-red)}
.history-reason{flex:1;font-size:14px;font-weight:300}
.history-date{font-size:12px;font-weight:300;color:var(--muted)}
.history-empty{color:var(--muted);font-size:14px}
.btn-load-more{margin-top:16px;background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,0.35)}
</style>
</head><body>
<div class="card">
<div class="brand">
<svg width="46" height="30" viewBox="0 0 163.3 108" xmlns="http://www.w3.org/2000/svg" aria-label="Mastercard"><defs><clipPath id="mcP"><circle cx="54" cy="54" r="54"/></clipPath></defs><circle cx="54" cy="54" r="54" fill="#EB001B"/><circle cx="109.3" cy="54" r="54" fill="#F79E1B"/><circle cx="109.3" cy="54" r="54" fill="#FF5F00" clip-path="url(#mcP)"/></svg>
<div class="t">Experience Center Rewards<small>Membership profile</small></div>
</div>
<div class="member-id">Member: ${member.id.slice(0, 8).toUpperCase()}</div>
<div class="stats">
<div class="stat"><div class="stat-value">${member.points.toLocaleString()}</div><div class="stat-label">Points</div></div>
<div class="stat"><div class="stat-value">${member.tier}</div><div class="stat-label">Tier</div></div>
</div>
<div id="message"></div>
<div id="nameDisplay" class="name-display ${hasName ? '' : 'hidden'}">
<div class="name-label">Your Name</div>
<div class="name-value" id="displayName">${member.name || ''}</div>
<button type="button" class="btn btn-edit" id="editBtn">Edit Name</button>
</div>
<form id="profileForm" class="${hasName ? 'hidden' : ''}">
<div class="form-group">
<label for="name">Your Name</label>
<input type="text" id="name" name="name" value="${member.name || ''}" placeholder="Enter your name" maxlength="100" autocomplete="name">
</div>
<button type="submit" class="btn" id="submitBtn">Save Changes</button>
</form>
<p class="info">Your pass will update automatically after saving.</p>
<a href="${baseUrl}/pass/${member.id}" class="btn btn-download">Re-download Pass</a>
<div class="history">
<div class="history-title">Points History</div>
<div id="historyList">${historyHtml}</div>
${hasMore ? '<button type="button" class="btn btn-load-more" id="loadMoreBtn">Load More</button>' : ''}
</div>
</div>
<script>
const form = document.getElementById('profileForm');
const message = document.getElementById('message');
const submitBtn = document.getElementById('submitBtn');
const nameDisplay = document.getElementById('nameDisplay');
const displayName = document.getElementById('displayName');
const editBtn = document.getElementById('editBtn');
const nameInput = document.getElementById('name');

editBtn.addEventListener('click', () => {
  nameDisplay.classList.add('hidden');
  form.classList.remove('hidden');
  nameInput.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';
  message.className = 'message';
  message.textContent = '';
  try {
    const newName = nameInput.value.trim();
    const res = await fetch('${baseUrl}/api/members/${member.id}', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name: newName })
    });
    const data = await res.json();
    if (res.ok) {
      message.className = 'message success';
      message.textContent = 'Profile updated! Your pass will refresh shortly.';
      if (newName) {
        displayName.textContent = newName;
        form.classList.add('hidden');
        nameDisplay.classList.remove('hidden');
      }
    } else {
      throw new Error(data.error || 'Update failed');
    }
  } catch (err) {
    message.className = 'message error';
    message.textContent = err.message;
  }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Save Changes';
});

// Load more history
let currentPage = 1;
const loadMoreBtn = document.getElementById('loadMoreBtn');
const historyList = document.getElementById('historyList');
const token = new URLSearchParams(window.location.search).get('token');

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', async () => {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading...';
    currentPage++;
    try {
      const res = await fetch(\`${baseUrl}/api/members/${member.id}/history?token=\${token}&page=\${currentPage}\`);
      const data = await res.json();
      if (data.history && data.history.length > 0) {
        data.history.forEach(h => {
          const date = new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const sign = h.points_change >= 0 ? '+' : '';
          const colorClass = h.points_change >= 0 ? 'positive' : 'negative';
          historyList.insertAdjacentHTML('beforeend',
            \`<div class="history-item"><span class="history-points \${colorClass}">\${sign}\${h.points_change}</span><span class="history-reason">\${h.reason || 'Points update'}</span><span class="history-date">\${date}</span></div>\`
          );
        });
      }
      if (!data.hasMore) {
        loadMoreBtn.remove();
      } else {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load More';
      }
    } catch (e) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load More';
    }
  });
}
</script>
</body></html>`);
});

// Analytics endpoints removed - query database directly for refresh stats
// Data is still being logged to pass_refreshes table

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Export for Vercel
module.exports = app;
