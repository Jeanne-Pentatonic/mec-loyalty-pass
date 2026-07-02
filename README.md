# Pentatonic Apple Wallet Loyalty Pass

Auto-updating Apple Wallet membership passes with tier-based theming, push notifications, and location awareness.

## Features

- **Dynamic tier colors** - GREEN, SILVER, GOLD, PLATINUM with unique themes
- **Push notifications** - Real-time pass updates when points change
- **Store locations** - Pass appears on lock screen near Pentatonic stores
- **Refresh tracking** - Analytics on pass usage patterns
- **Vercel + Turso** - Serverless deployment with edge database

## Quick Start

```bash
npm install
npm run dev          # Local development
```

## Database Commands

Query the database locally:

```bash
npm run db:members    # List all members with points/tier
npm run db:refreshes  # Show refresh stats per member
npm run db:recent     # Last 15 refresh events
npm run db            # Show help

# Custom SQL
npm run db sql "SELECT COUNT(*) FROM members"
```

Requires `.env.local` with Turso credentials (see Setup).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page with QR code |
| `/pass` | GET | Generate new membership pass |
| `/profile/:id` | GET | Profile edit page |
| `/health` | GET | Health check |
| `/api/members/:id` | GET | Get member info |
| `/api/members/:id` | PUT | Update member profile (name) |
| `/api/members/:id/points` | POST | Add/remove points |

### Apple Wallet Web Service

| Endpoint | Description |
|----------|-------------|
| `POST /v1/devices/:deviceId/registrations/:passTypeId/:serial` | Device registration |
| `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial` | Device unregistration |
| `GET /v1/devices/:deviceId/registrations/:passTypeId` | Get passes for device |
| `GET /v1/passes/:passTypeId/:serial` | Get updated pass |
| `POST /v1/log` | Wallet error logging |

## Tier System

| Tier | Points Required | Theme |
|------|-----------------|-------|
| GREEN | 0 | Dark with green accent |
| SILVER | 1,000 | Silver-gray theme |
| GOLD | 5,000 | Warm gold theme |
| PLATINUM | 10,000 | Blue premium theme |

## Store Locations

Pass appears on lock screen near:
- **Worthing**: 13 Heene Terrace, BN11 3NR
- **London**: 27 Downham Road, N1 5AA

## Setup

### 1. Environment Variables

Create `.env.local` for local development:

```bash
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

### 2. Vercel Environment Variables

Set in Vercel dashboard (Settings > Environment Variables):

```
SIGNER_CERT_BASE64=...    # Base64 encoded signing certificate
SIGNER_KEY_BASE64=...     # Base64 encoded private key
WWDR_CERT_BASE64=...      # Base64 encoded Apple WWDR G4 cert
TURSO_DATABASE_URL=...    # Turso database URL
TURSO_AUTH_TOKEN=...      # Turso auth token
APNS_KEY_BASE64=...       # Base64 encoded APNs key (.p8)
APNS_KEY_ID=...           # APNs key ID
PASS_TYPE_ID=pass.com.pentatonic.loyalty
TEAM_ID=SJPM5MT6LL
```

### 3. Certificate Setup

See [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list/passTypeId) to create:
1. Pass Type ID: `pass.com.pentatonic.loyalty`
2. Pass Type ID Certificate (export as .p12, convert to PEM)
3. APNs Key for push notifications

Convert certificates to base64:
```bash
base64 -i certificates/signerCert.pem | tr -d '\n'
base64 -i certificates/signerKey.pem | tr -d '\n'
base64 -i certificates/wwdr.pem | tr -d '\n'
base64 -i certificates/apns/AuthKey.p8 | tr -d '\n'
```

## Deployment

Push to GitHub triggers Vercel deployment:

```bash
git add -A && git commit -m "Update" && git push
```

## Adding Points

```bash
curl -X POST https://your-domain.vercel.app/api/members/MEMBER_ID/points \
  -H "Content-Type: application/json" \
  -d '{"points": 100, "reason": "Purchase bonus"}'
```

**Important:** Always use the API to modify points. Direct SQL updates bypass push notifications and passes won't update automatically. The API triggers APNs push notifications that tell iOS to refresh the pass.

### Viewing Points History

```bash
# View history for a specific member
npm run db sql "SELECT points_change, reason, created_at FROM points_history WHERE member_id = 'MEMBER_ID' ORDER BY created_at DESC"

# View all recent point changes
npm run db sql "SELECT m.name, h.points_change, h.reason, h.created_at FROM points_history h JOIN members m ON h.member_id = m.id ORDER BY h.created_at DESC LIMIT 20"
```

## Editing Profile

Members can edit their profile (name) via:
1. **Pass back** - Tap "Edit Profile" link on pass back
2. **Direct URL** - `https://your-domain.vercel.app/profile/MEMBER_ID`
3. **API** - `PUT /api/members/MEMBER_ID` with `{"name": "New Name"}`

After saving, a push notification triggers pass refresh.

## Troubleshooting

### Pass won't download
- Check certificate encoding (no "Bag Attributes" in PEM files)
- Verify WWDR is G4 version
- Check Vercel logs for errors

### Push notifications not working
- Verify APNS_KEY_ID matches key in Developer Portal
- Ensure device is registered (check `registrations` table)
- APNs uses production environment for Wallet passes

### Tier colors not changing
- Delete pass from Wallet and re-add
- Check member's tier in database: `npm run db:members`

## License

MIT
