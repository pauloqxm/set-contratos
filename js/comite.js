/* Aba do Comitê Executivo: pauta semanal a partir dos projetos ativos, com temporizador e ticket por projeto. */
const Comite = (() => {
  const meetingKey = "set-reuniao-comite";
  const meeting = { startedAt: null, endedAt: null, inicio: "", fim: "", timer: null, checks: new Map() };
  let projetos = [];
  let filtro = "";
  const recolhidos = new Set();
  let carregando = null;
  let carregado = false;

  const statusTom = {
    "Em andamento": "badge-blue",
    "Aguardando terceiros": "badge-warn",
    Sobrestado: "badge-danger",
    "Não iniciado": "badge-muted",
  };
  const prioridadeTom = { "Crítica": "badge-danger", Alta: "badge-warn", "Média": "badge-blue", Baixa: "badge-muted" };

  function hoje() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dataBR(iso) {
    if (!iso || !String(iso).includes("-")) return iso || "";
    const [year, month, day] = String(iso).slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }

  function dataHora(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return dataBR(iso);
    return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function pautaPorFrente(itens) {
    const grupos = new Map();
    itens.forEach((item) => {
      const frente = String(item.frente || "").trim() || "Sem frente";
      const atual = grupos.get(frente);
      if (!atual || String(item.atualizado_em || "") > String(atual.atualizado_em || "")) grupos.set(frente, item);
    });
    return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }

  function note(text, isError) {
    const element = document.getElementById("comite-note");
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function elapsed() {
    if (!meeting.startedAt) return null;
    return (meeting.endedAt || Date.now()) - meeting.startedAt;
  }

  function saveMeeting() {
    const { startedAt, endedAt, inicio, fim } = meeting;
    if (!startedAt) {
      sessionStorage.removeItem(meetingKey);
      return;
    }
    sessionStorage.setItem(meetingKey, JSON.stringify({ startedAt, endedAt, inicio, fim, checks: [...meeting.checks] }));
  }

  function tick() {
    if (meeting.timer) window.clearInterval(meeting.timer);
    meeting.timer = window.setInterval(() => {
      document.getElementById("comite-clock").textContent = formatDuration(elapsed());
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
    saveMeeting();
    tick();
    render();
    avisarAta();
  }

  function end() {
    if (!meeting.startedAt || meeting.endedAt) return;
    meeting.endedAt = Date.now();
    meeting.fim = horaRelogio(meeting.endedAt);
    if (meeting.timer) window.clearInterval(meeting.timer);
    meeting.timer = null;
    saveMeeting();
    paintMeeting();
    avisarAta();
  }

  function paintMeeting() {
    const box = document.getElementById("comite-meeting");
    if (!box) return;
    const tempo = elapsed();
    document.getElementById("comite-clock").textContent = tempo == null ? "00:00:00" : formatDuration(tempo);
    const lista = visiveis();
    const lidos = lista.filter((projeto) => meeting.checks.has(projeto.id)).length;
    document.getElementById("comite-read").textContent = lista.length
      ? `${lidos} de ${lista.length} projetos discutidos`
      : "0 discutidos";
    const on = meeting.startedAt != null && !meeting.endedAt;
    box.classList.toggle("is-on", meeting.startedAt != null);
    const button = document.getElementById("comite-start");
    button.textContent = on ? "Em andamento" : "Iniciar reunião";
    button.disabled = on;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    document.getElementById("comite-end").hidden = !on;
  }

  function marcar(id, checked) {
    if (checked && !meeting.startedAt) start();
    if (checked) meeting.checks.set(id, elapsed());
    else meeting.checks.delete(id);
    saveMeeting();
    const card = document.querySelector(`.comite-card[data-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.toggle("is-read", checked);
      const stamp = meeting.checks.get(id);
      card.querySelector(".read-time").textContent = checked && stamp != null ? formatDuration(stamp) : checked ? "discutido" : "";
    }
    paintMeeting();
  }

  function contagem(itens) {
    const total = new Map();
    itens.forEach((item) => {
      const status = String(item.status || "").trim() || "Sem status";
      total.set(status, (total.get(status) || 0) + 1);
    });
    return [...total]
      .map(([status, n]) => `<span class="badge ${statusTom[status] || "badge-muted"}">${esc(status)}: ${n}</span>`)
      .join("");
  }

  function itemHtml(item, dia) {
    const vencido = item.prazo && String(item.prazo).slice(0, 10) < dia;
    const prazo = item.prazo ? `${dataBR(item.prazo)}${item.prazo_hora ? ` ${String(item.prazo_hora).slice(0, 5)}` : ""}` : "—";
    const status = String(item.status || "").trim();
    const prioridade = String(item.prioridade || "").trim();
    return `<tr class="${vencido ? "is-late" : ""}">
      <td>${esc(item.entrega || "")}</td>
      <td>${esc(item.responsavel || "—")}</td>
      <td class="comite-prazo">${esc(prazo)}${vencido ? ' <span class="badge badge-danger">Vencido</span>' : ""}</td>
      <td>${status ? `<span class="badge ${statusTom[status] || "badge-muted"}">${esc(status)}</span>` : "—"}</td>
      <td>${prioridade ? `<span class="badge ${prioridadeTom[prioridade] || "badge-muted"}">${esc(prioridade)}</span>` : "—"}</td>
      <td>${esc(item.proxima || "")}</td>
      <td class="comite-atualizado">${esc(dataHora(item.atualizado_em))}</td>
    </tr>`;
  }

  function cardHtml(projeto, dia) {
    const marcado = meeting.checks.has(projeto.id);
    const stamp = meeting.checks.get(projeto.id);
    const tempo = !marcado ? "" : stamp == null ? "discutido" : formatDuration(stamp);
    const vencidos = projeto.itens.filter((item) => item.prazo && String(item.prazo).slice(0, 10) < dia).length;
    const prazo = projeto.prazo_conclusao ? `Conclusão prevista: ${dataBR(projeto.prazo_conclusao)}` : "";
    const pauta = pautaPorFrente(projeto.itens);
    const corpo = pauta.length
      ? `<div class="comite-tabela"><table>
          <thead><tr><th>Entrega</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Prioridade</th><th>Próxima ação</th><th>Atualizado</th></tr></thead>
          <tbody>${pauta
            .map(([frente, item]) => `<tr class="comite-frente"><td colspan="7">${esc(frente)}</td></tr>${itemHtml(item, dia)}`)
            .join("")}</tbody>
        </table></div>`
      : '<p class="hint">Nenhum item em aberto.</p>';
    const recolhido = recolhidos.has(projeto.id);
    return `<article class="panel comite-card${marcado ? " is-read" : ""}${recolhido ? " is-collapsed" : ""}" data-id="${esc(projeto.id)}">
      <header class="comite-card-head">
        <label class="read-check" title="Marcar como discutido na reunião">
          <input type="checkbox" class="js-comite-check" data-id="${esc(projeto.id)}" ${marcado ? "checked" : ""} aria-label="Marcar ${esc(projeto.nome)} como discutido" />
          <span class="read-time">${esc(tempo)}</span>
        </label>
        <div class="comite-card-title">
          <h3>${esc(projeto.nome)}</h3>
          ${projeto.descricao ? `<p class="hint">${esc(projeto.descricao)}</p>` : ""}
          <button type="button" class="comite-toggle" data-toggle="${esc(projeto.id)}" aria-expanded="${recolhido ? "false" : "true"}">${recolhido ? "Mostrar itens" : "Recolher itens"}</button>
        </div>
        <div class="comite-resumo">
          ${prazo ? `<span class="hint">${esc(prazo)}</span>` : ""}
          <span class="badge badge-blue">${projeto.itens.length} em aberto</span>
          ${vencidos ? `<span class="badge badge-danger">${vencidos} vencido${vencidos > 1 ? "s" : ""}</span>` : ""}
        </div>
      </header>
      <div class="comite-status">${contagem(projeto.itens)}</div>
      <div class="comite-corpo">${corpo}</div>
    </article>`;
  }

  function visiveis() {
    return filtro ? projetos.filter((projeto) => projeto.id === filtro) : projetos;
  }

  function preencherFiltro() {
    const select = document.getElementById("comite-filtro");
    if (!select) return;
    const atual = filtro;
    select.innerHTML = `<option value="">Todos os projetos</option>${projetos
      .map((projeto) => `<option value="${esc(projeto.id)}">${esc(projeto.nome)}</option>`)
      .join("")}`;
    select.value = projetos.some((projeto) => projeto.id === atual) ? atual : "";
    filtro = select.value;
  }

  function pintarRecolher() {
    const button = document.getElementById("comite-recolher");
    if (!button) return;
    const lista = visiveis();
    const todos = lista.length > 0 && lista.every((projeto) => recolhidos.has(projeto.id));
    button.textContent = todos ? "Mostrar itens" : "Recolher itens";
    button.disabled = !lista.length;
  }

  function recolher(id) {
    if (recolhidos.has(id)) recolhidos.delete(id);
    else recolhidos.add(id);
    const card = document.querySelector(`.comite-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return pintarRecolher();
    const fechado = recolhidos.has(id);
    card.classList.toggle("is-collapsed", fechado);
    const button = card.querySelector(".comite-toggle");
    if (button) {
      button.textContent = fechado ? "Mostrar itens" : "Recolher itens";
      button.setAttribute("aria-expanded", fechado ? "false" : "true");
    }
    pintarRecolher();
  }

  function recolherTodos() {
    const lista = visiveis();
    const todos = lista.length > 0 && lista.every((projeto) => recolhidos.has(projeto.id));
    lista.forEach((projeto) => {
      if (todos) recolhidos.delete(projeto.id);
      else recolhidos.add(projeto.id);
    });
    render();
  }

  function render() {
    const host = document.getElementById("comite-pauta");
    if (!host) return;
    const dia = hoje();
    const lista = visiveis();
    host.innerHTML = lista.length
      ? lista.map((projeto) => cardHtml(projeto, dia)).join("")
      : carregado
        ? `<p class="hint">${projetos.length ? "Nenhum projeto corresponde ao filtro." : "Nenhum projeto ativo na pauta."}</p>`
        : '<p class="hint">Carregando a pauta…</p>';
    const total = lista.reduce((soma, projeto) => soma + projeto.itens.length, 0);
    document.getElementById("comite-count").textContent = lista.length
      ? `${lista.length} projeto${lista.length > 1 ? "s" : ""} · ${total} itens em aberto`
      : carregado ? "" : "Carregando a pauta…";
    paintMeeting();
    pintarRecolher();
  }

  async function load(force) {
    if (carregado && !force) return projetos;
    if (carregando) return carregando;
    carregando = (async () => {
      try {
        const data = await Ata.api("GET", { pauta: "comite" });
        projetos = Array.isArray(data.projetos) ? data.projetos : [];
        carregado = true;
        preencherFiltro();
        note("");
      } catch (error) {
        note(error.message, true);
      } finally {
        carregando = null;
        render();
      }
      return projetos;
    })();
    return carregando;
  }

  function show() {
    render();
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    restoreMeeting();
    document.getElementById("comite-start").addEventListener("click", start);
    document.getElementById("comite-end").addEventListener("click", end);
    document.getElementById("comite-refresh").addEventListener("click", () => load(true));
    document.getElementById("comite-filtro").addEventListener("change", (event) => {
      filtro = event.target.value;
      render();
    });
    document.getElementById("comite-recolher").addEventListener("click", recolherTodos);
    document.getElementById("comite-pauta").addEventListener("change", (event) => {
      const box = event.target.closest(".js-comite-check");
      if (box) marcar(box.dataset.id, box.checked);
    });
    document.getElementById("comite-pauta").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-toggle]");
      if (button) recolher(button.dataset.toggle);
    });
    paintMeeting();
  });

  return {
    show,
    load,
    meeting: () => meeting,
    elapsed,
    projetos: () => projetos,
  };
})();
