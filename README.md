# 0x0

A minimal, self-hosted file hosting service on **Cloudflare Workers + R2 + KV**. Upload files, paste text, pipe command output — get a short URL with a syntax-highlighted viewer.

Runs entirely on the Cloudflare free tier.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/connorshinn/0x0.gg)

## Features

- **IP-based auth** — authorize once per network, upload freely after
- **Rate limiting** — auto-bans IPs after 5 failed password attempts (24h ban)
- **Short URLs** — sequential 3-character IDs (`000` → `zzz`, 37k+ URLs)
- **Syntax highlighting** — highlight.js with the StackOverflow Dark theme
- **Code viewer** — line numbers, word wrap toggle, zoom (Ctrl+/−), search (Ctrl+F), select all (code only)
- **Format toggle** — pretty-prints inline JSON, XML, and key=value pairs in logs
- **URL linkification** — clickable URLs in code
- **Pipe support** — pipe command output directly with auto-detected language
- **Image preview** — inline image viewer for image uploads
- **Raw / download** — `/raw` and `/dl` endpoints for every file
- **Configurable retention** — `UPLOAD_TTL_HOURS` controls when links expire and R2 files are deleted

## One-Click Deploy

Click the button above to deploy to your Cloudflare account. Cloudflare will automatically provision the R2 bucket and KV namespace.

After deploying, set your upload password secret:

```bash
# 1. Clone your new repo and generate a strong password
node setup.mjs

# 2. Set the secret on your Worker
npx wrangler secret put PASSWORD
# paste the password from step 1
```

Uploads expire after `UPLOAD_TTL_HOURS` hours. The default is `168` hours in `wrangler.toml`.

## Manual Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create R2 bucket and KV namespace

```bash
wrangler r2 bucket create 0x0-files
wrangler kv namespace create KV
```

Copy the KV namespace ID into `wrangler.toml`.

### 3. Configure retention

Set `UPLOAD_TTL_HOURS` in `wrangler.toml`:

```toml
[vars]
UPLOAD_TTL_HOURS = "168"
```

The scheduled Worker trigger deletes expired R2 files:

```toml
[triggers]
crons = ["0 * * * *"]
```

### 4. Set password

```bash
npm run setup

wrangler secret put PASSWORD
# paste the password value
```

### 5. Deploy

```bash
wrangler deploy
```

### 6. Custom domain (optional)

Deploy first using the default `workers.dev` URL. To use your own domain, the domain must already be active in your Cloudflare account.

In Cloudflare, open your Worker and add the domain from:

`Settings` → `Domains & Routes` → `Add` → `Custom Domain`

Custom domains are intentionally not stored in `wrangler.toml`, so this template can be deployed by anyone without trying to bind to `0x0.gg`.

## Usage

### Authorize

```bash
curl -d "p=YOUR_PASSWORD" https://your-worker.workers.dev/auth
```

### Upload a file

```bash
curl -F "file=@photo.png" https://your-worker.workers.dev/
```

### Pipe stdin

```bash
echo "hello world" | curl -sF file=@- https://your-worker.workers.dev/
```

### Pipe command output or upload a file

Add this to your `.bashrc` / `.zshrc`:

```bash
0x0() {
  if [ "$#" -eq 1 ] && [ -f "$1" ]; then
    curl -sF "file=@$1" https://your-worker.workers.dev/
  else
    "$@" | curl -sF file=@- -F "cmd=$*" https://your-worker.workers.dev/
  fi
}
```

Then:

```bash
0x0 ./wrangler.toml
0x0 docker logs my-app
0x0 kubectl get pods
0x0 cat /var/log/syslog
```

For command output, the command name appears in the viewer toolbar.

### Delete a file

```bash
curl -X DELETE https://your-worker.workers.dev/abc
```

### View, raw, and download

```
https://your-worker.workers.dev/abc      # viewer
https://your-worker.workers.dev/abc/raw  # raw content
https://your-worker.workers.dev/abc/dl   # download
```

## Architecture

| Component | Purpose |
|-----------|---------|
| Worker | Request routing, auth, rate limiting, HTML rendering |
| R2 | File blob storage (no egress fees) |
| KV | IP allowlist, file metadata, rate limit counters, ID counter |

## Cost

On Cloudflare's free tier:

- **Workers**: 100k requests/day
- **R2**: 10 GB storage, no egress fees
- **KV**: 100k reads/day, 1k writes/day

For personal use, this is effectively **free**.
