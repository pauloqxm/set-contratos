/* Aba Reunião Diversa: pauta montada na hora, com o mesmo temporizador das outras atas. */
const Diversa = (() => {
  const meetingKey = "set-reuniao-diversa";
  const extrasKey = "set-pauta-diversa";
  const tituloKey = "set-titulo-diversa";
  const meeting = { startedAt: null, endedAt: null, inicio: "", fim: "", timer: null, checks: new Map(), currentId: null, currentStartedAt: null };
  let extras = loadExtras();

  function loadExtras() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(extrasKey) || "[]");
      if (Array.isArray(saved)) {
        return saved
          .filter((item) => item && item.id && item.nome)
          .map((item) => ({ id: String(item.id), nome: String(item.nome), descricao: String(item.descricao || ""), avulso: true, itens: [] }));
      }
    } catch (error) {
      /* rascunho inválido volta vazio */
    }
    return [];
  }

  function saveExtras() {
    sessionStorage.setItem(extrasKey, JSON.stringify(extras.map(({ id, nome, descricao }) => ({ id, nome, descricao }))));
  }

  function tituloSalvo() {
    return String(sessionStorage.getItem(tituloKey) || "").replace(/\s+/g, " ").trim();
  }

  function elapsed() {
    if (!meeting.startedAt) return null;
    return (meeting.endedAt || Date.now()) - meeting.startedAt;
  }

  function saveMeeting() {
    const { startedAt, endedAt, inicio, fim, currentId, currentStartedAt, checks } = meeting;
    if (!startedAt) {
      sessionStorage.removeItem(meetingKey);
      return;
    }
    sessionStorage.setItem(meetingKey, JSON.stringify({
      startedAt,
      endedAt,
      inicio,
      fim,
      currentId,
      currentStartedAt,
      checks: [...checks],
    }));
  }

  function tick() {
    if (meeting.timer) window.clearInterval(meeting.timer);
    meeting.timer = window.setInterval(() => {
      document.getElementById("diversa-clock").textContent = formatDuration(elapsed());
    }, 250);
  }

  function restoreMeeting() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(meetingKey) || "null");
      if (!saved || !saved.startedAt || saved.endedAt) {
        sessionStorage.removeItem(meetingKey);
        return;
      }
      meeting.startedAt = saved.startedAt;
      meeting.inicio = saved.inicio || horaRelogio(saved.startedAt);
      meeting.currentId = saved.currentId || null;
      meeting.currentStartedAt = saved.currentStartedAt || null;
      meeting.checks = new Map(Array.isArray(saved.checks) ? saved.checks : []);
      tick();
    } catch (error) {
      sessionStorage.removeItem(meetingKey);
    }
  }

  function avisarAta() {
    if (typeof Ata !== "undefined" && Ata.atualizarHorarios) Ata.atualizarHorarios();
  }

  function start() {
    if (meeting.startedAt && !meeting.endedAt) return;
    if (meeting.endedAt) meeting.checks = new Map();
    const now = Date.now();
    meeting.startedAt = now;
    meeting.endedAt = null;
    meeting.inicio = horaRelogio(now);
    meeting.fim = "";
    meeting.currentId = null;
    meeting.currentStartedAt = null;
    saveMeeting();
    tick();
    render();
    avisarAta();
  }

  function fecharPonto(now = Date.now()) {
    if (meeting.currentId && meeting.currentStartedAt) {
      meeting.checks.set(meeting.currentId, Math.max(0, now - meeting.currentStartedAt));
    }
    meeting.currentId = null;
    meeting.currentStartedAt = null;
  }

  function abrirPonto(id) {
    const now = Date.now();
    if (meeting.currentId === id) return;
    fecharPonto(now);
    meeting.currentId = id;
    meeting.currentStartedAt = now;
    meeting.checks.set(id, null);
  }

  function pontoRotulo(id) {
    if (!meeting.checks.has(id)) return "";
    if (meeting.currentId === id) return "em discussão";
    const stamp = meeting.checks.get(id);
    return stamp == null ? "em discussão" : formatDuration(stamp);
  }

  function end() {
    if (!meeting.startedAt || meeting.endedAt) return;
    const now = Date.now();
    fecharPonto(now);
    meeting.endedAt = now;
    meeting.fim = horaRelogio(now);
    if (meeting.timer) window.clearInterval(meeting.timer);
    meeting.timer = null;
    saveMeeting();
    paintPontos();
    paintMeeting();
    avisarAta();
  }

  function paintMeeting() {
    const box = document.getElementById("diversa-meeting");
    if (!box) return;
    const tempo = elapsed();
    document.getElementById("diversa-clock").textContent = tempo == null ? "00:00:00" : formatDuration(tempo);
    document.getElementById("diversa-read").textContent = extras.length
      ? `${extras.filter((ponto) => meeting.checks.has(ponto.id)).length} de ${extras.length} pontos discutidos`
      : "0 discutidos";
    const on = meeting.startedAt != null && !meeting.endedAt;
    box.classList.toggle("is-on", meeting.startedAt != null);
    const button = document.getElementById("diversa-start");
    button.textContent = on ? "Em andamento" : "Iniciar reunião";
    button.disabled = on;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    document.getElementById("diversa-end").hidden = !on;
  }

  function paintPontos() {
    document.querySelectorAll("#diversa-pauta .comite-card[data-id]").forEach((card) => {
      const id = card.dataset.id;
      const marked = meeting.checks.has(id);
      card.classList.toggle("is-read", marked);
      card.classList.toggle("is-discussing", meeting.currentId === id);
      const time = card.querySelector(".read-time");
      if (time) time.textContent = pontoRotulo(id);
      const box = card.querySelector(".js-diversa-check");
      if (box) box.checked = marked;
    });
  }

  function marcar(id, checked) {
    if (checked && !meeting.startedAt) start();
    if (checked) abrirPonto(id);
    else {
      if (meeting.currentId === id) {
        meeting.currentId = null;
        meeting.currentStartedAt = null;
      }
      meeting.checks.delete(id);
    }
    saveMeeting();
    paintPontos();
    paintMeeting();
  }

  function cardHtml(ponto) {
    const marcado = meeting.checks.has(ponto.id);
    const discutindo = meeting.currentId === ponto.id;
    const corpo = ponto.descricao
      ? `<p class="comite-avulso-texto">${esc(ponto.descricao)}</p>`
      : '<p class="hint">Ponto desta reunião. Entra na ata depois de discutido.</p>';
    return `<article class="panel comite-card is-avulso${marcado ? " is-read" : ""}${discutindo ? " is-discussing" : ""}" data-id="${esc(ponto.id)}">
      <header class="comite-card-head">
        <div class="comite-lead">
          <label class="read-check" title="Iniciar discussão deste ponto">
            <input type="checkbox" class="js-diversa-check" data-id="${esc(ponto.id)}" ${marcado ? "checked" : ""} aria-label="Iniciar discussão de ${esc(ponto.nome)}" />
            <span class="read-time">${esc(pontoRotulo(ponto.id))}</span>
          </label>
        </div>
        <div class="comite-card-title">
          <h3>${esc(ponto.nome)}</h3>
          <p class="hint">Ponto adicionado nesta reunião</p>
        </div>
        <div class="comite-resumo">
          <span class="badge badge-orange">Pauta</span>
          <button type="button" class="linkish" data-remove-ponto="${esc(ponto.id)}">Tirar</button>
        </div>
      </header>
      <div class="comite-corpo">${corpo}</div>
    </article>`;
  }

  function render() {
    const host = document.getElementById("diversa-pauta");
    if (!host) return;
    host.innerHTML = extras.length
      ? extras.map(cardHtml).join("")
      : '<p class="hint">Nenhum ponto na pauta. Use + para adicionar o título de cada tema.</p>';
    document.getElementById("diversa-count").textContent = extras.length
      ? `${extras.length} ponto${extras.length > 1 ? "s" : ""} na pauta`
      : "";
    paintMeeting();
  }

  function erroPonto(texto) {
    const erro = document.getElementById("diversa-ponto-erro");
    erro.hidden = !texto;
    erro.textContent = texto || "";
  }

  function abrirDialogo() {
    erroPonto("");
    document.getElementById("diversa-ponto-titulo").value = "";
    document.getElementById("diversa-ponto-desc").value = "";
    document.getElementById("diversa-ponto-dialog").showModal();
    document.getElementById("diversa-ponto-titulo").focus();
  }

  function fecharDialogo() {
    const dialogo = document.getElementById("diversa-ponto-dialog");
    if (dialogo.open) dialogo.close();
    erroPonto("");
  }

  function adicionarPonto(event) {
    event.preventDefault();
    const nome = document.getElementById("diversa-ponto-titulo").value.replace(/\s+/g, " ").trim();
    const descricao = document.getElementById("diversa-ponto-desc").value.replace(/\s+/g, " ").trim();
    if (!nome) {
      erroPonto("Informe o título do ponto de pauta.");
      return;
    }
    extras.push({ id: `avulso-${Date.now()}`, nome, descricao, avulso: true, itens: [] });
    saveExtras();
    fecharDialogo();
    render();
  }

  function removerPonto(id) {
    extras = extras.filter((item) => item.id !== id);
    if (meeting.currentId === id) {
      meeting.currentId = null;
      meeting.currentStartedAt = null;
    }
    meeting.checks.delete(id);
    saveExtras();
    saveMeeting();
    render();
  }

  function gravarTitulo() {
    const campo = document.getElementById("diversa-titulo");
    const titulo = campo.value.replace(/\s+/g, " ").trim();
    sessionStorage.setItem(tituloKey, titulo);
    if (typeof Ata !== "undefined" && Ata.definirTitulo) Ata.definirTitulo(titulo);
  }

  function show() {
    const campo = document.getElementById("diversa-titulo");
    if (campo && !campo.value) campo.value = tituloSalvo();
    if (typeof Ata !== "undefined" && Ata.prepararTipo) Ata.prepararTipo("diversa");
    gravarTitulo();
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    restoreMeeting();
    const campo = document.getElementById("diversa-titulo");
    if (campo) campo.value = tituloSalvo();
    document.getElementById("diversa-start").addEventListener("click", start);
    document.getElementById("diversa-end").addEventListener("click", end);
    document.getElementById("diversa-add").addEventListener("click", abrirDialogo);
    document.getElementById("diversa-titulo").addEventListener("input", gravarTitulo);
    document.getElementById("diversa-ponto-form").addEventListener("submit", adicionarPonto);
    document.getElementById("diversa-ponto-cancel").addEventListener("click", fecharDialogo);
    document.getElementById("diversa-ponto-close").addEventListener("click", fecharDialogo);
    const dialogo = document.getElementById("diversa-ponto-dialog");
    dialogo.addEventListener("click", (event) => {
      if (event.target === dialogo) fecharDialogo();
    });
    document.getElementById("diversa-pauta").addEventListener("change", (event) => {
      const box = event.target.closest(".js-diversa-check");
      if (box) marcar(box.dataset.id, box.checked);
    });
    document.getElementById("diversa-pauta").addEventListener("click", (event) => {
      const tirar = event.target.closest("button[data-remove-ponto]");
      if (tirar) removerPonto(tirar.dataset.removePonto);
    });
    paintMeeting();
  });

  return {
    show,
    meeting: () => meeting,
    elapsed,
    projetos: () => extras,
    titulo: tituloSalvo,
  };
})();
