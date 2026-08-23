/* ============================================================
   firestore-service.js
   ------------------------------------------------------------
   Firestore es la ÚNICA fuente de datos de la app. Cada entidad
   (clase, actividad, materia de puntos, horario guardado) es su
   propio documento en una subcolección de users/{uid} — nunca un
   campo dentro de un documento gigante compartido. Nada de esto
   pasa por localStorage/IndexedDB propios de la app.
   ============================================================ */

import { getFirebase } from "./firebase-config.js";

const SUBCOLECCIONES = ["classes", "activities", "pointsSubjects", "schedules"];
const SINGLETONS = ["settings", "favorites"];

// Mismo algoritmo que idParaMateria() en index.html — un id determinístico
// por nombre de materia (normalizado), así dos dispositivos (o, aquí, la
// migración) nunca generan ids distintos para la misma materia.
function _idParaMateria(nombre) {
  let s = String(nombre || "").trim().toLowerCase();
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "mat-" + Math.abs(h).toString(36);
}
function _norm(s) {
  return String(s || "").trim().toLowerCase();
}

async function _colRef(uid, coleccion) {
  const fb = await getFirebase();
  return { fb, ref: fb.collection(fb.db, "users", uid, coleccion) };
}
async function _docRef(uid, coleccion, id) {
  const fb = await getFirebase();
  return { fb, ref: fb.doc(fb.db, "users", uid, coleccion, id) };
}

/* ------------------------------------------------------------
   CRUD genérico — vale para classes/activities/pointsSubjects/
   schedules, que comparten exactamente la misma forma: doc propio,
   id estable dado por el cliente, version + createdAt + updatedAt.
   ------------------------------------------------------------ */
export async function crearDoc(uid, coleccion, id, datos) {
  const { fb, ref } = await _docRef(uid, coleccion, id);
  await fb.setDoc(ref, Object.assign({}, datos, {
    version: 1,
    createdAt: fb.serverTimestamp(),
    updatedAt: fb.serverTimestamp(),
  }));
  return id;
}

/* Actualización con control de concurrencia optimista: si el
   documento cambió desde la última vez que la interfaz lo leyó
   (expectedVersion ya no coincide), se aborta en vez de pisar el
   cambio más nuevo — "nunca dejar que una versión vieja sobrescriba
   silenciosamente una más reciente". Si el documento ya no existe
   (lo borraron en otro dispositivo), también se aborta. */
export async function actualizarConVersion(uid, coleccion, id, patch, expectedVersion) {
  const { fb, ref } = await _docRef(uid, coleccion, id);
  await fb.runTransaction(fb.db, async function (tx) {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      const e = new Error("NOT_FOUND");
      e.tipo = "eliminado";
      throw e;
    }
    const actual = snap.data().version || 1;
    if (expectedVersion != null && actual !== expectedVersion) {
      const e = new Error("VERSION_CONFLICT");
      e.tipo = "conflicto";
      throw e;
    }
    tx.update(ref, Object.assign({}, patch, {
      version: actual + 1,
      updatedAt: fb.serverTimestamp(),
    }));
  });
}

/* Para singletons de preferencias (settings/favorites) donde un
   roce de última escritura no arriesga contenido real del usuario
   — no necesita transacción ni chequeo de versión. */
export async function actualizarSinVersion(uid, coleccion, id, patch) {
  const { fb, ref } = await _docRef(uid, coleccion, id);
  await fb.setDoc(ref, Object.assign({}, patch, { updatedAt: fb.serverTimestamp() }), { merge: true });
}

/* Eliminación física: cada entidad es su propio documento y ya no
   existe una copia local con la que "fusionar", así que no hace
   falta la tumba deleted:true de antes — deleteDoc() sobre un
   documento que ya no existe es una operación silenciosamente
   válida (idempotente), y actualizarConVersion() de arriba ya
   protege contra que una escritura vieja "resucite" algo borrado. */
export async function eliminarDoc(uid, coleccion, id) {
  const { fb, ref } = await _docRef(uid, coleccion, id);
  await fb.deleteDoc(ref);
}

/* Lote atómico — para operaciones que deben aplicarse todas juntas
   o ninguna (ej. reemplazar las filas de una materia al editarla):
   operaciones = [{tipo:'set', coleccion, id, datos} | {tipo:'delete', coleccion, id}] */
