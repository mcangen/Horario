/* ============================================================
   sync-service.js
   ------------------------------------------------------------
   Ya no reconcilia localStorage contra Firestore (no hay dos
   copias que fusionar — Firestore es la única). Lo que queda:
   1) arrancar la migración única + las escuchas en tiempo real
      en cuanto hay un uid (anónimo o con Google);
   2) el estado visible ☁ Guardando / ✓ Guardado / 🔄 Actualizando
      / ⚠ Error, con ejecutarEscritura() como único punto por el
      que pasa cualquier escritura a Firestore desde la app.
   ============================================================ */

import { alCambiarUsuario } from "./auth-service.js";
import { migrarLocalStorageAFirestore, iniciarEscuchas, detenerEscuchas, asegurarPerfil } from "./firestore-service.js";

export const ESTADOS = {
  GUARDANDO: "guardando",
  GUARDADO: "guardado",
  ACTUALIZANDO: "actualizando",
  ERROR: "error",
};

let _estado = ESTADOS.GUARDADO;
const _listenersEstado = [];

export function alCambiarEstado(fn) {
  _listenersEstado.push(fn);
  try { fn(_estado); } catch (e) {}
  return function () {
    const i = _listenersEstado.indexOf(fn);
    if (i >= 0) _listenersEstado.splice(i, 1);
  };
}
function _setEstado(nuevo) {
  _estado = nuevo;
  _listenersEstado.forEach(function (fn) {
    try { fn(nuevo); } catch (e) {}
  });
}
export function estadoActual() {
  return _estado;
}

let _uidActivo = null;

export function iniciarSync() {
  alCambiarUsuario(async function (user) {
    if (!user) {
      detenerEscuchas();
      _uidActivo = null;
      return;
    }
    if (_uidActivo === user.uid) return;
    _uidActivo = user.uid;
    try {
      await migrarLocalStorageAFirestore(user.uid);
      iniciarEscuchas(user.uid);
      // Crea (o refresca) el perfil académico users/{uid} — no hace nada
      // para sesiones anónimas (ver asegurarPerfil).
      await asegurarPerfil(user.uid, user);
      // Limpia cualquier "⚠ Error al guardar" que hubiera quedado de la
      // sesión anterior (p. ej. un listener viejo que alcanzó a fallar
      // por permiso justo al cambiar de cuenta): esta sesión arranca
      // desde cero, así que el indicador también.
      _setEstado(ESTADOS.GUARDADO);
    } catch (e) {
      console.warn("[Sync] Error al iniciar:", e);
      _setEstado(ESTADOS.ERROR);
    }
  });
  window.__marcarActualizando = marcarActualizando;
  window.alErrorFirestore = function () {
    _setEstado(ESTADOS.ERROR);
  };
}

function _clasificarError(e) {
  if (e && e.tipo === "conflicto") return "conflicto";
  if (e && e.tipo === "eliminado") return "eliminado";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (e && e.code === "permission-denied") return "permiso";
  if (e && (e.code === "unauthenticated" || e.code === "auth/unauthorized")) return "sesion";
  return "desconocido";
}
const _MENSAJES = {
  conflicto: "Alguien más actualizó esto. Se muestra la versión más reciente.",
  eliminado: "Ese elemento ya no existe (fue eliminado en otro dispositivo).",
  offline: "Sin conexión: se guardará solo cuando vuelvas a tener internet.",
  permiso: "No tienes permiso para esta acción. Vuelve a iniciar sesión.",
  sesion: "Tu sesión expiró. Vuelve a iniciar sesión.",
  desconocido: "No se pudo guardar. Intenta de nuevo.",
};

/* Único punto por el que la app llama a Firestore para escribir.
   Nunca finge que algo se guardó si la escritura falló — devuelve
   {ok:false, error:{tipo, msg}} para que quien llamó pueda avisar
   al usuario y, si aplica, ofrecer reintentar. */
export async function ejecutarEscritura(fn) {
  _setEstado(ESTADOS.GUARDANDO);
  try {
    const resultado = await fn();
    _setEstado(ESTADOS.GUARDADO);
    return { ok: true, resultado: resultado };
  } catch (e) {
    console.warn("[Sync] Error al escribir:", e);
    const tipo = _clasificarError(e);
    _setEstado(ESTADOS.ERROR);
    return { ok: false, error: { tipo: tipo, msg: _MENSAJES[tipo] || _MENSAJES.desconocido } };
  }
}

/* Marca brevemente "🔄 Actualizando…" cuando llega un cambio desde
   otro dispositivo (no la primera carga inicial de cada colección,
   ver firestore-service.js). No pisa un "Guardando…" propio en curso. */
let _marcaTimer = null;
export function marcarActualizando() {
  if (_estado === ESTADOS.GUARDANDO) return;
  _setEstado(ESTADOS.ACTUALIZANDO);
  clearTimeout(_marcaTimer);
  _marcaTimer = setTimeout(function () {
    if (_estado === ESTADOS.ACTUALIZANDO) _setEstado(ESTADOS.GUARDADO);
  }, 900);
}
