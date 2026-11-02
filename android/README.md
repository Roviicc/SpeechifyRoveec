# Lumen Android app (APK)

A thin Android app around the Lumen web app:

- **Trusted Web Activity**: opens https://speechify-roveec.vercel.app full screen in Chrome (same speed, offline
  support and Google sign-in as the installed PWA). Full screen requires `public/.well-known/assetlinks.json` to list
  this app's signing-certificate SHA-256 fingerprint.
- **DictionaryActivity** (native helper, invisible): the web app calls
  `intent://lookup?q=WORD#Intent;scheme=lumen;package=app.lumen.reader;end` to open the chosen dictionary app, and
  `intent://choose#…` to pick one from the apps installed on the phone. ColorDict-API apps (ColorDict, GoldenDict,
  Fora…) open as a popup (`EXTRA_FULLSCREEN=false`); others get Android's "process text" action.

## Build

Requirements: JDK 17+, Android SDK (platform 36, build-tools 36), Gradle 8.13+.

```bash
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties
# signing key (never commit it; the repo is public)
keytool -genkeypair -keystore lumen-release.keystore -alias lumen -keyalg RSA -keysize 2048 -validity 10000
export LUMEN_KEYSTORE_PASSWORD=...        # defaults to "lumen-local"
gradle assembleRelease                    # -> app/build/outputs/apk/release/app-release.apk
keytool -list -v -keystore lumen-release.keystore | grep SHA256   # put this in public/.well-known/assetlinks.json
```

Bump `versionCode` in `app/build.gradle` for each new APK. Updates must be signed with the **same** keystore; with a
new key, uninstall the old app first (books and progress live in Chrome's site data and are kept).

Point the app at another deployment with `gradle assembleRelease -PlumenUrl=https://your-domain`.
