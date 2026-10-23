# SuperMan — private community + browser

**A real, editable Discord-inspired chat website with a self-hosted web proxy, built with free software.**

- Modern channels, multi-user live chat, presence, searchable history, message persistence, and mobile-friendly design.
- Browser panel, full-screen browser, native upstream proxy, and Wisp/WebSocket support through a single gateway.
- Custom original vector logos for **SuperMan**, **Hyperdrive** and **Ghost Layer**. These are SVG assets (the source can be edited in any text editor); no paid image service is required.
- Password-protected gateway to protect both the chat and proxy.
- Edit site title, colors and channel names in the **gear icon** in the app, or `site-config.json`.
- No subscription, trial, database provider, or paid API required.

## 1. Install (Windows / Mac / Linux)

Install the FREE software below:

1. [Node.js 24 or 26](https://nodejs.org/) — required by the latest proxy engine, not merely the chat website.
2. [Git](https://git-scm.com/) — downloads the current upstream proxy source.

Unzip this project. **On Windows**, you can double-click `INSTALL-SUPERMAN.bat`, then `START-SUPERMAN.bat`. On Mac/Linux, open a terminal inside the `SuperMan-Website` folder, then run:

```bash
npm run setup
npm start
```

Open **http://localhost:3000/hub/** in your browser.

When prompted for a password, open the `.env.local` file in the project root and copy the value after `ACCESS_PASSWORD=`. Keep it private. If you'd like to use your own password, edit `.env.local` while the server is stopped and restart it. The installation commands download open-source packages; a network connection is needed for setup.

> Windows tip: in File Explorer open the folder, type `powershell` in the address bar, then press Enter. Mac tip: right-click the folder and choose *New Terminal at Folder* (or `cd` into it).

The first setup fetches the **latest master branch** of [InvisiProxyLTS](https://github.com/InvisiProxy/InvisiProxyLTS). Its Git commit/version are recorded in `upstream-version.txt`. The repo is actively developed; an upstream update can occasionally break compatibility. Source is installed in `upstream/`; it is not included in this zip. We cannot guarantee every external site will work in the proxy.

### Subsequent launches

```bash
npm start
```

### Update the engine to the latest revision

```bash
npm run setup
npm start
```

This refreshes `upstream/` and resets direct edits made **inside that folder**. Keep your own edits to `public/` and `site-config.json`.

### Try the chat without installing the proxy

```bash
npm run start:hub
```

Chat will work and the browser panel will show a setup-needed notice.

## 2. Get a FREE subdomain

### Fastest: temporary shareable subdomain (free; no payment card / domain)

Install free [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Keep `npm start` running. In a **second** terminal run:

```bash
npm run share
```

On Windows, you can double-click `SHARE-SUBDOMAIN.bat` instead. The script starts Cloudflare, which prints a public `https://random-words.trycloudflare.com` subdomain. Friends can open `https://.../hub/` and enter your password. **The URL changes after restarting cloudflared and your computer must remain on.** Cloudflare states Quick Tunnels are for testing/development, not guaranteed permanent hosting. Browser WebSocket compatibility will depend on network restrictions and the tunnel environment. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

### Stable free subdomain: DuckDNS + home hosting

1. Sign up at [DuckDNS](https://www.duckdns.org/) and create a free name, for example `your-superman.duckdns.org` (only if available).
2. Point DuckDNS to your home's public IP and configure its free dynamic-IP updater.
3. On your router, forward public ports 80/443 to a **reverse proxy** on your host machine. Configure **NGINX** (free) using the included `docs/nginx-example.conf`; add HTTPS via free Let's Encrypt certificates, and reverse proxy to `127.0.0.1:3000`. Allow WebSocket upgrade requests.
4. Access your site at `https://your-superman.duckdns.org/hub/`.

This assumes you have a public IP and control of router port forwarding; it may not work under CGNAT. **Do not forward port 8080 directly**: only the password-protected SuperMan gateway on 3000 should be exposed, preferably behind HTTPS. A public proxy can attract abuse; restrict access to trusted people.

### Other FREE hosted option (with limitations)

Render supports free Node web services with `*.onrender.com` subdomains, but its free tier spins down when idle, has limits on outbound network traffic, and **loses messages stored on its ephemeral filesystem** after restart/redeploy. It is not a good permanent home for your chat history or a high-bandwidth proxy; see [Render Free](https://render.com/docs/free). Avoid buying a plan or adding a payment method if your requirement is strictly €0. The local + tunnel option has no trial deadline.

## 3. Edit SuperMan

| To change | Where |
| --- | --- |
| Site title, description, color, channels | Gear icon in the website, or initial defaults in `site-config.json` |
| Primary brand logo | `public/assets/superman-emblem.svg` |
| Browser engine art | `public/assets/hyperdrive-core.svg` |
| Legacy engine art | `public/assets/ghost-layer.svg` |
| Layout and colors | `public/style.css` |
| UI interactions | `public/app.js` |
| Local chat and gateway server | `server.mjs` |
| Access password | `.env.local` (`ACCESS_PASSWORD=...`) |
| Proxy upstream source | `upstream/` (refresh with `npm run setup`) |

The web settings gear stores changes in `data/site-config.json`, which takes precedence over the defaults; delete that saved file to reset the look. Messages are stored in `data/messages.json`. Back up the `data/` directory if you'd like to preserve chat history. A shared password allows members to change the design, so only share it with trusted people. This is a simple private group chat, **not** a hardened Discord replacement (no per-user authentication, roles, private DMs or file uploads).

## 4. The proxy and rebranding

Upstream source: <https://github.com/InvisiProxy/InvisiProxyLTS> — new home of the project formerly maintained at `QuiteAFancyEmerald/InvisiProxy`.

The current upstream branch reports v8.1.0 as of October 20, 2026. The code uses the **Scramjet** engine. The **Ultraviolet** engine belongs to the earlier legacy version and has been dropped from current upstream. SuperMan shows *Hyperdrive* for the Scramjet engine and *Ghost Layer* for older Ultraviolet-related branding (if that legacy content is present).

Brand changes affect the **visible UI**. `scripts/brand.mjs` sets the upstream title to SuperMan, installs the custom logos, and configures the upstream backend to listen on localhost only. The gateway injects `public/proxy-brand.js` into the upstream homepage to replace visible labels, titles and logo pictures. **The actual package names, service-worker code, URLs, required internal identifiers, original attribution, and licensing are intentionally preserved** so the proxy remains functional and compliant with the upstream **AGPL-3.0-only** license. You may still find upstream names in dependency manifests, licenses, internal comments or network URLs; removing those would break things or obscure proper credit.

If the upstream homepage changes, some visual replacements may require tweaking `public/proxy-brand.js` to match. If the iframe does not work for a particular site, click **Open full browser ↗**; this opens the native proxy interface in its own tab without navigating away from the chat.

## 5. Security and honest limitations

- Shared-access password protects requests and WebSocket upgrades; **there is no end-to-end encryption for group chat**. Use HTTPS when accessed remotely.
- Chat uses Server-Sent Events for live updates and a JSON file for persistence. This is intended for small friend groups, not thousands of users or sensitive discussions.
- The proxy forwards browsing traffic through your server. Do not treat it as equivalent to a VPN or anonymity service, and only browse sites you are authorized to use.
- Do not expose the upstream backend (default port 8080) publicly. The overlay runs on port 3000.
- Upstream installation and build **could not be executed in the artifact build environment** because outbound GitHub/npm downloads are unavailable here. The hub itself has local tests. Exact behavior of the latest upstream build is therefore not verified.
- The three logos are original programmatically generated vector graphics; image-generation service output was unavailable in this session. They are editable and included as source SVGs.

## License and credits

This SuperMan overlay's new original code is distributed under the MIT license (see `LICENSE`). Upstream InvisiProxyLTS is licensed AGPL-3.0-only; the overlay does not erase license headers or upstream credits. Scramjet and its other libraries retain their own license requirements. If you redistribute a complete combined hosted derivative, review the upstream AGPL obligations and publish corresponding source code as required.
