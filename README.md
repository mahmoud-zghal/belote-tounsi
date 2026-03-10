# Belote Tounsi APK Repo

This repo packages **Belote Tounsi** as an Android WebView app and includes GitHub Actions to build a debug APK.

## Structure
- `app/` → Android app (WebView wrapper)
- `web/` → Belote multiplayer web app (frontend + server)
- `.github/workflows/android-apk.yml` → CI build for APK artifact

## Build APK on GitHub
1. Push this repo to GitHub.
2. Open **Actions** → **Build Android APK**.
3. Trigger with **Run workflow** (or push to main/master).
4. Download artifact: `belote-tounsi-debug-apk`.

## Run web server for the app
The Android app opens your web URL (first launch asks for server URL).

Frontend:
```bash
cd web
python3 -m http.server 8080
```

Backend:
```bash
cd web/server
npm install
npm start
```

Use URL like `http://<your-lan-ip>:8080` in the app.
