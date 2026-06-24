# Self-hosting on Railway (NAN fork)

This fork of [hashcott/meta-ads-mcp-server](https://github.com/hashcott/meta-ads-mcp-server)
adds **one thing** to upstream: in HTTP mode the `/mcp` endpoint now **requires a
static bearer token** (`MCP_BEARER_TOKEN`). Upstream's HTTP mode is unauthenticated,
which would expose the Meta ad accounts to anyone who finds the Railway URL. The
server now refuses to start in HTTP mode without `MCP_BEARER_TOKEN`. `GET /health`
stays open for the platform healthcheck. The Meta tools themselves are unchanged.

Two independent layers (do not conflate):
- **Server → Meta Graph API:** `META_ADS_ACCESS_TOKEN` (a Meta System User token).
- **Client → this server:** `MCP_BEARER_TOKEN` (static bearer, required in HTTP mode).

Mirrors the existing `nan-ga` GA4/GSC connector pattern (Railway + static bearer +
`mcp-remote` into Claude Desktop).

---

## 1. Meta — non-expiring read-only token

In [business.facebook.com](https://business.facebook.com) → **Business Settings**:

1. Confirm the **NAN Properties** and **Tiara** ad accounts both appear under
   **Accounts → Ad Accounts** in the same Business.
2. **Users → System Users → Add** → name `claude-meta-readonly`, role **Employee**.
3. **Assign assets** → add both ad accounts to this system user with
   **View performance** (read) access — *not* Manage.
4. Create a Meta **App** to mint the token: [developers.facebook.com](https://developers.facebook.com)
   → Create App → type **Business**. Note the App ID.
5. Back on the System User → **Generate new token** → select the app → scopes
   **`ads_read`** and **`business_management`** only. System User tokens are
   **non-expiring**. Copy it now — it is shown once.
6. Record both ad account IDs in `act_XXXXXXXXXX` form (Business Settings →
   Ad Accounts → each account).

> Read-only on purpose: do **not** request `ads_management` and leave
> `META_ADS_ENABLE_WRITE_TOOLS` unset. The 35 read tools cover all analysis.

## 2. Railway

1. New Project → **Deploy from GitHub repo** → pick `thetonyalvarez/meta-ads-mcp-server`.
   `railway.json` already sets build (`npm run build`), start (`npm start`), and
   healthcheck (`/health`) — no Dockerfile needed (Nixpacks).
2. Service → **Variables**:

   | Variable | Value |
   |----------|-------|
   | `TRANSPORT` | `http` |
   | `META_ADS_ACCESS_TOKEN` | the System User token from step 1 |
   | `MCP_BEARER_TOKEN` | a new long random secret (see below) |

   Leave `META_ADS_ENABLE_WRITE_TOOLS` unset (read-only) and `PORT` unset
   (Railway injects it). Generate the bearer secret:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. Deploy. Under **Settings → Networking** generate a public domain. Confirm:
   ```
   curl https://<your-railway-domain>/health      # -> {"status":"ok",...}
   ```

## 3. Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add a
sibling to the existing `nan-ga` server inside `mcpServers` (same `mcp-remote`
shape — the `Authorization:${AUTH_HEADER}` form avoids mcp-remote's space-parsing
bug):

```json
"nan-meta-ads": {
  "command": "/Users/tonyalvarez/.nvm/versions/node/v20.20.2/bin/npx",
  "args": [
    "-y",
    "mcp-remote",
    "https://<your-railway-domain>/mcp",
    "--header",
    "Authorization:${AUTH_HEADER}"
  ],
  "env": {
    "AUTH_HEADER": "Bearer <MCP_BEARER_TOKEN>",
    "PATH": "/Users/tonyalvarez/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  }
}
```

Replace `<your-railway-domain>` and `<MCP_BEARER_TOKEN>` (the same value set on
Railway). Restart Claude Desktop.

## 4. Verify end-to-end

| Check | Expected |
|-------|----------|
| `curl https://<domain>/health` | `{"status":"ok",...}` |
| `curl -X POST https://<domain>/mcp` (no header) | `401` |
| Same POST with `Authorization: Bearer <token>` + an `initialize` body | `200` + JSON-RPC result |
| In Claude Desktop: "list my Meta ad accounts" | both NAN + Tiara `act_` IDs |
| Ask for last-30-day insights per `act_id` | spend / impressions / results return |
| Tools available | read tools only (no create/update/delete/pause) |

## Pulling upstream updates later

```
git remote add upstream https://github.com/hashcott/meta-ads-mcp-server.git
git fetch upstream && git merge upstream/master
```
The auth change lives only in `src/index.ts` (plus `railway.json`, `.env.example`,
this file), so upstream merges should stay clean.