export async function guardarLote(uid, operaciones) {
  const fb = await getFirebase();
  const batch = fb.writeBatch(fb.db);
  operaciones.forEach(function (op) {
    const ref = fb.doc(fb.db, "users", uid, op.coleccion, op.id);
    if (op.tipo === "delete") {
      batch.delete(ref);
    } else {
      batch.set(ref, Object.assign({}, op.datos, {
        version: 1,
        createdAt: fb.serverTimestamp(),
        updatedAt: fb.serverTimestamp(),
      }));
    }
  });
  await batch.commit();
}

export async function guardarSingleton(uid, coleccion, datos) {
  const { fb, ref } = await _docRef(uid, coleccion, "singleton");
  await fb.setDoc(ref, Object.assign({}, datos, { updatedAt: fb.serverTimestamp() }), { merge: true });
}

// Código de amigo: 6 caracteres, sin 0/O/1/I (se prestan a confundirse al
// copiarlos a mano). ~1070 millones de combinaciones — de sobra para que
// un choque al azar sea rarísimo, y aun así _reclamarCodigo() reintenta
// con uno nuevo si pasara.
const CODIGO_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function _generarCodigo() {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODIGO_CHARS[Math.floor(Math.random() * CODIGO_CHARS.length)];
  }
  return s;
}
// Genera un código y "lo reclama" creando userDirectory/{codigo} — si ya
// existía (choque con el de otro uid), firestore.rules rechaza la
// escritura (el "create"/"update" de esa regla exige que el uid ya
// guardado ahí sea el mío) y se reintenta con un código distinto.
async function _reclamarCodigo(fb, uid, datosDirectorio) {
  for (let intento = 0; intento < 5; intento++) {
    const codigo = _generarCodigo();
    const ref = fb.doc(fb.db, "userDirectory", codigo);
    try {
      await fb.setDoc(ref, Object.assign({ uid: uid }, datosDirectorio));
      return codigo;
    } catch (e) {
      // choque de código: sigue al siguiente intento
    }
  }
  throw new Error("No se pudo generar un código de amigo único. Intenta de nuevo.");
}

// Espejo público mínimo del perfil, para poder BUSCAR por código (ver
// buscarPorCodigo): users/{uid} es privado por uid, y el código —a
// diferencia del correo— no vive en ningún token verificable, así que el
// directorio es lo único capaz de resolver "código -> uid/nombre/...".
// El id del documento ES el código — "buscar" es un getDoc por clave
// conocida, nunca un query abierto sobre todos los usuarios (ver
// firestore.rules: userDirectory no permite list, solo get). Siempre un
// reemplazo COMPLETO (sin merge): así el contenido de request.resource.data
// en la regla es exactamente este objeto, sin depender de cómo Firestore
// resuelva un merge parcial.
async function _sincronizarDirectorio(fb, uid, ref) {
  const snap = await fb.getDoc(ref);
  if (!snap.exists() || !snap.data().codigo) return;
  const d = snap.data();
  const dirRef = fb.doc(fb.db, "userDirectory", d.codigo);
  await fb.setDoc(dirRef, {
    uid: uid,
    nombre: d.nombre || "",
    programa: d.programa || "",
    semestre: d.semestre || "",
  });
}

// Escritura del usuario (formulario "Editar perfil"): nombre/programa/
// semestre siempre, universidad solo si el llamador la incluye (el
// formulario la omite cuando universidadTipo es "institucional" — esa
// combinación además la rechaza firestore.rules si algo se colara).
export async function escribirPerfil(uid, patch) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "users", uid);
  await fb.setDoc(ref, Object.assign({}, patch, { updatedAt: fb.serverTimestamp() }), { merge: true });
  await _sincronizarDirectorio(fb, uid, ref);
}

const DOMINIO_INSTITUCIONAL = "@unimagdalena.edu.co";
const UNIVERSIDAD_INSTITUCIONAL = "Universidad del Magdalena";

/* Crea (o refresca) users/{uid} al iniciar sesión con una cuenta real
   (no anónima). Es bootstrap, no una acción del usuario — por eso no pasa
   por ejecutarEscritura(), igual que migrarLocalStorageAFirestore() más
   abajo. nombre/programa/semestre/universidad son editables por el
   usuario (ver escribirPerfil/"Editar perfil"): solo se fijan la primera
   vez que se crea el documento. codigo se genera UNA vez y ya no cambia
   nunca (ver _reclamarCodigo). En logins siguientes solo se refresca
   email/proveedor — esos SÍ reflejan la cuenta real, no algo que el
   usuario edite. */
