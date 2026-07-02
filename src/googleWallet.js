// Google Wallet (Android) loyalty pass — mirrors the Apple pass.
// Signs an "Add to Google Wallet" JWT (RS256) with a service-account key.
// Uses only Node's built-in crypto (no extra dependency, so no lockfile churn).
//
// Required env (from the Google Pay & Wallet Console):
//   GOOGLE_WALLET_ISSUER_ID          - your numeric issuer id
//   GOOGLE_SERVICE_ACCOUNT_BASE64    - base64 of the service-account JSON key file
// Optional env:
//   GOOGLE_WALLET_CLASS              - class suffix (default mec_loyalty_v1)
//   GOOGLE_WALLET_LOGO_URL           - hosted PNG/JPEG logo url for the pass
const crypto = require('crypto');
const https = require('https');

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID;
const CLASS_SUFFIX = process.env.GOOGLE_WALLET_CLASS || 'mec_loyalty_v1';
const LOGO_URL = process.env.GOOGLE_WALLET_LOGO_URL
  || 'https://mec-loyalty-pass.vercel.app/logo.png';
const HERO_URL = process.env.GOOGLE_WALLET_HERO_URL
  || 'https://mec-loyalty-pass.vercel.app/hero.png';

function getServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function isConfigured() {
  return !!(ISSUER_ID && getServiceAccount());
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Build an "Add to Google Wallet" save URL for a member.
 * @param {object} member - { id, name, points, tier }
 * @param {object} opts - { currency, rewardValue, baseUrl }
 * @returns {string} https://pay.google.com/gp/v/save/<jwt>
 */
function buildSaveUrl(member, { currency = 'USD', rewardValue = 0, baseUrl = '' } = {}) {
  const sa = getServiceAccount();
  if (!sa || !ISSUER_ID) throw new Error('Google Wallet not configured');

  const classId = `${ISSUER_ID}.${CLASS_SUFFIX}`;
  const objectId = `${ISSUER_ID}.${String(member.id).replace(/[^\w.-]/g, '_')}`;

  const loyaltyClass = {
    id: classId,
    issuerName: 'Pentatonic',
    programName: 'Mastercard Experience Centre',
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: '#171717',
    programLogo: { sourceUri: { uri: LOGO_URL } },
    heroImage: { sourceUri: { uri: HERO_URL } },
  };

  const loyaltyObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    accountId: member.id,
    accountName: member.name || 'Member',
    loyaltyPoints: { label: 'Points', balance: { int: String(member.points || 0) } },
    secondaryLoyaltyPoints: {
      label: 'Reward',
      balance: { money: { currencyCode: currency, micros: Math.round((rewardValue || 0) * 1e6) } },
    },
    barcode: { type: 'QR_CODE', value: member.id },
    textModulesData: [{ id: 'tier', header: 'Tier', body: member.tier || 'GREEN' }],
  };

  const claims = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: baseUrl ? [baseUrl] : [],
    payload: { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] },
  };

  const token = signJwt(claims, sa.private_key);
  return `https://pay.google.com/gp/v/save/${token}`;
}

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// OAuth2 access token for the Wallet API (service-account JWT-bearer grant).
async function getAccessToken() {
  const sa = getServiceAccount();
  if (!sa) throw new Error('Google Wallet not configured');
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }, sa.private_key);
  const res = await httpsRequest(
    { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
  );
  const at = JSON.parse(res.body).access_token;
  if (!at) throw new Error('token exchange failed: ' + res.body.slice(0, 200));
  return at;
}

/**
 * Push updated points/reward/tier to a member's Google Wallet object.
 * Google syncs the change to the phone automatically — no per-device push needed.
 * No-op (returns {skipped}) if Google Wallet isn't configured. Returns {status:404}
 * if the member never added a Google pass (object doesn't exist) — caller can ignore.
 */
async function updateObject(memberId, { points = 0, currency = 'USD', rewardValue = 0, tier = 'GREEN' } = {}) {
  if (!isConfigured()) return { skipped: 'not configured' };
  const objectId = `${ISSUER_ID}.${String(memberId).replace(/[^\w.-]/g, '_')}`;
  const at = await getAccessToken();
  const patch = {
    loyaltyPoints: { label: 'Points', balance: { int: String(points) } },
    secondaryLoyaltyPoints: {
      label: 'Reward',
      balance: { money: { currencyCode: currency, micros: Math.round((rewardValue || 0) * 1e6) } },
    },
    textModulesData: [{ id: 'tier', header: 'Tier', body: tier }],
  };
  const res = await httpsRequest(
    { hostname: 'walletobjects.googleapis.com', path: `/walletobjects/v1/loyaltyObject/${objectId}`, method: 'PATCH', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } },
    JSON.stringify(patch)
  );
  return { status: res.status };
}

/**
 * Push the current class design (logo, hero, background) to an already-created
 * loyalty class. JWT payloads only create classes — design changes to an existing
 * class must go through the API, which is what this does.
 */
async function updateClass() {
  if (!isConfigured()) return { skipped: 'not configured' };
  const classId = `${ISSUER_ID}.${CLASS_SUFFIX}`;
  const at = await getAccessToken();
  const patch = {
    hexBackgroundColor: '#171717',
    programLogo: { sourceUri: { uri: LOGO_URL } },
    heroImage: { sourceUri: { uri: HERO_URL } },
  };
  const res = await httpsRequest(
    { hostname: 'walletobjects.googleapis.com', path: `/walletobjects/v1/loyaltyClass/${classId}`, method: 'PATCH', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } },
    JSON.stringify(patch)
  );
  return { status: res.status, body: res.body.slice(0, 300) };
}

module.exports = { isConfigured, buildSaveUrl, updateObject, updateClass };
