        var PUNTOS_KEY = "generadorHorarios:puntos";
        var puntosData = { subjects: [] };

        function loadPuntos() {
          try {
            var raw = localStorage.getItem(PUNTOS_KEY);
            if (raw) puntosData = JSON.parse(raw);
          } catch (e) {}
          if (!puntosData || !Array.isArray(puntosData.subjects))
            puntosData = { subjects: [] };
        }
        function savePuntos() {
          try {
            localStorage.setItem(PUNTOS_KEY, JSON.stringify(puntosData));
          } catch (e) {}
        }

        // --- helpers de cálculo ---
        function pObtenidos(s) {
          return (s.activities || []).reduce(function (a, x) {
            return a + (+x.obt || 0);
          }, 0);
        }
        function pTotales(s) {
          return (s.activities || []).reduce(function (a, x) {
            return a + (+x.total || 0);
          }, 0);
        }
        function pPerdidos(s) {
          return pTotales(s) - pObtenidos(s);
        }
        function pEstado(pts) {
          return pts >= 300 ? "ganada" : "perdida";
        }
        function pPonderado() {
          var sumaDef = 0,
            sumaCred = 0;
          puntosData.subjects.forEach(function (s) {
            if (s.excluida) return;
            sumaDef += pObtenidos(s) * (+s.creditos || 0);
            sumaCred += +s.creditos || 0;
          });
          return {
            sumaDef: sumaDef,
            sumaCred: sumaCred,
            valor: sumaCred ? sumaDef / sumaCred : 0,
          };
        }

        // --- crear/eliminar ---
        function addSubjectPuntos() {
          puntosData.subjects.push({
            id: uid(),
            nombre: "Nueva materia",
            creditos: 3,
            excluida: false,
            activities: [],
            _open: true,
          });
          savePuntos();
          renderPuntos();
        }
        function delSubjectPuntos(id) {
          puntosData.subjects = puntosData.subjects.filter(function (s) {
            return s.id !== id;
          });
          savePuntos();
          renderPuntos();
        }
        function addActPuntos(sid) {
          var s = puntosData.subjects.filter(function (x) {
            return x.id === sid;
          })[0];
          if (!s) return;
          if (!s.activities) s.activities = [];
          s.activities.push({ nombre: "", total: 0, obt: 0 });
          savePuntos();
          renderPuntos();
        }
        function delActPuntos(sid, idx) {
          var s = puntosData.subjects.filter(function (x) {
            return x.id === sid;
          })[0];
          if (!s) return;
          s.activities.splice(idx, 1);
          savePuntos();
          renderPuntos();
        }

        // --- render principal ---
        function renderPuntos() {
          var host = $("puntosBody");
          if (!host) return;

          // Resumen ponderado arriba
          var p = pPonderado();
          var resumen =
            '<div class="pts-ponderado">' +
            '<div class="pp-box"><div class="pp-label">Ponderado</div><div class="pp-value">' +
            p.valor.toFixed(0) +
            "</div></div>" +
            '<div class="pp-box"><div class="pp-label">Suma definitiva</div><div class="pp-value small">' +
            p.sumaDef +
            "</div></div>" +
            '<div class="pp-box"><div class="pp-label">Créditos</div><div class="pp-value small">' +
            p.sumaCred +
            "</div></div>" +
            "</div>";

          // Tabla general de materias
          var tabla = '<div class="pts-general">';
          tabla +=
            '<div class="pg-head"><span>Materia</span><span>Puntos</span>' +
            "<span>Créditos</span><span>Definitiva</span><span></span></div>";
          if (puntosData.subjects.length === 0) {
            tabla +=
              '<div class="pg-empty">Aún no hay materias. Agrega una para empezar.</div>';
          }
          puntosData.subjects.forEach(function (s) {
            var obt = pObtenidos(s);
            var def = s.excluida ? "—" : obt * (+s.creditos || 0);
            var est = pEstado(obt);
            tabla +=
              '<div class="pg-row' +
              (s.excluida ? " excluida" : "") +
              '">' +
              '<span class="pg-mat">' +
              '<span class="pg-dot ' +
              est +
              '"></span>' +
              esc(s.nombre) +
              "</span>" +
              '<span class="pg-pts ' +
              est +
              '">' +
              obt +
              "</span>" +
              "<span>" +
              (+s.creditos || 0) +
              "</span>" +
              "<span>" +
              def +
              "</span>" +
              '<span><button class="pg-eye" data-eye="' +
              s.id +
              '" title="' +
              (s.excluida
                ? "Excluida del ponderado (clic para incluir)"
                : "Incluida (clic para excluir)") +
              '">' +
              (s.excluida ? eyeOff : eyeOn) +
              "</button></span>" +
              "</div>";
          });
          tabla += "</div>";

          // Detalle por materia (acordeones con actividades)
          var detalle = '<div class="pts-detalle">';
          puntosData.subjects.forEach(function (s) {
            var obt = pObtenidos(s),
              tot = pTotales(s),
              per = pPerdidos(s);
            var est = pEstado(obt);
            detalle +=
              '<div class="pd-card">' +
              '<div class="pd-head" data-toggle="' +
              s.id +
              '">' +
              '<input class="pd-name" data-name="' +
              s.id +
              '" value="' +
              esc(s.nombre) +
              '" placeholder="Nombre de la materia" />' +
              '<div class="pd-meta">' +
              '<label>Créditos <input type="number" min="0" class="pd-cred" data-cred="' +
              s.id +
              '" value="' +
              (+s.creditos || 0) +
              '" /></label>' +
              '<span class="pd-score ' +
              est +
              '" data-scorecard="' + s.id + '">' +
              obt +
              " / " +
              tot +
              "</span>" +
              "</div>" +
              '<button class="pd-del" data-delsub="' +
              s.id +
              '" title="Eliminar materia">✕</button>' +
              "</div>";
            // Barra de progreso 0-500
            var pct = Math.max(0, Math.min(100, (obt / 500) * 100));
            detalle +=
              '<div class="pd-bar"><div class="pd-bar-fill ' +
              est +
              '" data-barfill="' + s.id + '" style="width:' +
              pct +
              '%"></div>' +
              '<span class="pd-bar-mark"></span></div>';
            detalle +=
              '<div class="pd-stats"><span>Perdidos: <b>' +
              per +
              "</b></span>" +
              "<span>Estado: <b class=\"" +
              est +
              '">' +
              (est === "ganada" ? "Ganando" : "En riesgo") +
              "</b></span></div>";

            // Actividades de la materia
            detalle += '<div class="pd-acts">';
            (s.activities || []).forEach(function (a, idx) {
              detalle +=
                '<div class="pd-act">' +
                '<input class="pa-name" data-act="' +
                s.id +
                "|" +
                idx +
                '|nombre" value="' +
                esc(a.nombre || "") +
                '" placeholder="Actividad (ej. Parcial)" />' +
                '<input type="number" class="pa-num" data-act="' +
                s.id +
                "|" +
                idx +
                '|obt" value="' +
                (+a.obt || 0) +
                '" title="Puntos obtenidos" />' +
                '<span class="pa-sep">/</span>' +
                '<input type="number" class="pa-num" data-act="' +
                s.id +
                "|" +
                idx +
                '|total" value="' +
                (+a.total || 0) +
                '" title="Puntos que vale" />' +
                '<button class="pa-del" data-delact="' +
                s.id +
                "|" +
                idx +
                '" title="Quitar">✕</button>' +
                "</div>";
            });
            detalle +=
              '<button class="pd-addact" data-addact="' +
              s.id +
              '">+ Agregar actividad</button>';
            detalle += "</div></div>";
          });
          detalle += "</div>";

          host.innerHTML =
            resumen +
            '<div class="pts-cols">' +
            tabla +
            detalle +
            "</div>" +
            '<button class="btn accent pts-addsub" id="btnAddSubject">+ Agregar materia</button>';

          wirePuntos();
        }

        // Iconos de ojo (incluir/excluir)
        var eyeOn =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
        var eyeOff =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

        // --- conectar eventos tras cada render ---
        function wirePuntos() {
          var host = $("puntosBody");
          if (!host) return;

          // agregar materia
          var addBtn = $("btnAddSubject");
          if (addBtn) addBtn.addEventListener("click", addSubjectPuntos);

          // ojito incluir/excluir
          host.querySelectorAll("[data-eye]").forEach(function (b) {
            b.addEventListener("click", function () {
              var s = puntosData.subjects.filter(function (x) {
                return x.id === b.getAttribute("data-eye");
              })[0];
              if (s) {
                s.excluida = !s.excluida;
                savePuntos();
                renderPuntos();
              }
            });
          });
          // eliminar materia
          host.querySelectorAll("[data-delsub]").forEach(function (b) {
            b.addEventListener("click", function () {
              delSubjectPuntos(b.getAttribute("data-delsub"));
            });
          });
          // nombre de materia
          host.querySelectorAll("[data-name]").forEach(function (inp) {
            inp.addEventListener("input", function () {
              var s = puntosData.subjects.filter(function (x) {
                return x.id === inp.getAttribute("data-name");
              })[0];
              if (s) {
                s.nombre = inp.value;
                savePuntos();
                // no re-render completo para no perder el foco
                syncPuntosGeneral();
              }
            });
          });
          // créditos
          host.querySelectorAll("[data-cred]").forEach(function (inp) {
            inp.addEventListener("input", function () {
              var s = puntosData.subjects.filter(function (x) {
                return x.id === inp.getAttribute("data-cred");
              })[0];
              if (s) {
                s.creditos = +inp.value || 0;
                savePuntos();
                syncPuntosGeneral();
              }
            });
          });
          // agregar actividad
          host.querySelectorAll("[data-addact]").forEach(function (b) {
            b.addEventListener("click", function () {
              addActPuntos(b.getAttribute("data-addact"));
            });
          });
          // eliminar actividad
          host.querySelectorAll("[data-delact]").forEach(function (b) {
            b.addEventListener("click", function () {
              var parts = b.getAttribute("data-delact").split("|");
              delActPuntos(parts[0], +parts[1]);
            });
          });
          // editar campos de actividad
          host.querySelectorAll("[data-act]").forEach(function (inp) {
            inp.addEventListener("input", function () {
              var parts = inp.getAttribute("data-act").split("|");
              var s = puntosData.subjects.filter(function (x) {
                return x.id === parts[0];
              })[0];
              if (!s) return;
              var a = s.activities[+parts[1]];
              if (!a) return;
              var campo = parts[2];
              if (campo === "nombre") a.nombre = inp.value;
              else a[campo] = +inp.value || 0;
              savePuntos();
              syncPuntosScore(parts[0]);
              syncPuntosGeneral();
            });
          });
        }

        // Actualiza el ponderado en vivo sin reconstruir todo (preserva foco)
        function syncPuntosGeneral() {
          var p = pPonderado();
          var box = document.querySelector(".pts-ponderado");
          if (box) {
            var vals = box.querySelectorAll(".pp-value");
            if (vals[0]) vals[0].textContent = p.valor.toFixed(0);
            if (vals[1]) vals[1].textContent = p.sumaDef;
            if (vals[2]) vals[2].textContent = p.sumaCred;
          }
        }
        function syncPuntosScore(sid) {
          var s = puntosData.subjects.filter(function (x) {
            return x.id === sid;
          })[0];
          if (!s) return;
          var obt = pObtenidos(s), tot = pTotales(s);
          var est = pEstado(obt);
          var card = document.querySelector('[data-scorecard="' + sid + '"]');
          if (card) {
            card.textContent = obt + " / " + tot;
            card.className = "pd-score " + est;
          }
          var bar = document.querySelector('[data-barfill="' + sid + '"]');
          if (bar) {
            bar.style.width = Math.max(0, Math.min(100, (obt/500)*100)) + "%";
            bar.className = "pd-bar-fill " + est;
          }
        }