# 💧 Mikesell Water Supply — Admin Portal

Realtime water billing system. Free hosting on GitHub Pages + Firebase.

---

## Files
```
mikesell/
├── index.html       ← Main page
├── css/
│   └── style.css    ← All styles
├── js/
│   └── app.js       ← All logic + Firebase
└── README.md
```

---

## Step 1 — Upload to GitHub

1. Go to **github.com** → sign in → **New repository**
2. Name: `mikesell-water` → Public → **Create repository**
3. Click **uploading an existing file**
4. Upload ALL files keeping the folder structure:
   - `index.html`
   - `css/style.css`
   - `js/app.js`
5. Click **Commit changes**

---

## Step 2 — Enable GitHub Pages

1. Go to repository **Settings → Pages**
2. Source: **Deploy from a branch** → branch: `main` → folder: `/ (root)`
3. Click **Save**
4. Live at: `https://YOUR-USERNAME.github.io/mikesell-water/`

---

## Step 3 — Firebase Setup (Free Database)

1. Go to **console.firebase.google.com**
2. **Add project** → name: `mikesell-water` → Continue
3. Left sidebar: **Build → Realtime Database → Create Database**
4. Choose **Start in test mode** → Enable
5. Copy your URL: `https://mikesell-water-xxxxx-default-rtdb.firebaseio.com`

---

## Step 4 — Connect

1. Open your GitHub Pages site
2. Paste Firebase URL in the banner → **Connect**
3. Data syncs live across all devices!

---

## Features
- Dashboard with stats
- Add / Edit / Delete connections
- Update meter readings (auto-shifts prev → present)
- Generate & print receipts with GCash QR
- Current Due overview
- Mobile responsive
- Realtime sync via Firebase
