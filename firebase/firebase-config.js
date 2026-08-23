
export const FIREBASE_HABILITADO = true;

export const firebaseConfig = {
  apiKey: "AIzaSyCPV2he6Nij2v12_D-o1qxdUUwh-Jjeq8k",
  authDomain: "horapprio.firebaseapp.com",
  projectId: "horapprio",
  storageBucket: "horapprio.firebasestorage.app",
  messagingSenderId: "724835384331",
  appId: "1:724835384331:web:8b6e61eee917eac442db0e"
};

export const VAPID_PUBLIC_KEY = "BFuG5DOT9lgsExd0cvwz23K_HwO95HsnsIm69sE2IvIPEwC82X2FETE6eSbJZ1mWmt5_IldSx7Ra85lgoG94mt4";

let _cache = null;

/* Firestore es la única fuente de datos de la app (ver firestore-service.js).
   La persistencia offline de abajo es la caché interna del SDK de Firestore
   (IndexedDB administrado por el propio SDK, no una base de datos local
   que la app mantenga por su cuenta) — permite seguir leyendo/escribiendo
   sin conexión y sincroniza sola al reconectar. */
export async function getFirebase() {
  if (!FIREBASE_HABILITADO) return null;
  if (_cache) return _cache;

  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
  );
  const {
    getAuth,
    GoogleAuthProvider,
    OAuthProvider,
    signInAnonymously,
    signInWithPopup,
    linkWithPopup,
    signInWithCredential,
    signOut,
    unlink,
    onAuthStateChanged,
  } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"
  );
  const {
    getFirestore,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    collection,
    query,
    where,
    onSnapshot,
    runTransaction,
    writeBatch,
    serverTimestamp,
    arrayUnion,
    enableIndexedDbPersistence,
  } = await import(
    "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
  );

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    await enableIndexedDbPersistence(db);
  } catch (e) {
    console.warn("[Firebase] Persistencia offline no disponible:", e.code);
  }

  _cache = {
    app,
    auth,
    db,
    GoogleAuthProvider,
    OAuthProvider,
    signInAnonymously,
    signInWithPopup,
    linkWithPopup,
    signInWithCredential,
    signOut,
    unlink,
    onAuthStateChanged,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    collection,
    query,
    where,
    onSnapshot,
    runTransaction,
    writeBatch,
    serverTimestamp,
    arrayUnion,
  };
  return _cache;
}
