/* ============================================================
   app-integration.js
   ------------------------------------------------------------
   Conecta los módulos de Firebase con el DOM y con el script
   clásico de la app (index.html no es un módulo, así que la
   comunicación es a través de un puñado de globals en window):

   - window.firestoreCrud: funciones para escribir en Firestore,
     usadas por las funciones de crear/editar/borrar de la app.
   - window.uidActual(): uid de la sesión activa (anónima o Google).
   - window.alActualizar*  (definidos por index.html): reciben cada
     colección/singleton cuando Firestore entrega datos (carga
     inicial u onSnapshot en tiempo real).
   ============================================================ */

import { FIREBASE_HABILITADO } from "./firebase-config.js";
import {
  iniciarAuth,
  alCambiarUsuario,
  usuarioActual,
  entrarConGoogle,
  entrarConMicrosoft,
  salir,
} from "./auth-service.js";
import {
  iniciarSync,
  alCambiarEstado,
  ejecutarEscritura,
  ESTADOS,
} from "./sync-service.js";
import {
  crearDoc,
  actualizarConVersion,
  actualizarSinVersion,
  eliminarDoc,
  guardarLote,
  guardarSingleton,
  escribirPerfil,
  buscarPorCodigo,
  obtenerEstadoRelacion,
  enviarSolicitud,
  aceptarSolicitud,
  eliminarSolicitud,
  quitarAmigo,
  guardarResumenHoy,
  leerResumenHoyDeAmigo,
  activarCompartirCompleto,
  leerHorarioCompletoDeAmigo,
  crearGrupo,
  salirDeGrupo,
  eliminarGrupo,
  agregarReunion,
  eliminarReunion,
  escucharReunionesDeGrupo,
  invitarAGrupo,
  aceptarInvitacionGrupo,
  rechazarInvitacionGrupo,
} from "./firestore-service.js";

window.firestoreCrud = {
  crearDoc: crearDoc,
  actualizarConVersion: actualizarConVersion,
  actualizarSinVersion: actualizarSinVersion,
  eliminarDoc: eliminarDoc,
  guardarLote: guardarLote,
  guardarSingleton: guardarSingleton,
  escribirPerfil: escribirPerfil,
  ejecutarEscritura: ejecutarEscritura,
  buscarPorCodigo: buscarPorCodigo,
  obtenerEstadoRelacion: obtenerEstadoRelacion,
  enviarSolicitud: enviarSolicitud,
  aceptarSolicitud: aceptarSolicitud,
  eliminarSolicitud: eliminarSolicitud,
  quitarAmigo: quitarAmigo,
  guardarResumenHoy: guardarResumenHoy,
  leerResumenHoyDeAmigo: leerResumenHoyDeAmigo,
  activarCompartirCompleto: activarCompartirCompleto,
  leerHorarioCompletoDeAmigo: leerHorarioCompletoDeAmigo,
  crearGrupo: crearGrupo,
  salirDeGrupo: salirDeGrupo,
  eliminarGrupo: eliminarGrupo,
  agregarReunion: agregarReunion,
  eliminarReunion: eliminarReunion,
  escucharReunionesDeGrupo: escucharReunionesDeGrupo,
  invitarAGrupo: invitarAGrupo,
  aceptarInvitacionGrupo: aceptarInvitacionGrupo,
  rechazarInvitacionGrupo: rechazarInvitacionGrupo,
};
window.uidActual = function () {
  const u = usuarioActual();
  return u ? u.uid : null;
};

async function iniciar() {
  if (!FIREBASE_HABILITADO) {
    const btn = document.getElementById("btnCuenta");
    if (btn) btn.style.display = "none";
    return;
  }
  await iniciarAuth();
  iniciarSync();
  _conectarUI();
}

// Toast propio de la app (index.html expone window.toast); alert() como
// respaldo si por lo que sea todavía no está definido.
function _avisar(msg) {
  if (typeof window.toast === "function") window.toast(msg);
  else alert(msg);
}

// Traduce los códigos de error más comunes de Firebase Auth a algo que un
// usuario entienda — antes cualquiera de estos se mostraba como el string
// crudo de Firebase ("Firebase: Error (auth/xxx)"), que además de feo
// hace parecer que algo se rompió cuando muchas veces es solo que la
// persona cerró la ventana. Devuelve null cuando no hay nada que avisar
// (cancelaciones benignas).
function _mensajeErrorAuth(e) {
  const code = e && e.code;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    // La persona cerró la ventana emergente (o abrió otra encima) antes
    // de terminar — no es un error real, no hace falta alarmar.
    return null;
  }
  if (code === "auth/popup-blocked") {
    return "Tu navegador bloqueó la ventana de inicio de sesión. Permite ventanas emergentes para este sitio e intenta de nuevo.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "Ya existe una cuenta con ese correo usando otro método de inicio de sesión (por ejemplo Google). Entra con ese método, o usa un correo distinto.";
  }
  if (code === "auth/network-request-failed") {
    return "No hay conexión a internet. Intenta de nuevo cuando vuelvas a tener red.";
  }
  return "No se pudo iniciar sesión: " + (e && e.message ? e.message : e);
}

