/* Aba do Comitê Executivo: pauta semanal a partir dos projetos ativos, com temporizador e ticket por projeto. */
const Comite = (() => {
  const meetingKey = "set-reuniao-comite";
  const meeting = { startedAt: null, endedAt: null, inicio: "", fim: "", timer: null, checks: new Map() };
  let projetos = [];
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
    const lidos = projetos.filter((projeto) => meeting.checks.has(projeto.id)).length;
    document.getElementById("comite-read").textContent = projetos.length
      ? `${lidos} de ${projetos.length} projetos discutidos`
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
      <td><span class="ata-kicker">${esc(item.frente || "")}</span>${esc(item.entrega || "")}</td>
      <td>${esc(item.responsavel || "—")}</td>
      <td class="comite-prazo">${esc(prazo)}${vencido ? ' <span class="badge badge-danger">Vencido</span>' : ""}</td>
      <td>${status ? `<span class="badge ${statusTom[status] || "badge-muted"}">${esc(status)}</span>` : "—"}</td>
      <td>${prioridade ? `<span class="badge ${prioridadeTom[prioridade] || "badge-muted"}">${esc(prioridade)}</span>` : "—"}</td>
      <td>${esc(item.proxima || "")}</td>
    </tr>`;
  }

  function cardHtml(projeto, dia) {
    const marcado = meeting.checks.has(projeto.id);
    const stamp = meeting.checks.get(projeto.id);
    const tempo = !marcado ? "" : stamp == null ? "discutido" : formatDuration(stamp);
    const vencidos = projeto.itens.filter((item) => item.prazo && String(item.prazo).slice(0, 10) < dia).length;
    const prazo = projeto.prazo_conclusao ? `Conclusão prevista: ${dataBR(projeto.prazo_conclusao)}` : "";
    const corpo = projeto.itens.length
      ? `<div class="comite-tabela"><table>
          <thead><tr><th>Entrega</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Prioridade</th><th>Próxima ação</th></tr></thead>
          <tbody>${projeto.itens.map((item) => itemHtml(item, dia)).join("")}</tbody>
        </table></div>`
      : '<p class="hint">Nenhum item em aberto.</p>';
    return `<article class="panel comite-card${marcado ? " is-read" : ""}" data-id="${esc(projeto.id)}">
      <header class="comite-card-head">
        <label class="read-check" title="Marcar como discutido na reunião">
          <input type="checkbox" class="js-comite-check" data-id="${esc(projeto.id)}" ${marcado ? "checked" : ""} aria-label="Marcar ${esc(projeto.nome)} como discutido" />
          <span class="read-time">${esc(tempo)}</span>
        </label>
        <div class="comite-card-title">
          <h3>${esc(projeto.nome)}</h3>
          ${projeto.descricao ? `<p class="hint">${esc(projeto.descricao)}</p>` : ""}
        </div>
        <div class="comite-resumo">
          ${prazo ? `<span class="hint">${esc(prazo)}</span>` : ""}
          <span class="badge badge-blue">${projeto.itens.length} em aberto</span>
          ${vencidos ? `<span class="badge badge-danger">${vencidos} vencido${vencidos > 1 ? "s" : ""}</span>` : ""}
        </div>
      </header>
      <div class="comite-status">${contagem(projeto.itens)}</div>
      ${corpo}
    </article>`;
  }

  function render() {
    const host = document.getElementById("comite-pauta");
    if (!host) return;
    const dia = hoje();
    host.innerHTML = projetos.length
      ? projetos.map((projeto) => cardHtml(projeto, dia)).join("")
      : carregado
        ? '<p class="hint">Nenhum projeto ativo na pauta.</p>'
        : '<p class="hint">Carregando a pauta…</p>';
    paintMeeting();
  }

  async function load(force) {
    if (carregado && !force) return projetos;
    if (carregando) return carregando;
    carregando = (async () => {
      try {
        const data = await Ata.api("GET", { pauta: "comite" });
        projetos = Array.isArray(data.projetos) ? data.projetos : [];
        carregado = true;
        const total = projetos.reduce((soma, projeto) => soma + projeto.itens.length, 0);
        document.getElementById("comite-count").textContent = `${projetos.length} projetos · ${total} itens em aberto`;
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
    document.getElementById("comite-pauta").addEventListener("change", (event) => {
      const box = event.target.closest(".js-comite-check");
      if (box) marcar(box.dataset.id, box.checked);
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
