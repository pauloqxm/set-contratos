/* Aba da ata. O rascunho fica no navegador. A gravação no Supabase espera o client_id do SSO. */
const Ata = (() => {
  const storageKey = "set-ata-rascunho";
  let draft = loadDraft();

  function loadDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.itens)) return saved;
    } catch (error) {
      /* rascunho inválido volta ao vazio */
    }
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    return {
      titulo: `Reunião de contratos ${today.toLocaleDateString("pt-BR")}`,
      data: iso,
      participantes: "",
      itens: [],
    };
  }

  function saveDraft() {
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }

  function itemKey(row) {
    return row.nup || row.id;
  }

  function stampText(value) {
    if (value == null || value === "") return "";
    return formatDuration(value);
  }

  function show(view) {
    const painel = document.getElementById("view-painel");
    const ata = document.getElementById("view-ata");
    const isAta = view === "ata";
    painel.hidden = isAta;
    ata.hidden = !isAta;
    document.querySelectorAll(".view-tab").forEach((button) => {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (isAta) {
      fillMeta();
      renderItems();
    }
  }

  function fillMeta() {
    document.getElementById("ata-titulo").value = draft.titulo;
    document.getElementById("ata-data").value = draft.data;
    document.getElementById("ata-participantes").value = draft.participantes;
    const elapsed = meetingElapsed();
    document.getElementById("ata-duracao").value = elapsed == null ? "Reunião não iniciada" : formatDuration(elapsed);
    const note = document.getElementById("ata-login-note");
    const ready = Boolean(CONFIG.ssoClientId);
    note.hidden = ready;
    document.getElementById("ata-save").disabled = !ready;
  }

  function readMeta() {
    draft.titulo = document.getElementById("ata-titulo").value.trim();
    draft.data = document.getElementById("ata-data").value;
    draft.participantes = document.getElementById("ata-participantes").value.trim();
    saveDraft();
  }

  function addRow(row, tempo) {
    const key = itemKey(row);
    const current = draft.itens.find((item) => item.key === key);
    if (current) {
      if (!current.tempo && tempo) current.tempo = stampText(tempo);
      return;
    }
    draft.itens.push({
      key,
      nup: row.nup || "",
      contrato: row.contrato || "",
      contratada: row.contratada || "",
      objeto: row.objeto || "",
      tempo: stampText(tempo),
      texto: "",
    });
  }

  function bringChecks() {
    let added = 0;
    state.meeting.checks.forEach((tempo, id) => {
      const row = state.rows.find((item) => item.id === id);
      if (!row) return;
      const before = draft.itens.length;
      addRow(row, tempo);
      if (draft.itens.length > before) added += 1;
    });
    saveDraft();
    renderItems();
    return added;
  }

  function renderItems() {
    const host = document.getElementById("ata-itens");
    const empty = document.getElementById("ata-vazio");
    empty.hidden = draft.itens.length > 0;
    host.innerHTML = draft.itens
      .map((item, index) => {
        const meta = [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
        return `<article class="ata-item">
          <header>
            <div>
              <p class="ata-kicker">${esc(meta || "Contrato")}</p>
              <h3>${esc(item.objeto)}</h3>
            </div>
            <div>
              ${item.tempo ? `<span class="ata-time">${esc(item.tempo)}</span>` : ""}
              <button type="button" class="linkish" data-remove="${index}">Tirar</button>
            </div>
          </header>
          <label class="sr-only" for="ata-texto-${index}">O que foi falado</label>
          <textarea id="ata-texto-${index}" data-texto="${index}" placeholder="O que foi falado sobre este objeto">${esc(item.texto)}</textarea>
        </article>`;
      })
      .join("");
  }

  function suggestions(query) {
    const list = document.getElementById("ata-sugestoes");
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (term.length < 2 || !state.rows.length) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    const found = state.rows
      .filter((row) => `${row.objeto} ${row.nup} ${row.contrato} ${row.contratada}`.toLocaleLowerCase("pt-BR").includes(term))
      .slice(0, 8);
    list.hidden = found.length === 0;
    list.innerHTML = found
      .map((row) => `<li><button type="button" data-add="${esc(row.id)}"><strong>${esc(row.contrato || row.nup || "Contrato")}</strong> — ${esc(row.objeto)}</button></li>`)
      .join("");
  }

  function boot() {
    document.querySelector(".view-tabs").addEventListener("click", (event) => {
      const button = event.target.closest(".view-tab");
      if (!button) return;
      show(button.dataset.view);
    });

    ["ata-titulo", "ata-data", "ata-participantes"].forEach((id) => {
      document.getElementById(id).addEventListener("input", readMeta);
    });

    document.getElementById("ata-from-checks").addEventListener("click", () => {
      const added = bringChecks();
      if (!added && !state.meeting.checks.size) {
        document.getElementById("ata-vazio").hidden = false;
        document.getElementById("ata-vazio").textContent = "Nenhum contrato foi marcado como lido nesta reunião.";
      }
    });

    document.getElementById("ata-busca").addEventListener("input", (event) => suggestions(event.target.value));
    document.getElementById("ata-sugestoes").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-add]");
      if (!button) return;
      const row = state.rows.find((item) => item.id === button.dataset.add);
      if (!row) return;
      const tempo = state.meeting.checks.get(row.id);
      addRow(row, tempo);
      saveDraft();
      renderItems();
      document.getElementById("ata-busca").value = "";
      suggestions("");
    });

    document.getElementById("ata-itens").addEventListener("input", (event) => {
      const field = event.target.closest("textarea[data-texto]");
      if (!field) return;
      draft.itens[Number(field.dataset.texto)].texto = field.value;
      saveDraft();
    });
    document.getElementById("ata-itens").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-remove]");
      if (!button) return;
      draft.itens.splice(Number(button.dataset.remove), 1);
      saveDraft();
      renderItems();
    });

    document.getElementById("ata-print").addEventListener("click", () => {
      readMeta();
      document.body.classList.add("printing-ata");
      window.print();
    });
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-ata"));

    document.getElementById("ata-save").addEventListener("click", () => {
      readMeta();
      const note = document.getElementById("ata-login-note");
      note.hidden = false;
      note.textContent = CONFIG.ssoClientId
        ? "A gravação no banco entra no próximo passo."
        : "Ainda não dá para gravar. Falta cadastrar o client_id deste painel no SSO.";
    });

    fillMeta();
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { show };
})();