function _conectarUI() {
  const btnCuenta = document.getElementById("btnCuenta");
  const modal = document.getElementById("authModal");
  const btnGoogle = document.getElementById("btnGoogleLogin");
  const btnMicrosoft = document.getElementById("btnMicrosoftLogin");
  const btnCerrar = document.getElementById("authClose");
  const btnSalir = document.getElementById("btnLogout");
  const accountMenu = document.getElementById("accountMenu");
  const btnCerrarMenu = document.getElementById("accountMenuClose");

  if (btnCuenta) {
    btnCuenta.addEventListener("click", function (e) {
      const esGoogle = btnCuenta.getAttribute("data-logged") === "1";
      if (esGoogle) {
        e.stopPropagation(); // no dispare el cierre-al-hacer-clic-afuera de abajo
        if (accountMenu) accountMenu.classList.toggle("open");
      } else if (modal) {
        modal.classList.add("show");
      }
    });
  }

  // Botón ✕ dentro del menú, y clic fuera de él — antes solo se cerraba
  // tocando de nuevo el ícono de cuenta, o al usar una de sus acciones
  // (Editar perfil, Configuración, Cerrar sesión); no había forma directa
  // de simplemente descartarlo.
  if (btnCerrarMenu && accountMenu) {
    btnCerrarMenu.addEventListener("click", function () {
      accountMenu.classList.remove("open");
    });
  }
  document.addEventListener("click", function (e) {
    if (
      accountMenu &&
      accountMenu.classList.contains("open") &&
      !accountMenu.contains(e.target)
    ) {
      accountMenu.classList.remove("open");
    }
  });

  if (btnGoogle) {
    btnGoogle.addEventListener("click", async function () {
      try {
        btnGoogle.disabled = true;
        await entrarConGoogle();
        if (modal) modal.classList.remove("show");
      } catch (e) {
        const msg = _mensajeErrorAuth(e);
        if (msg) _avisar(msg);
      } finally {
        btnGoogle.disabled = false;
      }
    });
  }

  if (btnMicrosoft) {
    // El tenant de la universidad en Entra ID exige aprobación de un
    // administrador para cualquier app externa (aunque no pida ningún
    // permiso de Graph) — no es algo que se pueda resolver desde la app.
    // El botón se deja visible como adelanto, mostrando el aviso de abajo
    // en vez de intentar el login real, hasta que eso se resuelva del
    // lado de la universidad.
    //
    // Para reactivarlo cuando ya no haga falta: comenta el bloque
    // "DESACTIVADO" y descomenta el bloque "LOGIN REAL" de abajo.
    const avisoProximamente = document.getElementById("msProximamente");

    // ---- DESACTIVADO (quitar este bloque para reactivar) ----
    btnMicrosoft.addEventListener("click", function () {
      if (avisoProximamente) avisoProximamente.style.display = "";
    });
    // ---- fin DESACTIVADO ----

    // ---- LOGIN REAL (descomentar para reactivar) ----
    // btnMicrosoft.addEventListener("click", async function () {
    //   try {
    //     btnMicrosoft.disabled = true;
    //     await entrarConMicrosoft();
    //     if (modal) modal.classList.remove("show");
    //   } catch (e) {
    //     // Mensaje exacto pedido para el caso de dominio: correo de
    //     // Microsoft fuera del institucional. entrarConMicrosoft() ya
    //     // deshizo el link/cerró sesión antes de llegar aquí.
    //     const msg = e && e.tipo === "dominio" ? e.message : _mensajeErrorAuth(e);
    //     if (msg) _avisar(msg);
    //   } finally {
    //     btnMicrosoft.disabled = false;
    //   }
    // });
    // ---- fin LOGIN REAL ----
  }

  if (btnCerrar && modal) {
    btnCerrar.addEventListener("click", function () {
      modal.classList.remove("show");
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.classList.remove("show");
    });
  }

  if (btnSalir) {
    btnSalir.addEventListener("click", async function () {
      await salir();
      const menu = document.getElementById("accountMenu");
      if (menu) menu.classList.remove("open");
    });
  }

  alCambiarUsuario(function (user) {
    _pintarUsuario(user);
    _pintarBotonAmigos(user);
    _pintarBotonGrupos(user);
    _recordarLoginSiEsNuevo(user);
    // Avisa a index.html (script clásico, no módulo) cuando la sesión
    // termina, para que borre de la pantalla el horario/actividades/
    // puntos de la cuenta que se acaba de ir — sin esto, lo que había
    // en memoria se quedaba visible hasta recargar la página, aunque
    // Firestore ya hubiera cortado esa cuenta.
    if (typeof window.__alCambiarSesion === "function") window.__alCambiarSesion(user);
  });
  alCambiarEstado(function (estado) {
    _pintarEstado(estado);
  });
}

