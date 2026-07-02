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

const ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID;
const CLASS_SUFFIX = process.env.GOOGLE_WALLET_CLASS || 'mec_loyalty_v1';
const LOGO_URL = process.env.GOOGLE_WALLET_LOGO_URL
  || 'https://pub-ab109a8a73bd4a89a0df2c903e8e86e7.r2.dev/pentatonic-logo.png';

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

module.exports = { isConfigured, buildSaveUrl };
