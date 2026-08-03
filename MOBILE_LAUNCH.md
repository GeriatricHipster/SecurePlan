# Launch SecurePlan on Web, iPhone, iPad, and Android

## Recommended launch: one HTTPS web address

Deploy SecurePlan once, then use the same HTTPS address everywhere. It works as a normal web app on computers and as an installable Progressive Web App (PWA) on Apple and Android devices. This is the fastest launch path and keeps every user on the same release.

The included Render Blueprint is the simplest hosted option:

1. Push the project to a GitHub repository.
2. In Render, choose **New > Blueprint** and connect the repository.
3. Enter a private, random `SETUP_CODE` when prompted.
4. Deploy the Blueprint.
5. Open the generated `https://...onrender.com` URL and create the owner account using that setup code.

Render sets `RENDER_EXTERNAL_URL`; SecurePlan uses it automatically, so `APP_ORIGIN` is not needed for the generated Render URL. For a custom domain, set `APP_ORIGIN=https://your-domain.example` in Render and redeploy.

The Blueprint uses a persistent disk for the SQLite database, PDFs, and photos. Render persistent disks require a paid service. Back up the disk, and do not move the service to a diskless plan unless storage has been migrated elsewhere.

## Use in a web browser

Open the hosted HTTPS address in a current desktop or mobile browser. Sign in normally, or choose **Use invitation code** to create an invited account. No installation is required.

## Install on iPhone or iPad

Safari provides the most consistent Home Screen installation path:

1. Open the hosted HTTPS address in Safari.
2. Tap **Share**.
3. Scroll down and tap **Add to Home Screen**.
4. If **Open as Web App** is shown, leave it turned on.
5. Tap **Add**.
6. Launch **SecurePlan Surveyor** from the Home Screen.

If **Add to Home Screen** is not visible, scroll to the bottom of the Share sheet, choose **Edit Actions**, and add it.

## Install on Android

In Chrome:

1. Open the hosted HTTPS address.
2. Tap the browser menu (three dots).
3. Tap **Install app**. On some devices this is shown as **Add to Home screen**.
4. Confirm **Install**.
5. Launch **SecurePlan Surveyor** from the launcher or Home Screen.

SecurePlan may also show its own install prompt when the browser reports that installation is available.

## Installable PWA versus an app-store release

The PWA above is a real installable application: it has a Home Screen icon, opens in an app-style window, and uses the same secured cloud data and real-time collaboration as the web version. It does not require Apple App Store or Google Play approval.

The repository also includes `ios/` and `android/` Capacitor projects. Those projects are intended for native development and eventual store distribution, but source code alone is not a signed store release. Before publishing, the owner still needs Apple and Google developer accounts, signing identities, store listings and screenshots, privacy/data-safety disclosures, account-deletion support, and real-device review testing.

## Build the native iOS and Android projects

### 1. Deploy the server first

The native apps connect to the same hosted SecurePlan server as the web app. It must use HTTPS.

On that server, allow both native WebView origins:

```dotenv
MOBILE_ORIGINS=capacitor://localhost,https://localhost
```

This value is already present in `render.yaml`.

### 2. Configure the native API URL

From the project root:

```bash
cp .env.native.example .env.native
```

Edit `.env.native` so it contains the deployed server origin, without a trailing slash:

```dotenv
VITE_API_URL=https://your-secureplan-host.example.com
```

`VITE_API_URL` is a public server address, not a secret. `.env.native` is ignored by Git so each build machine can use its intended server.

### 3. Install and sync

Node.js 22 or newer is required:

```bash
npm ci
npm run native:sync
```

This builds the native web bundle and copies it into both platform projects.

### 4. Open iOS

iOS builds require macOS, current Xcode, and an Apple signing team. Run:

```bash
npm run native:ios
```

Select an iPhone/iPad simulator or a signed connected device in Xcode, then press **Run**.

### 5. Open Android

Android builds require Android Studio and its current Android SDK/toolchain. Run:

```bash
npm run native:android
```

Select an Android emulator or a connected device in Android Studio, then press **Run**.

## Native-session limitation in this release

For security, the native bearer session is kept only in memory; it is not saved in browser local storage or other permanent device storage. A full app-process restart therefore asks the user to sign in again. Before a polished store release, replace this with short-lived access tokens and refresh credentials protected by iOS Keychain and Android Keystore.

The installed PWA does not have this native-shell limitation; it continues to use the server's secure HTTP-only session cookie.