export async function asegurarPerfil(uid, info) {
  if (!info || info.esAnonimo) return;
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "users", uid);
  const snap = await fb.getDoc(ref);
  const esInstitucional = String(info.email || "").toLowerCase().endsWith(DOMINIO_INSTITUCIONAL);

  if (!snap.exists()) {
    const codigo = await _reclamarCodigo(fb, uid, {
      nombre: info.nombre || "",
      programa: "",
      semestre: "",
    });
    await fb.setDoc(ref, {
      nombre: info.nombre || "",
      email: info.email || "",
      codigo: codigo,
      programa: "",
      semestre: "",
      universidad: esInstitucional ? UNIVERSIDAD_INSTITUCIONAL : "",
      universidadTipo: esInstitucional ? "institucional" : "manual",
      proveedor: info.proveedor || "",
      createdAt: fb.serverTimestamp(),
      updatedAt: fb.serverTimestamp(),
    });
    return;
  }
  const actual = snap.data();
  const patch = {
    email: info.email || actual.email || "",
    proveedor: info.proveedor || actual.proveedor || "",
    updatedAt: fb.serverTimestamp(),
  };
  // Cuentas creadas antes de que existiera el código de amigo: se les
  // asigna uno la próxima vez que inicien sesión, sin pedirles nada.
  if (!actual.codigo) {
    patch.codigo = await _reclamarCodigo(fb, uid, {
      nombre: actual.nombre || "",
      programa: actual.programa || "",
      semestre: actual.semestre || "",
    });
  }
  await fb.setDoc(ref, patch, { merge: true });
  await _sincronizarDirectorio(fb, uid, ref);
}

/* ------------------------------------------------------------
   Migración única desde la versión anterior (localStorage como
   fuente principal). Si Firestore ya tiene datos para este uid no
   hace nada (para no pisar algo ya sincronizado desde otro
   dispositivo). Al terminar borra las claves viejas de
   localStorage — eso mismo es la marca de "ya migrado", no hace
   falta una bandera aparte.
   ------------------------------------------------------------ */
export async function migrarLocalStorageAFirestore(uid) {
  let legacyState = null;
  let legacySaved = null;
  try {
    legacyState = JSON.parse(localStorage.getItem("generadorHorarios:v1") || "null");
  } catch (e) {}
  try {
    legacySaved = JSON.parse(localStorage.getItem("generadorHorarios:saved") || "null");
  } catch (e) {}
  if (!legacyState && !legacySaved) return;

  const fb = await getFirebase();
  const yaExiste = await fb.getDocs(fb.collection(fb.db, "users", uid, "classes"));
  if (!yaExiste.empty) {
    _borrarClavesLegado();
    return;
  }

  const batch = fb.writeBatch(fb.db);
  const ahora = fb.serverTimestamp();

  ((legacyState && legacyState.classes) || []).forEach(function (c) {
    batch.set(fb.doc(fb.db, "users", uid, "classes", c.id),
      Object.assign({}, c, { version: 1, createdAt: ahora, updatedAt: ahora }));
  });
  ((legacyState && legacyState.activities) || []).forEach(function (a) {
    batch.set(fb.doc(fb.db, "users", uid, "activities", a.id),
      Object.assign({}, a, { version: 1, createdAt: ahora, updatedAt: ahora }));
  });
  // Se agrupan por nombre normalizado antes de escribir: en datos viejos
  // (de antes de que las materias de Puntos tuvieran un id determinístico)
  // puede haber más de una entrada para la misma materia. Sin este paso,
  // ambas se copiarían tal cual a Firestore como documentos separados y la
  // materia aparecería duplicada en Puntos.
  const porNombre = {};
  ((legacyState && legacyState.puntos && legacyState.puntos.subjects) || []).forEach(function (s) {
    const k = _norm(s.nombre);
    (porNombre[k] = porNombre[k] || []).push(s);
  });
  Object.keys(porNombre).forEach(function (k) {
    const grupo = porNombre[k];
    grupo.sort(function (a, b) {
      const pa = (a.activities || []).length, pb = (b.activities || []).length;
      if (pb !== pa) return pb - pa;
      return (b.creditos || 0) - (a.creditos || 0);
    });
    const elegido = grupo[0];
    batch.set(fb.doc(fb.db, "users", uid, "pointsSubjects", _idParaMateria(elegido.nombre)),
      Object.assign({}, elegido, { version: 1, createdAt: ahora, updatedAt: ahora }));
  });
  (legacySaved || []).forEach(function (sch) {
    batch.set(fb.doc(fb.db, "users", uid, "schedules", sch.id),
      Object.assign({}, sch, { version: 1, createdAt: ahora, updatedAt: ahora }));
  });

  let builderPrefs = {};
  try {
    builderPrefs = JSON.parse(localStorage.getItem("generadorHorarios:builderPrefs") || "{}");
  } catch (e) {}
  batch.set(fb.doc(fb.db, "users", uid, "settings", "singleton"), {
    meta: (legacyState && legacyState.meta) || { title: "", author: "" },
    settings: (legacyState && legacyState.settings) || { days: 5, dayStart: "07:00", dayEnd: "19:00" },
    builderPrefs: builderPrefs,
    theme: localStorage.getItem("generadorHorarios:theme") || "light",
    viewMode: localStorage.getItem("generadorHorarios:view") || "week",
    notifOn: localStorage.getItem("generadorHorarios:notifOn") === "1",
    currentSavedId: (legacyState && legacyState.currentSavedId) || null,
    updatedAt: ahora,
  }, { merge: true });

  const principal = localStorage.getItem("generadorHorarios:principal");
  if (principal) {
    batch.set(fb.doc(fb.db, "users", uid, "favorites", "singleton"),
      { scheduleId: principal, updatedAt: ahora });
  }

  await batch.commit();
  _borrarClavesLegado();
}

