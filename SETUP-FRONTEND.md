# GitHub frontend — setup

Do this half **after** the Firebase backend is deployed. These four files are the entire web app.

## 1. Paste your Firebase config
Open `firebase-config.js` and replace every `REPLACE_ME` with the values from your Firebase web-app config (console → Project settings → Your apps → Web → Config). These keys are public and safe to commit.

## 2. Push to GitHub + turn on Pages
1. Create a GitHub repo and push these files to it (root of the repo, or a folder you point Pages at).
2. Repo **Settings → Pages →** set the source branch (e.g. `main`) and folder. Save.
3. GitHub gives you a URL like `https://<you>.github.io/<repo>/`. Note it.

## 3. ⚠ Whitelist your Pages domain in Firebase Auth (don't skip this)
Because the app is hosted off Firebase, sign-in will silently fail until you authorize the domain:
1. Firebase console → **Authentication → Settings → Authorized domains → Add domain.**
2. Add your Pages host: **`<you>.github.io`** (just the host, no path).

`localhost` and your `*.web.app` / `*.firebaseapp.com` domains are pre-authorized, so the app also works if you open it locally for testing.

## 4. Open it and test
1. Visit your Pages URL → you should see the Mycopop sign-in screen.
2. **Create account** with your email/password.
3. Now go finish **step 4 of the backend guide** (make yourself admin with your new uid).
4. Sign out/in, then **Overview → Seed demo data**, and run the smoke test in `README.md`.

## Updating the frontend later
Just push changes to GitHub — Pages redeploys automatically. No Firebase deploy needed for frontend-only changes.

## If sign-in does nothing / console shows an `auth/unauthorized-domain` error
You missed step 3 — add your `github.io` domain to Authorized domains.
