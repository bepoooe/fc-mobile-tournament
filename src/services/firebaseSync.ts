import type { FirebaseOptions } from 'firebase/app'
import type { TournamentState } from '../types'

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
)

const tournamentDocId = import.meta.env.VITE_FIREBASE_TOURNAMENT_DOC_ID || 'main'

type FirebaseModules = {
  app: typeof import('firebase/app')
  firestore: typeof import('firebase/firestore')
}

let firebaseModulesPromise: Promise<FirebaseModules> | null = null

const loadFirebaseModules = async (): Promise<FirebaseModules> => {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([import('firebase/app'), import('firebase/firestore')]).then(
      ([app, firestore]) => ({ app, firestore }),
    )
  }

  return firebaseModulesPromise
}

export const isFirebaseSyncEnabled = hasFirebaseConfig

export const fetchRemoteTournamentState = async (): Promise<TournamentState | null> => {
  if (!hasFirebaseConfig) return null

  const { app, firestore } = await loadFirebaseModules()
  const firebaseApp = app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig)
  const db = firestore.initializeFirestore(firebaseApp, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  })
  const ref = firestore.doc(db, 'tournaments', tournamentDocId)

  const snapshot = await firestore.getDoc(ref)
  if (!snapshot.exists()) return null

  const data = snapshot.data() as { payload?: TournamentState }
  return data.payload ?? null
}

export const subscribeRemoteTournamentState = async (
  onState: (state: TournamentState) => void,
): Promise<(() => void) | undefined> => {
  if (!hasFirebaseConfig) return undefined

  const { app, firestore } = await loadFirebaseModules()
  const firebaseApp = app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig)
  const db = firestore.initializeFirestore(firebaseApp, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  })
  const ref = firestore.doc(db, 'tournaments', tournamentDocId)

  return firestore.onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) return
      const data = snapshot.data() as { payload?: TournamentState }
      if (data.payload) {
        onState(data.payload)
      }
    },
    (error) => {
      console.error('Firestore subscription error:', error)
    },
  )
}

export const saveRemoteTournamentState = async (state: TournamentState): Promise<void> => {
  if (!hasFirebaseConfig) return

  const { app, firestore } = await loadFirebaseModules()
  const firebaseApp = app.getApps().length ? app.getApp() : app.initializeApp(firebaseConfig)
  const db = firestore.initializeFirestore(firebaseApp, {
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  })
  const ref = firestore.doc(db, 'tournaments', tournamentDocId)

  await firestore.setDoc(
    ref,
    {
      payload: state,
      updatedAt: firestore.serverTimestamp(),
    },
    { merge: true },
  )
}