function _borrarClavesLegado() {
  [
    "generadorHorarios:v1",
    "generadorHorarios:saved",
    "generadorHorarios:theme",
    "generadorHorarios:view",
    "generadorHorarios:principal",
    "generadorHorarios:builderPrefs",
    "generadorHorarios:notifOn",
  ].forEach(function (k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  });
  // generadorHorarios:avisados y generadorHorarios:tab quedan tal cual:
  // son estado de ESTE navegador (qué avisos ya se mostraron, última
  // pestaña abierta), no datos del usuario que deban vivir en la nube.
}

/* ------------------------------------------------------------
   Amigos — buscar por código, solicitudes, amistades, y el resumen de
   HOY que un amigo puede consultar (ver el comentario grande sobre
   diseño en firestore.rules: nunca se expone la colección "classes"
   completa a otro usuario, solo este snapshot recortado a hoy).

   Se busca por el "código de amigo" (users/{uid}.codigo, ver
   _reclamarCodigo más arriba) en vez de por correo: así nadie necesita
   compartir su correo para que lo agreguen, y la búsqueda nunca expone
   ese dato — el directorio (userDirectory) tampoco lo guarda.

   friendRequests/{fromUid}_{toUid} y friendships/{minUid}_{maxUid} usan
   ids determinísticos a propósito: reintentar una acción cae siempre en
   el MISMO documento, así que "evitar duplicados" es gratis (Firestore/
   las reglas ya lo impiden por construcción, no hace falta comprobarlo
   a mano en cada función).
   ------------------------------------------------------------ */
function _idPar(a, b) {
  return a < b ? a + "_" + b : b + "_" + a;
}
function _normCodigo(c) {
  return String(c || "").trim().toUpperCase();
}

// Buscar por código: un solo getDoc por clave conocida (nunca una lista
// de todos los usuarios — ver "allow list: if false" en firestore.rules).
export async function buscarPorCodigo(codigo) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "userDirectory", _normCodigo(codigo));
  const snap = await fb.getDoc(ref);
  return snap.exists() ? snap.data() : null; // {uid, nombre, programa, semestre} | null
}

// Estado de la relación entre "yo" y "otroUid" — para decidir qué mostrar
// en el resultado de una búsqueda (Agregar / Solicitud enviada / Aceptar
// y rechazar / Ya son amigos).
export async function obtenerEstadoRelacion(miUid, otroUid) {
  const fb = await getFirebase();
  const [amistad, enviada, recibida] = await Promise.all([
    fb.getDoc(fb.doc(fb.db, "friendships", _idPar(miUid, otroUid))),
    fb.getDoc(fb.doc(fb.db, "friendRequests", miUid + "_" + otroUid)),
    fb.getDoc(fb.doc(fb.db, "friendRequests", otroUid + "_" + miUid)),
  ]);
  if (amistad.exists()) return { estado: "amigos" };
  if (enviada.exists() && enviada.data().status === "pending") return { estado: "enviada" };
  if (recibida.exists() && recibida.data().status === "pending") return { estado: "recibida" };
  return { estado: "ninguna" };
}

