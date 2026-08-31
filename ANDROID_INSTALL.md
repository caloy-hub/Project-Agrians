# AGRIANS v2.2 — Android Installation

AGRIANS v2.2 is now a Progressive Web App (PWA), so it can be installed directly on Android from its GitHub/Netlify/Vercel deployment without changing the Supabase data layer.

## Android users
1. Open the deployed AGRIANS site in Chrome.
2. Sign in normally.
3. Tap **Install** when the AGRIANS install prompt appears, or use Chrome's **⋮ → Install app** / **Add to Home screen**.
4. AGRIANS will open in standalone app mode.

## Important
- SF2, SF4 and SF9 generation code was not redesigned as part of v2.2.
- Live school records still require an internet connection because they use Supabase.
- The service worker caches the application shell for faster repeat launches and graceful offline behavior.

## Native APK / Play Store
This source is intentionally PWA-first and Android-installable. A signed native APK/AAB still requires an Android build environment (Android SDK/Gradle) or a CI build such as GitHub Actions. The next native wrapper can use Capacitor without rewriting the React application.
