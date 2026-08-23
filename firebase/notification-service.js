
import {
  getFirebase,
  FIREBASE_HABILITADO,
  VAPID_PUBLIC_KEY,
} from "./firebase-config.js";

let _messaging = null;

/* Inicializa Messaging (solo si Firebase está habilitado y el
   navegador soporta push). Devuelve el token del dispositivo, que
   es lo que un backend usaría para enviarle push a este usuario. */
export async function prepararPush() {
  if (!FIREBASE_HABILITADO) {
    console.info("[Push] Firebase deshabilitado; push no preparado.");
    return null;
  }
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    console.info("[Push] Este navegador no soporta push.");
    return null;
  }
  try {
    const { getMessaging, getToken, onMessage } = await import(
      "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js"
    );
    const fb = await getFirebase();
    if (!fb) return null;
    _messaging = getMessaging(fb.app);

    // Usa el service worker principal (sw.js) que ya integra FCM.
    const reg = await navigator.serviceWorker.ready;

    const token = await getToken(_messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: reg,
    });
    console.info("[Push] Token del dispositivo:", token);

    // Mensajes recibidos con la app abierta en primer plano
    onMessage(_messaging, function (payload) {
      const n = (payload && payload.notification) || {};
      if (window.notificarLocal) {
        window.notificarLocal(n.title || "HorApprio", { body: n.body || "" });
      }
    });

    return token;
  } catch (e) {
    console.warn("[Push] No se pudo preparar:", e);
    return null;
  }
}

/* Pide permiso de notificaciones al usuario. */
export async function pedirPermiso() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return await Notification.requestPermission();
}