export async function enviarSolicitud(miUid, miCodigo, otroUid, otroCodigo) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "friendRequests", miUid + "_" + otroUid);
  await fb.setDoc(ref, {
    from: miUid,
    to: otroUid,
    fromCodigo: _normCodigo(miCodigo),
    toCodigo: _normCodigo(otroCodigo),
    status: "pending",
    createdAt: fb.serverTimestamp(),
    updatedAt: fb.serverTimestamp(),
  });
}

// Acepta una solicitud recibida: marca la solicitud como aceptada Y crea
// la amistad en el mismo lote atómico (todo o nada — nunca queda una
// aceptada sin su amistad, ni viceversa).
export async function aceptarSolicitud(fromUid, toUid) {
  const fb = await getFirebase();
  const reqRef = fb.doc(fb.db, "friendRequests", fromUid + "_" + toUid);
  const reqSnap = await fb.getDoc(reqRef);
  if (!reqSnap.exists()) {
    const e = new Error("La solicitud ya no existe.");
    e.tipo = "eliminado";
    throw e;
  }
  const d = reqSnap.data();
  const uidMin = fromUid < toUid ? fromUid : toUid;
  const uidMax = fromUid < toUid ? toUid : fromUid;
  const codigoMin = uidMin === fromUid ? d.fromCodigo : d.toCodigo;
  const codigoMax = uidMax === fromUid ? d.fromCodigo : d.toCodigo;
  const batch = fb.writeBatch(fb.db);
  batch.update(reqRef, { status: "accepted", updatedAt: fb.serverTimestamp() });
  batch.set(fb.doc(fb.db, "friendships", uidMin + "_" + uidMax), {
    users: [uidMin, uidMax],
    codigos: [codigoMin, codigoMax],
    createdAt: fb.serverTimestamp(),
  });
  await batch.commit();
}

// Rechazar (o cancelar una que yo mismo envié) es lo mismo: borrar el
// documento — deja el camino libre para reintentar más tarde, sin un
// estado "rechazada" colgado a mitad de camino.
export async function eliminarSolicitud(fromUid, toUid) {
  const fb = await getFirebase();
  await fb.deleteDoc(fb.doc(fb.db, "friendRequests", fromUid + "_" + toUid));
}

export async function quitarAmigo(miUid, otroUid) {
  const fb = await getFirebase();
  await fb.deleteDoc(fb.doc(fb.db, "friendships", _idPar(miUid, otroUid)));
}

// El snapshot de "hoy" que un amigo puede leer (ver users/{uid}/
// todaySchedule/{docId} en firestore.rules) — reemplazo completo, nunca
// merge, para que sea exactamente lo que index.html calculó con
// clasesDeHoyDe() y nada más.
export async function guardarResumenHoy(uid, resumen) {
  const { fb, ref } = await _docRef(uid, "todaySchedule", "singleton");
  await fb.setDoc(ref, {
    dayName: resumen.dayName,
    classes: resumen.classes,
    updatedAt: fb.serverTimestamp(),
  });
}

// Lectura puntual (no listener): se abre el modal, se mira, se cierra —
// no hace falta mantenerlo sincronizado en vivo como sí las solicitudes.
export async function leerResumenHoyDeAmigo(uid) {
  const { fb, ref } = await _docRef(uid, "todaySchedule", "singleton");
  const snap = await fb.getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Comparar horarios COMPLETOS (no solo "hoy") es opt-in por amigo: cada
// quien prende/apaga su propia bandera dentro del MISMO documento de la
// amistad. La regla en firestore.rules impide que yo toque la bandera
// del otro — merge:true en un mapa anidado solo escribe mi llave, sin
// tocar la del otro (Firestore hace merge recursivo de mapas, a
// diferencia de los arreglos, que si se reemplazan enteros).
export async function activarCompartirCompleto(miUid, otroUid, valor) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "friendships", _idPar(miUid, otroUid));
  await fb.setDoc(
    ref,
    { compartirCompleto: { [miUid]: !!valor }, updatedAt: fb.serverTimestamp() },
    { merge: true },
  );
}

