# 🏋️ FitFlow Pro — PWA Fitness App

All-in-one fitness Progressive Web App. Deploy on GitHub Pages for free.

## 📁 Files
- `index.html` — Full app (all pages)
- `css/style.css` — Design system
- `js/data.js` — All workout data
- `js/app.js` — Core state & storage
- `js/auth.js` — Login logic
- `js/dashboard.js` — Dashboard & modules
- `js/running.js` — GPS run tracker
- `js/admin.js` — Admin panel
- `manifest.json` — PWA manifest
- `sw.js` — Offline service worker
- `google-apps-script.js` — Optional Sheets backend

## 🚀 Deploy to GitHub Pages (Free)

1. Go to https://github.com → Sign up / Sign in
2. Click **New repository** → Name it `fitflow-pro` → Create
3. Click **uploading an existing file**
4. Upload ALL files (keep folder structure: css/, js/)
5. Go to **Settings → Pages → Source: main branch** → Save
6. Your app URL: `https://YOUR-USERNAME.github.io/fitflow-pro`

## 📱 Install on Android

1. Open the URL in Chrome on Android
2. Tap the **3-dot menu → Add to Home Screen**
3. Done! Works like a native app, even offline.

## 🔑 Demo Login
- Admin: `admin@fitflow.com` / `admin123`
- User: `user@fitflow.com` / `user123`

## ➕ Add Users
Login as Admin → Admin Panel → Add New User

## 📊 Google Sheets (Optional)
1. Create a Google Sheet
2. Go to Extensions → Apps Script
3. Paste contents of `google-apps-script.js`
4. Run `setupDefaultData()` once
5. Deploy → New Deployment → Web App → Anyone
6. Copy the URL → App Admin Panel → Content → Configure Sheets
