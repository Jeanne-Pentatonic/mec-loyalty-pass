// Shared HTML pages (landing), Mastercard-first design for the MEC demo.
// Used by both the Vercel handler (api/index.js) and the local dev server (src/index.js).

// Official Mastercard interlocking-circles mark. Overlap drawn exactly (#FF5F00)
// by clipping the orange circle to the red one.
const MC_MARK = (size) => {
  const id = `mcL${size}`; // unique per rendered size so two marks on one page don't collide
  return `
<svg width="${size}" height="${Math.round(size * 108 / 163.3)}" viewBox="0 0 163.3 108" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mastercard">
  <defs><clipPath id="${id}"><circle cx="54" cy="54" r="54"/></clipPath></defs>
  <circle cx="54" cy="54" r="54" fill="#EB001B"/>
  <circle cx="109.3" cy="54" r="54" fill="#F79E1B"/>
  <circle cx="109.3" cy="54" r="54" fill="#FF5F00" clip-path="url(#${id})"/>
</svg>`;
};

const APPLE_GLYPH = `<svg width="18" height="22" viewBox="0 0 384 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>`;

const GOOGLE_GLYPH = `<svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

/**
 * Landing page: black, Mastercard mark front and centre, QR on desktop,
 * wallet buttons on mobile.
 */
function renderLandingPage({ qrDataUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mastercard Experience Centre — Rewards</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--mc-red:#EB001B;--mc-orange:#F79E1B;--mc-interlock:#FF5F00;--ink:#FFFFFF;--muted:#9E9B96;--bg:#141413}
body{font-family:'Poppins',-apple-system,'Helvetica Neue',sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 24px;overflow-x:hidden}
/* huge, whisper-quiet circles echoing the mark */
.bg-circles{position:fixed;inset:0;pointer-events:none;z-index:0}
.bg-circles div{position:absolute;border-radius:50%;border:1px solid rgba(255,255,255,0.05)}
.bg-circles .c1{width:110vmax;height:110vmax;right:-55vmax;top:-40vmax;border-color:rgba(235,0,27,0.08)}
.bg-circles .c2{width:90vmax;height:90vmax;right:-30vmax;top:-25vmax;border-color:rgba(247,158,27,0.08)}
.bg-circles .c3{width:60vmax;height:60vmax;left:-30vmax;bottom:-35vmax}
.wrap{position:relative;z-index:1;width:100%;max-width:420px;text-align:center}
.mark{display:flex;justify-content:center;margin-bottom:28px}
h1{font-weight:300;font-size:28px;letter-spacing:0.01em;line-height:1.25}
h1 strong{font-weight:600}
.sub{color:var(--muted);font-weight:300;font-size:15px;margin-top:8px;margin-bottom:36px}
.qr-tile{background:#FFFFFF;border-radius:24px;padding:22px;display:inline-block;box-shadow:0 0 0 1px rgba(255,255,255,0.06),0 24px 80px rgba(235,0,27,0.10)}
.qr-tile img{display:block;width:240px;height:240px}
.hint{color:var(--muted);font-size:13px;font-weight:300;margin-top:18px;margin-bottom:34px}
.btns{display:flex;flex-direction:column;gap:12px;align-items:center}
.wallet-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;max-width:300px;background:#000;color:#fff;border:1.5px solid rgba(255,255,255,0.35);border-radius:14px;padding:14px 22px;text-decoration:none;font-size:15px;font-weight:500;letter-spacing:0.01em;transition:border-color .15s ease,transform .15s ease}
.wallet-btn:hover{border-color:#fff;transform:translateY(-1px)}
.divider{display:flex;align-items:center;gap:14px;color:var(--muted);font-size:12px;font-weight:300;text-transform:uppercase;letter-spacing:0.18em;margin:30px 0 22px}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.18))}
.divider::after{background:linear-gradient(90deg,rgba(255,255,255,0.18),transparent)}
footer{margin-top:44px}
/* co-brand lockup: symbol first, divider, partner at equal visual weight */
.cobrand{display:flex;align-items:center;justify-content:center;gap:14px}
.cobrand .rule{width:1px;height:26px;background:rgba(255,255,255,0.28)}
.cobrand .partner{font-weight:500;font-size:14px;letter-spacing:0.22em;color:var(--ink)}
.fineprint{margin-top:14px;color:var(--muted);font-size:12px;font-weight:300;letter-spacing:0.02em}
@media (max-width:640px){.qr-tile,.hint,.divider{display:none}h1{font-size:24px}.sub{margin-bottom:28px}}
</style>
</head>
<body>
<div class="bg-circles" aria-hidden="true"><div class="c1"></div><div class="c2"></div><div class="c3"></div></div>
<main class="wrap">
  <div class="mark">${MC_MARK(76)}</div>
  <h1>Experience Centre<br><strong>Rewards</strong></h1>
  <p class="sub">One card. Anywhere in the world. Every visit rewarded.</p>
  <div class="qr-tile"><img src="${qrDataUrl}" alt="QR code — scan to add your card"></div>
  <p class="hint">Scan with your phone camera to add the card to your wallet</p>
  <div class="divider">or add directly</div>
  <div class="btns">
    <a class="wallet-btn" href="/pass">${APPLE_GLYPH} Add to Apple Wallet</a>
    <a class="wallet-btn" href="/gpass">${GOOGLE_GLYPH} Add to Google Wallet</a>
  </div>
  <footer>
    <div class="cobrand">${MC_MARK(34)}<span class="rule"></span><span class="partner">PENTATONIC</span></div>
    <div class="fineprint">Mastercard Experience Centre</div>
  </footer>
</main>
</body>
</html>`;
}

module.exports = { renderLandingPage, MC_MARK };