// Lectura puntual (no listener, mismo estilo que leerResumenHoyDeAmigo):
// el horario semanal COMPLETO de un amigo. Si ese amigo no activó el
// opt-in hacia mí, firestore.rules deniega esta lectura con
// "permission denied" — este archivo no decide el permiso, solo lo pide.
export async function leerHorarioCompletoDeAmigo(uid) {
  const fb = await getFirebase();
  const [classesSnap, settingsSnap] = await Promise.all([
    fb.getDocs(fb.collection(fb.db, "users", uid, "classes")),
    fb.getDoc(fb.doc(fb.db, "users", uid, "settings", "singleton")),
  ]);
  const classes = [];
  classesSnap.forEach(function (d) {
    classes.push(Object.assign({ id: d.id }, d.data()));
  });
  return {
    classes: classes,
    settings: settingsSnap.exists()
      ? settingsSnap.data()
      : { days: 5, dayStart: "07:00", dayEnd: "19:00" },
  };
}

// ---------- Grupos de estudio ----------
// Un grupo pequeño de amigos con un tablero compartido de próximas
// reuniones. Nadie entra sin invitación propia (ver groupInvites más
// abajo): un grupo se crea SOLO con quien lo crea como miembro.
export async function crearGrupo(miUid, nombre) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.collection(fb.db, "studyGroups"));
  await fb.setDoc(ref, {
    nombre: String(nombre || "").trim() || "Grupo de estudio",
    creadoPor: miUid,
    miembros: [miUid],
    createdAt: fb.serverTimestamp(),
    updatedAt: fb.serverTimestamp(),
  });
  return ref.id;
}

// Invitar a alguien a un grupo YA existente — cualquier miembro puede
// invitar (no solo el creador), tanto al crear el grupo como después.
// groupNombre/miNombre se snapshotan en la invitación porque el invitado
// no puede leer el grupo todavía (no es miembro) — ver el comentario
// grande en firestore.rules. Id determinístico ({groupId}_{to}): invitar
// dos veces a la misma persona al mismo grupo cae en el MISMO documento.
export async function invitarAGrupo(groupId, groupNombre, miUid, miNombre, otroUid) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "groupInvites", groupId + "_" + otroUid);
  await fb.setDoc(ref, {
    groupId: groupId,
    groupNombre: groupNombre,
    from: miUid,
    fromNombre: miNombre || "",
    to: otroUid,
    status: "pending",
    createdAt: fb.serverTimestamp(),
    updatedAt: fb.serverTimestamp(),
  });
}

// Aceptar: marca la invitación como aceptada Y me agrego a mí mismo al
// arreglo "miembros" del grupo, en el mismo lote atómico (mismo patrón
// que aceptarSolicitud() para amigos) — arrayUnion evita una lectura
// previa del documento para calcular el arreglo resultante.
export async function aceptarInvitacionGrupo(groupId, miUid) {
  const fb = await getFirebase();
  const inviteRef = fb.doc(fb.db, "groupInvites", groupId + "_" + miUid);
  const groupRef = fb.doc(fb.db, "studyGroups", groupId);
  const batch = fb.writeBatch(fb.db);
  batch.update(inviteRef, { status: "accepted", updatedAt: fb.serverTimestamp() });
  batch.update(groupRef, { miembros: fb.arrayUnion(miUid) });
  await batch.commit();
}

// Rechazar (o cancelar una que yo mismo mandé) = borrar el documento,
// mismo criterio que eliminarSolicitud() para amigos.
export async function rechazarInvitacionGrupo(groupId, miUid) {
  const fb = await getFirebase();
  await fb.deleteDoc(fb.doc(fb.db, "groupInvites", groupId + "_" + miUid));
}

// "Salir del grupo": me saco a mí mismo del arreglo — firestore.rules
// exige que sea EXACTAMENTE eso (nada más cambia en la misma escritura),
// así que se lee el documento primero para armar el arreglo resultante.
export async function salirDeGrupo(groupId, miUid) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.db, "studyGroups", groupId);
  const snap = await fb.getDoc(ref);
  if (!snap.exists()) return;
  const miembros = (snap.data().miembros || []).filter(function (u) {
    return u !== miUid;
  });
  await fb.setDoc(ref, { miembros: miembros }, { merge: true });
}

