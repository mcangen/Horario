/* ============================================================
   FIREBASE MESSAGING SERVICE WORKER — Preparado (inactivo)
   ------------------------------------------------------------
   Este Service Worker SOLO se registra cuando actives Firebase
   (FIREBASE_HABILITADO = true en firebase-config.js). Mientras
   tanto, este archivo existe pero nadie lo registra, así que no
   consume nada.

   Su trabajo: recibir notificaciones push de Firebase Cloud
   Messaging cuando la app está CERRADA o en segundo plano,
   y mostrarlas como notificación del sistema.

   PARA ACTIVARLO: pega aquí la MISMA configuración firebaseConfig
   que pusiste en firebase-config.js (los SW no pueden leer ese
   archivo, necesitan su propia copia).
   ============================================================ */

importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js",
);

// Pega aquí la MISMA configuración de firebase-config.js:
firebase.initializeApp({
  apiKey: "PEGA_AQUI_TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx",
});

const messaging = firebase.messaging();

/* Push recibido con la app cerrada o en segundo plano */
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "Horarios U", {
    body: n.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-96.png",
    data: (payload.data && payload.data.url) ? { url: payload.data.url } : {},
  });
});

/* Al tocar la notificación: abrir o enfocar la app */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((ws) => {
        for (const w of ws) {
          if ("focus" in w) return w.focus();
        }
        return clients.openWindow(
          (event.notification.data && event.notification.data.url) || "./",
        );
      }),
  );
});
