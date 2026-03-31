import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import {
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
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

const app = hasFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null

const db = app
  ? initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      ignoreUndefinedProperties: true,
    })
  : null

const getTournamentDocRef = () => {
  if (!db) return null
  return doc(db, 'tournaments', tournamentDocId)
}

export const isFirebaseSyncEnabled = hasFirebaseConfig

export const fetchRemoteTournamentState = async (): Promise<TournamentState | null> => {
  const ref = getTournamentDocRef()
  if (!ref) return null

  const snapshot = await getDoc(ref)
  if (!snapshot.exists()) return null

  const data = snapshot.data() as { payload?: TournamentState }
  return data.payload ?? null
}

export const subscribeRemoteTournamentState = (
  onState: (state: TournamentState) => void,
): (() => void) => {
  const ref = getTournamentDocRef()
  if (!ref) return () => {}

  return onSnapshot(
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
  const ref = getTournamentDocRef()
  if (!ref) return

  await setDoc(
    ref,
    {
      payload: state,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
