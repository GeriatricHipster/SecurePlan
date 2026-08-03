# SecurePlan Surveyor

SecurePlan Surveyor is a responsive physical-security survey application for laying out systems on PDF floor plans. One hosted HTTPS address works in desktop and mobile browsers and can be installed to an iPhone, iPad, or Android Home Screen. Capacitor iOS and Android source projects are also included for native development.

For the quickest device launch, deploy the web app first and use it as an installable Progressive Web App (PWA). See [SUPABASE_RENDER_SETUP.md](./SUPABASE_RENDER_SETUP.md) for the free cloud launch and [MOBILE_LAUNCH.md](./MOBILE_LAUNCH.md) for device instructions.

## What is included

- Sites, folders, surveys, and batch PDF floor-plan uploads with per-survey names and optional descriptions
- Expandable Access Control, CCTV, Intrusion, Doors, and Custom libraries, including the supplied 13-symbol Access Control field set
- Drag-and-drop plotting and device assemblies, outline-free named symbols, independent camera FOV aiming, four independently controlled multisensor views, and on-canvas markup formatting
- Original blueprint-style door/opening symbols and automatic, editable camera field-of-view cones
- Custom multi-component profiles, including a seeded **Full Door** profile
- Place, move, resize, rotate, recolor, copy, and delete survey elements
- Lines, arrows, rectangles, circles, and text callouts
- Notes and cloud-hosted photo attachments on elements
- Survey orientation controls and a device schedule
- Last-editor attribution, collaborator presence, and live survey updates
- Owner, Admin, Manager, Editor, Installer, and Viewer roles
- Login and one-time invitation codes with optional expiration and use limits
- Responsive desktop/mobile layouts and installable PWA metadata
- Capacitor projects in `ios/` and `android/`

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. The first account created becomes the workspace owner. After setup, new users register from the sign-in screen with an invitation code generated on the **Team** page.

Before exposing an empty installation to the public internet, set a random `SETUP_CODE` of at least 16 characters. The first-run screen requires it before creating the owner account.

The development server stores its SQLite database and uploaded files in `./data`. That directory is intentionally excluded from Git.

## Production launch

Build and run the single Node service:

```bash
npm ci
npm run build
JWT_SECRET="replace-with-a-long-random-secret" SETUP_CODE="private-first-owner-code" DATA_DIR="./data" APP_ORIGIN="https://surveyor.example.com" NODE_ENV="production" COOKIE_SECURE="true" npm start
```

The server listens on `PORT` (default `3000`) and serves both the API and built web app. `/api/health` is available for health checks. Keep `COOKIE_SECURE=true` behind HTTPS and configure `TRUST_PROXY` for the reverse proxy.

### Render Free + Supabase Blueprint

The included `render.yaml` creates one free HTTPS web service. Supabase PostgreSQL stores application records and a private Supabase Storage bucket stores PDFs and photos, so Render does not need a paid disk.

1. Push this project to a GitHub repository.
2. In Render, create a new **Blueprint** and connect the repository.
3. Enter the requested Supabase values and a private `SETUP_CODE` when Render prompts for them.
4. Deploy, then open the generated `https://...onrender.com` address.
5. Use the same address in desktop browsers and on iPhone, iPad, and Android.

Render supplies `RENDER_EXTERNAL_URL`, and SecurePlan uses it automatically when `APP_ORIGIN` is not set. You do not need to add `APP_ORIGIN` for Render's generated URL. If you later attach a custom domain, set `APP_ORIGIN` to that custom HTTPS origin and redeploy.

Follow [SUPABASE_RENDER_SETUP.md](./SUPABASE_RENDER_SETUP.md) for the exact bucket, connection, secret, deployment, and verification steps. The Blueprint also allows the native Capacitor origins.

### Docker

For a local Docker launch, choose a private first-owner setup code:

```bash
SETUP_CODE="private-first-owner-code" docker compose up --build
```

Or run the image directly:

```bash
docker build -t secureplan-surveyor .
docker run --rm -p 3000:3000 \
  -e JWT_SECRET="replace-with-a-long-random-secret" \
  -e SETUP_CODE="private-first-owner-code" \
  -e DATA_DIR=/app/data \
  -e COOKIE_SECURE=false \
  -v secureplan-data:/app/data \
  secureplan-surveyor
```

Open `http://localhost:3000`.

## Accounts and invitation codes

1. On an empty installation, create the first owner account.
2. Sign in as Owner or Admin and open **Team**.
3. Create a code for the intended role and copy it to the invitee.
4. The invitee chooses **Use invitation code** on the sign-in screen and creates an account.

Passwords are hashed on the server. Web authentication uses an HTTP-only cookie. Native requests use a bearer session held in memory. Invitation codes are stored as hashes and can be revoked. A removed teammate can be restored with a new invitation restricted to the same email address.

## Storage and deployment notes

Photos and PDFs are uploaded to authenticated storage; the application does not keep them in browser local storage or the mobile app's permanent device storage. Production uses Supabase PostgreSQL and a private Storage bucket. Local development defaults to SQLite and files under `DATA_DIR` so it works without cloud credentials.

Run one Render instance for live editing. A multi-instance deployment would additionally require a shared Socket.IO adapter.

For this release, use one floor-plan page per survey. If a PDF contains several floors, split it into one PDF per floor so placed elements remain unambiguous.

## Useful commands

```bash
npm run dev              # API + Vite development servers
npm run build            # production web build
npm start                # production server
npm test                 # integration tests
npm run check            # production build and tests
npm run native:sync      # build native web assets and sync both projects
npm run native:ios       # sync and open the iOS project in Xcode
npm run native:android   # sync and open the Android project in Android Studio
```

## Accessibility

The interface uses semantic landmarks and controls, visible focus states, keyboard-accessible navigation, descriptive labels, status announcements, and mobile-size touch targets. PDF plotting is inherently spatial; placed items are also exposed through the inspector and device schedule so they can be reviewed without relying only on the canvas.
