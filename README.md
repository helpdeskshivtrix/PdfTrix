# PdfTrix - PWA + Android APK + Windows app

All three apps share one web app in `www/` (blue/cyan/gold theme from your logo, all libraries bundled locally so it works fully offline).

```
www/           PWA (deploy this folder to any HTTPS host)
android-app/   Capacitor project -> APK
windows-app/   Electron project  -> .exe installer + portable .exe
resources/     logo-based icons / splash (1024px sources)
.github/       workflows that build the APK and the .exe for you
```

## 1. PWA
Upload the contents of `www/` to any HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, Vercel).
Open it in Chrome/Edge -> "Install". Locally: `cd www && python -m http.server 8080` (localhost counts as secure).
The service worker caches everything. OCR engine + English data download once on first OCR use, then work offline.

## 2. Android APK
Easiest (no setup): push this folder to a GitHub repo -> Actions -> "Build Android APK" -> Run workflow -> download `app-debug.apk` from Artifacts.

Local build (needs Node 20, JDK 17, Android SDK):
```
cd android-app
npm install
npm run sync          # copies ../www into the Android project
npm run apk:debug     # APK: android/app/build/outputs/apk/debug/app-debug.apk
```
Or open `android-app/android` in Android Studio after `npm run sync`.
For Play Store you need a signed release build / AAB (create a keystore, then `./gradlew bundleRelease`).
Saving files on Android opens the share sheet (Save to Files / Drive etc.).

## 3. Windows app
Easiest: GitHub Actions -> "Build Windows App" -> download the installer and portable `.exe`.

Local build on Windows:
```
cd windows-app
npm install
npm start             # run in a window
npm run build:win     # dist/PdfTrix-Setup-1.0.0.exe and -portable.exe
```
(The installer is unsigned, so Windows SmartScreen shows "More info -> Run anyway" until you add a code-signing certificate.)

## Share / Open with (new)
- **Android:** after installing the APK, PdfTrix appears in the Share sheet and "Open with" for PDF, Word (.docx), text, images and audio / voice notes (WhatsApp, Files, Gmail, Drive...). Shared files become a PDF in the editor. Several shared photos are merged into one PDF.
- **Windows:** the installer registers PDF, DOCX, TXT, MD, JPG, PNG, WebP, MP3, WAV, OGG, OPUS, M4A (right-click -> Open with -> PdfTrix).
- **Voice to PDF:** a Whisper speech model downloads once (about 40 MB, needs internet), is cached, then transcribes on the device. Old `.doc` files are not supported (save as .docx).

## Notes
- OCR: English works offline out of the box. Other languages download their data from the internet when first used.
- `pdf-lib-plus-encrypt@1.1.1` (used in your index.html) is not on npm; `1.1.0` is bundled instead. Test the Encrypt feature.
- App id: `app.shivtrix.pdfpro` (change in `android-app/capacitor.config.json` and `windows-app/package.json` if you want your own).

## What changed in this version

- Renamed to **PdfTrix**.
- **Dashboard** is now a minimal full-page viewer: Upload, Download, OCR, TTS, Full screen. All edit, convert, security, forms and automate tools are one step ahead behind the "Tools" button.
- **Full screen** button in the viewer and in the editor (hides bars; the editor has a tools toggle).
- **Zoom** uses fixed steps only: 25% to 400% in 25% steps, plus Fit width and Fit page. Pinch and free wheel zoom are disabled.
- **TTS** (Read aloud) uses the voices installed on the device.
