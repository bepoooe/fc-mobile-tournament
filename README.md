# FC Mobile Tournament

Realtime multi-device tournament manager built with React + TypeScript + Vite.

This project now supports live sync through Firebase Firestore so all devices see the same tournament state.

## 1. Local Development

```bash
npm install
npm run dev
```

## 2. Firebase Backend Setup (Full)

### Step 1: Create Firebase project
1. Go to Firebase Console.
2. Create a new project.
3. Enable Cloud Firestore (Native mode).
4. Add a Web App and copy its config values.

### Step 2: Configure environment variables
1. Copy `.env.example` to `.env`.
2. Fill values from Firebase Web App config:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_TOURNAMENT_DOC_ID=main
```

Notes:
1. Use the same Firebase project and same `VITE_FIREBASE_TOURNAMENT_DOC_ID` for all deployments that should share data.
2. If env vars are missing, app falls back to local-only behavior.

### Step 3: Firestore schema
Collection:
1. `tournaments`

Document:
1. Document ID: `main` (or value of `VITE_FIREBASE_TOURNAMENT_DOC_ID`)

Fields:
1. `payload` (map/object): full tournament state
2. `updatedAt` (timestamp): server timestamp

Payload structure (stored as one object) matches `TournamentState` from `src/types.ts`:
1. `players: Player[]`
2. `groups: Group[]`
3. `fixtures: Fixture[]`
4. `knockout: KnockoutState`
5. `settings: TournamentSettings`
6. `stage: 'setup' | 'group_stage' | 'knockout' | 'final' | 'completed'`
7. `groupsLocked: boolean`
8. `championId: string | null`
9. `confirmedFixtures: string[]`

### Step 4: Firestore security rules
Rules file is provided in `firebase/firestore.rules`.

Quick-start rule allows public read/write to share data quickly across all devices:

```text
match /tournaments/{tournamentId} {
  allow read, write: if true;
}
```

Important:
1. This is open access and not secure for public production use.
2. For production, switch to Firebase Auth and restrict writes by role/team.

### Step 5: Deploy rules
If using Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore
firebase deploy --only firestore:rules
```

## 3. How Sync Works

1. On app startup, it fetches remote `tournaments/{docId}` state.
2. If remote exists, remote state becomes source of truth.
3. App subscribes to realtime snapshot updates.
4. Local changes are debounced and written back to Firestore.
5. LocalStorage remains as offline cache and fallback.

Code locations:
1. Firebase sync service: `src/services/firebaseSync.ts`
2. Sync integration in context: `src/context/TournamentContext.tsx`

## 4. Deploying to Multiple Frontends

For each deployment target (Vercel/Netlify/Firebase Hosting/etc):
1. Add the same Firebase env vars.
2. Keep the same `VITE_FIREBASE_TOURNAMENT_DOC_ID`.
3. Redeploy.

If one deployment has different env vars, it will not sync with the others.

## 5. Troubleshooting

1. Devices not syncing:
   Check both deployments use identical `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_TOURNAMENT_DOC_ID`.
2. Works locally but not production:
   Verify production env vars are set and app was rebuilt/redeployed.
3. Firestore permission errors:
   Verify deployed rules match required access mode.
