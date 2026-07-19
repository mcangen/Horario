/* ============================================================
   SERVICE WORKER — Generador de Horarios Universitarios
   ------------------------------------------------------------
   Responsabilidades:
   1. Precachear todos los archivos de la app al instalarse.
   2. Servir todo desde caché => la app funciona 100% offline.
   3. Actualizar la caché cuando se publica una versión nueva
      (basta con cambiar el número de CACHE_VERSION abajo).
   4. Servir una página offline de respaldo si algo falla.

   IMPORTANTE — CÓMO PUBLICAR UNA NUEVA VERSIÓN:
   Cada vez que modifiques index.html (o cualquier archivo),
   sube el cambio Y aumenta CACHE_VERSION (v1 -> v2 -> v3...).
   El navegador detecta que sw.js cambió, instala el SW nuevo,
   borra la caché vieja y avisa a la página para recargar.
   ============================================================ */

const CACHE_VERSION = "v3"; // <-- CAMBIA ESTO EN CADA PUBLICACIÓN
const CACHE_NAME = "horarios-u-" + CACHE_VERSION;

/* ---------- FIREBASE CLOUD MESSAGING (unificado aquí) ----------
   FCM vive en este mismo SW para no pelear por el ámbito con el
   SW de offline. Así un solo SW maneja caché + push en background. */
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js",
);
firebase.initializeApp({
  apiKey: "AIzaSyCkGXqYL4DhULvSSeaenOm7LCGyoxL6Kf8",
  authDomain: "horario-e742d.firebaseapp.com",
  projectId: "horario-e742d",
  storageBucket: "horario-e742d.firebasestorage.app",
  messagingSenderId: "695403520583",
  appId: "1:695403520583:web:f448b3274c90e6fa91c762",
});
firebase.messaging().onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "Horarios U", {
    body: n.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-96.png",
    data: payload.data && payload.data.url ? { url: payload.data.url } : {},
  });
});



/* Archivos propios de la app (rutas RELATIVAS para que funcione
   en GitHub Pages bajo /nombre-del-repo/ sin tocar nada). */
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.json",
  "./firebase-config.js",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

/* Librerías externas (CDN) que la app necesita:
   - jsPDF + html2canvas => exportar PDF
   - qrcodejs            => compartir por QR
   - Google Fonts        => tipografías Fraunces e Inter
   Se cachean en modo "no-cors" para que también funcionen offline. */
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&family=Inter:wght@400;500;600;700&display=swap",
];

/* ---------- INSTALACIÓN: precachear todo ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Archivos propios: si alguno falla, la instalación falla (son críticos)
      await cache.addAll(APP_SHELL);
      // CDNs: se intentan uno a uno; si no hay internet en la primera visita
      // no rompen la instalación (se reintentan luego en cada fetch)
      await Promise.allSettled(
        CDN_ASSETS.map((url) =>
          cache.add(new Request(url, { mode: "no-cors" })),
        ),
      );
    }),
  );
  // El SW nuevo pasa a "waiting" de inmediato sin esperar días
  self.skipWaiting();
});

/* ---------- ACTIVACIÓN: borrar cachés de versiones viejas ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("horarios-u-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()), // toma control de las pestañas abiertas
  );
});

/* ---------- FETCH: estrategia de caché ----------
   - Navegación (abrir la app): red primero con respaldo de caché,
     y si no hay ninguna de las dos, la página offline.
     (Red primero garantiza que recibes versiones nuevas rápido.)
   - Todo lo demás (scripts, íconos, fuentes): caché primero,
     y lo que se descargue de la red se guarda para la próxima. */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // no interceptar POST etc.

  // 1) Peticiones de navegación (documentos HTML)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // guarda la versión fresca de la página
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          // sin internet: sirve el index cacheado, o la página offline
          caches
            .match("./index.html")
            .then((r) => r || caches.match("./offline.html")),
        ),
    );
    return;
  }

  // 2) Recursos estáticos: caché primero, red como respaldo
  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // cachea la respuesta nueva (incluye respuestas opacas de CDN)
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => {
          // recurso no disponible offline: respuesta vacía silenciosa
          return new Response("", { status: 408, statusText: "Offline" });
        });
    }),
  );
});

/* ---------- MENSAJES desde la página ----------
   La página puede pedirle al SW nuevo que se active ya
   (se usa para el aviso "Nueva versión disponible"). */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* Al tocar una notificación: enfocar la app o abrirla */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
      for (const w of ws) {
        if ("focus" in w) return w.focus();
      }
      return clients.openWindow(
        (event.notification.data && event.notification.data.url) || "./",
      );
    }),
  );
});