// Solo el creador puede borrar el grupo entero (ver "allow delete" en
// firestore.rules) — el tablero de reuniones queda huérfano pero
// inaccesible (nadie más puede leerlo sin el documento del grupo).
export async function eliminarGrupo(groupId) {
  const fb = await getFirebase();
  await fb.deleteDoc(fb.doc(fb.db, "studyGroups", groupId));
}

export async function agregarReunion(groupId, miUid, datos) {
  const fb = await getFirebase();
  const ref = fb.doc(fb.collection(fb.db, "studyGroups", groupId, "reuniones"));
  await fb.setDoc(ref, {
    titulo: String(datos.titulo || "").trim(),
    fecha: datos.fecha || "",
    hora: String(datos.hora || "").trim(),
    lugar: String(datos.lugar || "").trim(),
    comentario: String(datos.comentario || "").trim(),
    creadoPor: miUid,
    createdAt: fb.serverTimestamp(),
  });
  return ref.id;
}

export async function eliminarReunion(groupId, id) {
  const fb = await getFirebase();
  await fb.deleteDoc(fb.doc(fb.db, "studyGroups", groupId, "reuniones", id));
}

// Tablero de UN grupo abierto: listener puntual que arranca al abrir el
// modal del grupo y se cierra al cerrarlo (igual ciclo de vida que el
// setInterval de "¿Quién está libre ahora?", pero aquí con onSnapshot
// porque de verdad es dato de Firestore cambiando en vivo, no un reloj).
export async function escucharReunionesDeGrupo(groupId, callback) {
  const fb = await getFirebase();
  const ref = fb.collection(fb.db, "studyGroups", groupId, "reuniones");
  return fb.onSnapshot(ref, function (snap) {
    const arr = [];
    snap.forEach(function (d) {
      arr.push(Object.assign({ id: d.id }, d.data()));
    });
    callback(arr);
  }, function (err) {
    console.warn("[Grupos] Error escuchando reuniones:", err);
    callback([]);
  });
}

/* ------------------------------------------------------------
   Escuchas en tiempo real (onSnapshot) — la única forma en que la
   interfaz recibe datos. Se cachea la última entrega de cada
   colección/singleton para poder "reenviarla" si index.html todavía
   no había definido sus callbacks window.alActualizar* cuando
   llegó (este módulo, al ser type="module", puede ejecutar antes
   de que el script clásico de la app termine de inicializarse).
   ------------------------------------------------------------ */
const _cache = {
  classes: [],
  activities: [],
  pointsSubjects: [],
  schedules: [],
  settings: null,
  favorites: null,
  perfil: null,
  solicitudesRecibidas: [],
  solicitudesEnviadas: [],
  amigos: [],
  gruposEstudio: [],
  invitacionesGrupo: [],
};
const _NOMBRES_CALLBACK = {
  classes: "alActualizarClases",
  activities: "alActualizarActividades",
  pointsSubjects: "alActualizarPuntos",
  schedules: "alActualizarGuardados",
  settings: "alActualizarSettings",
  favorites: "alActualizarFavorito",
  perfil: "alActualizarPerfil",
  solicitudesRecibidas: "alActualizarSolicitudesRecibidas",
  solicitudesEnviadas: "alActualizarSolicitudesEnviadas",
  amigos: "alActualizarAmigos",
  gruposEstudio: "alActualizarGruposEstudio",
  invitacionesGrupo: "alActualizarInvitacionesGrupo",
};
const _yaEntregada = {};
let _cancelarTodas = null;

function _emitir(clave, datos) {
  const esPrimera = !_yaEntregada[clave];
  _yaEntregada[clave] = true;
  _cache[clave] = datos;
  if (!esPrimera && typeof window.__marcarActualizando === "function") {
    window.__marcarActualizando();
  }
  const nombre = _NOMBRES_CALLBACK[clave];
  if (typeof window[nombre] === "function") window[nombre](datos);
}
function _emitirError(err) {
  console.warn("[Firestore] Error de escucha:", err);
  if (typeof window.alErrorFirestore === "function") window.alErrorFirestore(err);
}

