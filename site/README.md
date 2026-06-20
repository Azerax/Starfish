# projectstarfish.ca

Static one-page marketing site for Project Starfish. No build step - plain HTML/CSS/JS.

## Files
- `index.html` · `styles.css` · `main.js` - the page
- `favicon.svg` · `og.png` - icons / social card
- `_headers` - Cloudflare Pages security headers + CSP + caching
- `404.html`, `robots.txt`, `sitemap.xml`

## Deploy on Cloudflare Pages
1. Push this repo (or just the `site/` folder) to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings: **Framework preset = None**, **Build command = (blank)**, **Output directory = `site`**
   (or `/` if you deploy the folder directly).
4. After the first deploy, **Custom domains → Set up a custom domain → `projectstarfish.ca`**
   (Cloudflare adds the CNAME automatically when the domain is on your account).
5. `_headers` is applied automatically by Pages.

### Direct upload (no Git)
Workers & Pages → Create → Pages → **Upload assets** → drag the contents of `site/`.

## Edit
All copy lives in `index.html`. Colors/layout in `styles.css` (`:root` variables at top).
The install command appears once in `index.html` (`#installcmd`).
