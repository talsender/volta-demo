# Demo Firebase setup (one-time)

The demo login and manager panel use a **dedicated demo Firebase project** —
never the real production project.

1. Go to https://console.firebase.google.com → **Add project** → name it e.g.
   `volta-demo`. Analytics optional (can disable).
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database → Start in *test mode***
   (fine for a disposable demo).
4. **Project settings (gear icon) → Your apps → Web app (`</>`)** → register the
   app → copy the `firebaseConfig` values into `config.js` → `FIREBASE_CONFIG`
   (replace every `PASTE_...` placeholder).
5. Open the deployed demo, log in with the manager bootstrap password `demo`
   (from `config.js` → `DEFAULT_ROOF_CONFIG.managerPassword`), create a demo
   manager, then add a demo agent from the manager panel.

The map, search, wizard, and 3D sim all work **without** Firebase — only the
login/manager/exception-request features need the steps above.