export function iniciarEscuchas(uid) {
  detenerEscuchas();
  const cancelaciones = [];

  SUBCOLECCIONES.forEach(function (coleccion) {
    getFirebase().then(function (fb) {
      const ref = fb.collection(fb.db, "users", uid, coleccion);
      const cancelar = fb.onSnapshot(ref, function (snap) {
        const arr = [];
        snap.forEach(function (d) {
          arr.push(Object.assign({ id: d.id }, d.data()));
        });
        _emitir(coleccion, arr);
      }, _emitirError);
      cancelaciones.push(cancelar);
    });
  });

  SINGLETONS.forEach(function (coleccion) {
    getFirebase().then(function (fb) {
      const ref = fb.doc(fb.db, "users", uid, coleccion, "singleton");
      const cancelar = fb.onSnapshot(ref, function (snap) {
        _emitir(coleccion, snap.exists() ? snap.data() : null);
      }, _emitirError);
      cancelaciones.push(cancelar);
    });
  });

  // Perfil académico: a diferencia de lo de arriba, este es el documento
  // RAÍZ users/{uid} (no una subcolección/singleton colgando de él) — no
  // existe para sesiones anónimas (asegurarPerfil no los crea), así que
  // ahí simplemente llega null.
  getFirebase().then(function (fb) {
    const ref = fb.doc(fb.db, "users", uid);
    const cancelar = fb.onSnapshot(ref, function (snap) {
      _emitir("perfil", snap.exists() ? snap.data() : null);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });

  // Amigos: friendRequests/friendships son colecciones de NIVEL RAÍZ (no
  // cuelgan de users/{uid}), así que en vez de leer TODA la colección
  // (como classes/activities/etc.) se suscribe un query filtrado — mismo
  // _emitir/_emitirError de siempre, solo cambia de qué se suscribe.
  getFirebase().then(function (fb) {
    const q = fb.query(
      fb.collection(fb.db, "friendRequests"),
      fb.where("to", "==", uid),
      fb.where("status", "==", "pending"),
    );
    const cancelar = fb.onSnapshot(q, function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      _emitir("solicitudesRecibidas", arr);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });
  getFirebase().then(function (fb) {
    const q = fb.query(
      fb.collection(fb.db, "friendRequests"),
      fb.where("from", "==", uid),
      fb.where("status", "==", "pending"),
    );
    const cancelar = fb.onSnapshot(q, function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      _emitir("solicitudesEnviadas", arr);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });
  getFirebase().then(function (fb) {
    const q = fb.query(
      fb.collection(fb.db, "friendships"),
      fb.where("users", "array-contains", uid),
    );
    const cancelar = fb.onSnapshot(q, function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      _emitir("amigos", arr);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });
  // Grupos de estudio: mismo patrón de query filtrado que "amigos" arriba
  // (array-contains sobre "miembros" en vez de "users").
  getFirebase().then(function (fb) {
    const q = fb.query(
      fb.collection(fb.db, "studyGroups"),
      fb.where("miembros", "array-contains", uid),
    );
    const cancelar = fb.onSnapshot(q, function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      _emitir("gruposEstudio", arr);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });
  // Invitaciones a grupos recibidas: mismo patrón exacto que
  // solicitudesRecibidas (friendRequests), aplicado a groupInvites.
  getFirebase().then(function (fb) {
    const q = fb.query(
      fb.collection(fb.db, "groupInvites"),
      fb.where("to", "==", uid),
      fb.where("status", "==", "pending"),
    );
    const cancelar = fb.onSnapshot(q, function (snap) {
      const arr = [];
      snap.forEach(function (d) { arr.push(Object.assign({ id: d.id }, d.data())); });
      _emitir("invitacionesGrupo", arr);
    }, _emitirError);
    cancelaciones.push(cancelar);
  });

  _cancelarTodas = function () {
    cancelaciones.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  };
  return _cancelarTodas;
}

export function detenerEscuchas() {
  if (_cancelarTodas) {
    try { _cancelarTodas(); } catch (e) {}
    _cancelarTodas = null;
  }
  Object.keys(_yaEntregada).forEach(function (k) { delete _yaEntregada[k]; });
}

/* Llamado por index.html una sola vez, después de definir todos sus
   window.alActualizar*, para recibir lo que ya se haya cacheado. */
window.__pedirEstadoFirestore = function () {
  Object.keys(_NOMBRES_CALLBACK).forEach(function (clave) {
    const nombre = _NOMBRES_CALLBACK[clave];
    if (typeof window[nombre] === "function" && _yaEntregada[clave]) {
      window[nombre](_cache[clave]);
    }
  });
};