/* Solo se muestra la cuenta/menú de Google cuando la sesión ya está
   vinculada a Google — una sesión anónima no tiene nombre/foto que
   mostrar, y el botón de cuenta simplemente ofrece iniciar sesión. */
function _pintarUsuario(user) {
  const btnCuenta = document.getElementById("btnCuenta");
  const nombreEl = document.getElementById("accountName");
  const fotoEl = document.getElementById("accountPhoto");
  if (!btnCuenta) return;

  if (user && !user.esAnonimo) {
    btnCuenta.setAttribute("data-logged", "1");
    btnCuenta.setAttribute("title", user.nombre);
    if (nombreEl) nombreEl.textContent = user.nombre;
    if (fotoEl) {
      if (user.foto) {
        fotoEl.src = user.foto;
        fotoEl.style.display = "";
      } else {
        fotoEl.style.display = "none";
      }
    }
    const iconEl = document.getElementById("cuentaIcon");
    const avatarEl = document.getElementById("cuentaAvatar");
    if (user.foto && avatarEl && iconEl) {
      avatarEl.src = user.foto;
      avatarEl.style.display = "";
      iconEl.style.display = "none";
    }
  } else {
    btnCuenta.setAttribute("data-logged", "0");
    btnCuenta.setAttribute("title", "Iniciar sesión");
    const iconEl = document.getElementById("cuentaIcon");
    const avatarEl = document.getElementById("cuentaAvatar");
    if (avatarEl && iconEl) {
      avatarEl.style.display = "none";
      iconEl.style.display = "";
    }
  }
}

/* El botón de Amigos solo tiene sentido con una cuenta real (no
   anónima) — sin eso, no hay con quién identificarse ni a quién
   agregar. Deshabilitado significa deshabilitado de verdad: el propio
   botón queda con disabled=true, así que ni siquiera dispara su click
   handler (ver index.html) — "no debe intentar consultar Firestore" se
   cumple porque el código que lo haría nunca llega a correr. */
function _pintarBotonAmigos(user) {
  const btn = document.getElementById("btnAmigos");
  if (!btn) return;
  const conectado = !!(user && !user.esAnonimo);
  btn.disabled = !conectado;
  btn.title = conectado ? "Amigos" : "Inicia sesión para usar Amigos";
  if (!conectado) {
    const menu = document.getElementById("friendsModal");
    if (menu) menu.classList.remove("show");
  }
}

function _pintarBotonGrupos(user) {
  const btn = document.getElementById("btnGrupos");
  if (!btn) return;
  const conectado = !!(user && !user.esAnonimo);
  btn.disabled = !conectado;
  btn.title = conectado ? "Grupos de estudio" : "Inicia sesión para usar Grupos de estudio";
  if (!conectado) {
    const modal = document.getElementById("groupsModal");
    if (modal) modal.classList.remove("show");
    const board = document.getElementById("groupBoardModal");
    if (board) board.classList.remove("show");
  }
}

// Recordatorio de una sola vez, solo para cuentas genuinamente nuevas
// (ver "esNuevo" en auth-service.js:_normalizar): reusa el mismo
// #authModal que ya abre btnCuenta, así que no hay UI nueva que
// mantener — es opcional (el modal ya deja bien claro que la app
// funciona igual sin cuenta), nunca bloquea nada.
const RECORDATORIO_LOGIN_KEY = "generadorHorarios:vioRecordatorioLogin";
function _recordarLoginSiEsNuevo(user) {
  if (!user || !user.esAnonimo || !user.esNuevo) return;
  let yaVisto = false;
  try {
    yaVisto = localStorage.getItem(RECORDATORIO_LOGIN_KEY) === "1";
  } catch (e) {}
  if (yaVisto) return;
  try {
    localStorage.setItem(RECORDATORIO_LOGIN_KEY, "1");
  } catch (e) {}
  setTimeout(function () {
    const modal = document.getElementById("authModal");
    if (modal) modal.classList.add("show");
  }, 900);
}

function _pintarEstado(estado) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  const mapa = {
    [ESTADOS.GUARDANDO]: { icon: "☁", txt: "Guardando..." },
    [ESTADOS.GUARDADO]: { icon: "✓", txt: "Guardado" },
    [ESTADOS.ACTUALIZANDO]: { icon: "🔄", txt: "Actualizando..." },
    [ESTADOS.ERROR]: { icon: "⚠", txt: "Error al guardar" },
  };
  const info = mapa[estado] || mapa[ESTADOS.GUARDADO];
  el.textContent = info.icon + " " + info.txt;
  el.setAttribute("data-estado", estado);
  el.style.display = "";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciar);
} else {
  iniciar();
}
