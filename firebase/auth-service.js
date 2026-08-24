
import { getFirebase, FIREBASE_HABILITADO } from "./firebase-config.js";

const _listeners = [];
let _usuarioActual = null;

export function usuarioActual() {
  return _usuarioActual;
}

export function alCambiarUsuario(fn) {
  _listeners.push(fn);
  try {
    fn(_usuarioActual);
  } catch (e) {}
  return function cancelar() {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

function _normalizar(user) {
  return user
    ? {
        uid: user.uid,
        nombre: user.isAnonymous ? "Invitado" : user.displayName || "Usuario",
        email: user.email || "",
        foto: user.photoURL || "",
        esAnonimo: !!user.isAnonymous,
        // "google.com" | "microsoft.com" | "anonymous" — de dónde viene la
        // cuenta, para el perfil académico (ver firestore-service.js:
        // asegurarPerfil) y para decidir si la universidad se detecta por
        // dominio institucional o se completa a mano.
        proveedor: user.isAnonymous
          ? "anonymous"
          : (user.providerData[0] && user.providerData[0].providerId) || "desconocido",
        // true solo en la primerísima sesión de esta cuenta (Firebase deja
        // creationTime == lastSignInTime hasta el segundo inicio de sesión)
        // — así se puede saludar/recordar iniciar sesión a alguien
        // genuinamente nuevo, sin volver a molestar a quien ya lleva
        // tiempo usando la app de forma anónima.
        esNuevo: !!(
          user.metadata &&
          user.metadata.creationTime &&
          user.metadata.creationTime === user.metadata.lastSignInTime
        ),
      }
    : null;
}

function _notificar(user) {
  _usuarioActual = user;
  _listeners.forEach(function (fn) {
    try {
      fn(user);
    } catch (e) {}
  });
}

/* Cada visitante necesita un uid de Firebase para tener su propio
   documento en Firestore, con o sin cuenta de Google. Si no hay
   sesión, se crea una sesión anónima automáticamente (misma
   experiencia sin fricción que antes tenía localStorage). Al
   iniciar sesión con Google más tarde, entrarConGoogle() vincula
   esa cuenta a ESTE MISMO uid anónimo, así que todo lo que ya se
   guardó sigue perteneciéndole sin necesidad de migrar nada. */
export async function iniciarAuth() {
  if (!FIREBASE_HABILITADO) return;
  try {
    const fb = await getFirebase();
    if (!fb) return;
    fb.onAuthStateChanged(fb.auth, async function (user) {
      if (!user) {
        // Avisar YA (con null) es lo que hace que sync-service.js corte
        // los listeners de la sesión anterior de inmediato. Si no se
        // notifica aquí, esos listeners se quedan activos apuntando al
        // uid que se acaba de cerrar, y en cuanto Firestore reevalúa el
        // permiso con el auth ya inválido, disparan "permission-denied"
        // — eso es lo que se veía como "⚠ Error al guardar" justo al
        // cerrar sesión, hasta recargar la página. Antes solo se
        // enteraban cuando llegaba la sesión anónima nueva, ya tarde.
        _notificar(null);
        try {
          await fb.signInAnonymously(fb.auth);
        } catch (e) {
          console.warn("[Auth] No se pudo iniciar sesión anónima:", e);
        }
        return; // onAuthStateChanged se vuelve a disparar con el user anónimo
      }
      _notificar(_normalizar(user));
    });
  } catch (e) {
    console.warn("[Auth] No se pudo iniciar:", e);
  }
}

// Fuerza a refrescar el ID token justo después de iniciar/vincular sesión.
// Sin esto, el token que Firestore usa para evaluar las reglas
// (request.auth.token.email, ver firestore.rules) puede seguir siendo por
// un momento el de ANTES de este login (p. ej. el anónimo, sin email) —
// el SDK lo refresca solo tarde o temprano, pero si algo escribe a
// Firestore justo después de entrar (como guardar el perfil académico),
// puede toparse con ese token viejo y recibir "permission denied" hasta
// que algo (como volver a iniciar sesión) fuerce uno nuevo.
async function _refrescarToken(user) {
  try {
    await user.getIdToken(true);
  } catch (e) {}
  return user;
}

export async function entrarConGoogle() {
  const fb = await getFirebase();
  if (!fb) throw new Error("Firebase no está habilitado.");
  const provider = new fb.GoogleAuthProvider();
  const actual = fb.auth.currentUser;

  if (actual && actual.isAnonymous) {
    try {
      const cred = await fb.linkWithPopup(actual, provider);
      return await _refrescarToken(cred.user);
    } catch (e) {
      if (e && e.code === "auth/credential-already-in-use") {
        // Esa cuenta de Google ya tiene su propio uid (con su propia
        // historia de datos) en otro dispositivo/sesión anterior — no
        // se pueden fusionar dos historiales automáticamente, así que
        // se inicia sesión en la cuenta de Google existente (sus datos
        // de invitado en ESTE dispositivo, si los hubiera, se quedan
        // huérfanos bajo el uid anónimo anterior).
        const credGoogle = fb.GoogleAuthProvider.credentialFromError(e);
        const res = await fb.signInWithCredential(fb.auth, credGoogle);
        return await _refrescarToken(res.user);
      }
      throw e;
    }
  }

  const cred = await fb.signInWithPopup(fb.auth, provider);
  return await _refrescarToken(cred.user);
}

const DOMINIO_INSTITUCIONAL = "@unimagdalena.edu.co";

// Espeja entrarConGoogle() (mismo patrón link/credential-already-in-use),
// pero además exige que el correo de Microsoft sea del dominio
// institucional. Esta comprobación de dominio es solo la primera capa (la
// que da feedback inmediato); la que realmente no se puede saltar vive en
// firestore.rules, que lee request.auth.token.email (el email verificado
// del token de Firebase, no algo que este archivo le mande al servidor) —
// ver el comentario en firestore.rules para el porqué.
export async function entrarConMicrosoft() {
  const fb = await getFirebase();
  if (!fb) throw new Error("Firebase no está habilitado.");
  const provider = new fb.OAuthProvider("microsoft.com");
  const actual = fb.auth.currentUser;
  const eraAnonimo = !!(actual && actual.isAnonymous);

  let user;
  if (eraAnonimo) {
    try {
      const cred = await fb.linkWithPopup(actual, provider);
      user = cred.user;
    } catch (e) {
      if (e && e.code === "auth/credential-already-in-use") {
        // Esa cuenta de Microsoft ya tiene su propio uid (con su propia
        // historia de datos) — igual que en Google, no se pueden fusionar
        // dos historiales, así que se entra a la cuenta de Microsoft ya
        // existente (y los datos de invitado de ESTE dispositivo, si los
        // había, se quedan bajo el uid anónimo anterior, ya sin sesión).
        const credMs = fb.OAuthProvider.credentialFromError(e);
        const res = await fb.signInWithCredential(fb.auth, credMs);
        user = res.user;
      } else {
        throw e;
      }
    }
  } else {
    const cred = await fb.signInWithPopup(fb.auth, provider);
    user = cred.user;
  }

  await _refrescarToken(user);

  const email = (user.email || "").toLowerCase();
  if (!email.endsWith(DOMINIO_INSTITUCIONAL)) {
    if (eraAnonimo) {
      // Revierte a la sesión anónima tal como estaba — sin esto, el
      // usuario perdería (huérfano bajo un uid vinculado a una cuenta
      // rechazada) las clases/actividades que ya tuviera antes de probar
      // Microsoft.
      try {
        await fb.unlink(user, "microsoft.com");
      } catch (e2) {
        await fb.signOut(fb.auth);
      }
    } else {
      await fb.signOut(fb.auth);
    }
    const err = new Error(
      "Debes utilizar tu correo institucional @unimagdalena.edu.co para iniciar sesión con Microsoft.",
    );
    err.tipo = "dominio";
    throw err;
  }
  return user;
}

export async function salir() {
  const fb = await getFirebase();
  if (!fb) return;
  await fb.signOut(fb.auth);
  // onAuthStateChanged dispara con null y iniciarAuth() crea una
  // nueva sesión anónima automáticamente: la app sigue usable.
}
