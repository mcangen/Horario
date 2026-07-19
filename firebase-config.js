/* ============================================================
   FIREBASE CONFIG — Preparado para Cloud Messaging (FCM)
   ------------------------------------------------------------
   ESTADO ACTUAL: DESACTIVADO (FIREBASE_HABILITADO = false).
   La app funciona perfectamente sin esto; las notificaciones
   LOCALES (clase en 15 min, actividad próxima) no necesitan
   Firebase y ya funcionan.

   PARA ACTIVAR FCM MÁS ADELANTE:
   1. Crea un proyecto en https://console.firebase.google.com
   2. Agrega una "app web" y copia la configuración que te da
      Firebase en el objeto firebaseConfig de abajo.
   3. En Firebase Console > Configuración del proyecto >
      Cloud Messaging > "Certificados push web", genera un par
      de claves y copia la clave pública en VAPID_PUBLIC_KEY.
   4. Copia los mismos datos en firebase-messaging-sw.js.
   5. Cambia FIREBASE_HABILITADO a true.
   6. Sube los cambios y aumenta la versión del Service Worker.
   ============================================================ */

// Interruptor maestro: mientras sea false, nada de Firebase se carga.
const FIREBASE_HABILITADO = true;

// Pega aquí la configuración de TU proyecto Firebase (paso 2):
const firebaseConfig = {
  apiKey: "AIzaSyCkGXqYL4DhULvSSeaenOm7LCGyoxL6Kf8",
    authDomain: "horario-e742d.firebaseapp.com",
    projectId: "horario-e742d",
    storageBucket: "horario-e742d.firebasestorage.app",
    messagingSenderId: "695403520583",
    appId: "1:695403520583:web:f448b3274c90e6fa91c762",
};

// Clave pública VAPID para Web Push (paso 3):
const VAPID_PUBLIC_KEY = "BPJbrGF09nRIzIH7bRRro0tfC6r3kVJb0uswj7RELUT0Z3HEIzTP_C7v10cwBUFH4xgP6GkNpSnG6bG2tk47C5g";

/* ------------------------------------------------------------
   Inicialización perezosa (lazy): los SDK de Firebase SOLO se
   descargan si el interruptor está en true, para no gastar
   datos ni tiempo de carga mientras no se usen.
   ------------------------------------------------------------ */
async function inicializarFirebaseMessaging() {
  if (!FIREBASE_HABILITADO) {
    console.info("[FCM] Firebase está desactivado (FIREBASE_HABILITADO=false).");
    return null;
  }
  try {
    // Carga dinámica de los SDK (lazy loading)
    const { initializeApp } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
    );
    const { getMessaging, getToken, onMessage } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js"
    );

    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    // Usar el SW principal (sw.js), que ya trae FCM integrado.
    // Así hay UN solo Service Worker y no se pisan entre ellos.
    const reg = await navigator.serviceWorker.ready;

    // Obtener el token del dispositivo (esto es lo que tu backend
    // usará más adelante para enviarle push a este usuario)
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: reg,
    });
    console.info("[FCM] Token del dispositivo:", token);

    // Mensajes recibidos con la app ABIERTA en primer plano
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      if (window.notificarLocal) {
        window.notificarLocal(n.title || "Horarios U", { body: n.body || "" });
      }
    });

    return { messaging, token };
  } catch (e) {
    console.warn("[FCM] No se pudo inicializar Firebase:", e);
    return null;
  }
}

// Se expone globalmente para llamarla desde la app cuando se active FCM
window.inicializarFirebaseMessaging = inicializarFirebaseMessaging;
window.FIREBASE_HABILITADO = FIREBASE_HABILITADO;
