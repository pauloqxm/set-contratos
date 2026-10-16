/* Aba da ata: rascunho no navegador, login pelo SSO e gravação pela função "ata" do Supabase. */
const Ata = (() => {
  const storageKey = "set-ata-rascunho";
  const returnKey = "set-ata-voltar";
  let draft = loadDraft();
  let expired = false;
  let pessoas;

  function emptyDraft() {
    const today = new Date();
    return {
      id: null,
      titulo: `Reunião de contratos ${today.toLocaleDateString("pt-BR")}`,
      data: today.toISOString().slice(0, 10),
      responsavel_sub: "",
      responsavel_nome: "",
      participantes: "",
      duracao: "",
      itens: [],
    };
  }

  function loadDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.itens)) return { ...emptyDraft(), ...saved };
    } catch (error) {
      /* rascunho inválido volta ao vazio */
    }
    return emptyDraft();
  }

  function saveDraft() {
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }

  function note(text, isError) {
    const element = document.getElementById("ata-login-note");
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function profile() {
    return SSO.user()?.profile || {};
  }

  async function api(method, params, body) {
    const url = new URL(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.ataFunction}`);
    Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    const who = profile();
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey: CONFIG.supabaseKey,
          "x-sso-token": SSO.user().id_token,
          "x-sso-name": who.name || "",
          "x-sso-email": who.email || "",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error("Não foi possível falar com o banco. A função da ata precisa estar publicada no Supabase.");
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      expired = true;
      throw new Error("O login expirou. Clique em Salvar ata para entrar de novo; o rascunho fica guardado.");
    }
    if (!response.ok) throw new Error(data.erro || `O banco respondeu com erro ${response.status}.`);
    return data;
  }

  function relogin() {
    readMeta();
    sessionStorage.setItem(returnKey, "1");
    SSO.login();
  }

  function itemKey(row) {
    return row.nup || row.id;
  }

  function stampText(value) {
    if (value == null || value === "") return "";
    return formatDuration(value);
  }

  function toggleMenu(open) {
    const list = document.getElementById("menu-list");
    const next = open ?? list.hidden;
    list.hidden = !next;
    document.getElementById("menu-toggle").setAttribute("aria-expanded", next ? "true" : "false");
    if (next) list.querySelector(".view-tab.is-on")?.focus();
  }

  function show(view) {
    const isAta = view === "ata";
    document.getElementById("view-painel").hidden = isAta;
    document.getElementById("view-ata").hidden = !isAta;
    document.querySelectorAll(".view-tab").forEach((button) => {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      if (on) {
        button.setAttribute("aria-current", "page");
        document.getElementById("menu-current").textContent = button.querySelector("strong").textContent;
      } else {
        button.removeAttribute("aria-current");
      }
    });
    toggleMenu(false);
    if (isAta) {
      fillMeta();
      renderItems();
      loadList();
      if (!pessoas) loadPessoas();
    }
  }

  async function loadPessoas() {
    try {
      const data = await api("GET", { pessoas: "1" });
      pessoas = Array.isArray(data.pessoas) ? data.pessoas : null;
    } catch (error) {
      pessoas = null;
    }
    renderPessoas();
  }

  function renderPessoas() {
    const select = document.getElementById("ata-responsavel");
    if (!pessoas) {
      select.innerHTML = `<option value="">${pessoas === undefined ? "Carregando…" : "Lista indisponível"}</option>`;
      select.disabled = true;
      return;
    }
    const who = profile();
    if (!draft.id && !draft.responsavel_sub) {
      const me = pessoas.find((pessoa) => pessoa.sub === who.sub);
      if (me) {
        draft.responsavel_sub = me.sub;
        draft.responsavel_nome = me.nome || who.name || me.email || who.email || "";
        saveDraft();
      }
    }
    const options = pessoas.map((pessoa) => ({
      sub: pessoa.sub,
      nome: pessoa.nome || pessoa.email || (pessoa.sub === who.sub ? who.name || who.email : "") || "Conta SSO",
    }));
    if (draft.responsavel_sub && !options.some((pessoa) => pessoa.sub === draft.responsavel_sub)) {
      options.push({ sub: draft.responsavel_sub, nome: draft.responsavel_nome || "Pessoa sem acesso registrado" });
    }
    select.innerHTML = ['<option value="">Escolha o responsável</option>']
      .concat(options.map((pessoa) => `<option value="${esc(pessoa.sub)}">${esc(pessoa.nome)}</option>`))
      .join("");
    select.disabled = false;
    select.value = draft.responsavel_sub || "";
  }

  function currentDuration() {
    const elapsed = meetingElapsed();
    return elapsed == null ? draft.duracao : formatDuration(elapsed);
  }

  function fillMeta() {
    document.getElementById("ata-titulo").value = draft.titulo;
    document.getElementById("ata-data").value = draft.data;
    document.getElementById("ata-participantes").value = draft.participantes;
    document.getElementById("ata-duracao").value = currentDuration() || "Reunião não iniciada";
    renderPessoas();
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
      return false;
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
    return true;
  }

  function bringChecks() {
    let added = 0;
    state.meeting.checks.forEach((tempo, id) => {
      const row = state.rows.find((item) => item.id === id);
      if (row && addRow(row, tempo)) added += 1;
    });
    saveDraft();
    renderItems();
    return added;
  }

  function renderItems() {
    const host = document.getElementById("ata-itens");
    document.getElementById("ata-vazio").hidden = draft.itens.length > 0;
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

  async function loadList() {
    const list = document.getElementById("ata-lista");
    try {
      const data = await api("GET");
      list.innerHTML = data.atas.length
        ? data.atas
            .map((ata) => {
              const when = ata.data ? new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR") : "";
              const current = ata.id === draft.id ? " is-on" : "";
              const who = ata.responsavel_nome ? `Responsável: ${ata.responsavel_nome}` : ata.autor_nome || "";
              return `<li><button type="button" class="ata-open${current}" data-open="${esc(ata.id)}"><strong>${esc(when)}</strong> ${esc(ata.titulo)}<span>${esc(who)}</span></button></li>`;
            })
            .join("")
        : '<li class="hint">Nenhuma ata salva ainda.</li>';
    } catch (error) {
      list.innerHTML = "";
      note(error.message, true);
    }
  }

  async function openAta(id) {
    try {
      const { ata } = await api("GET", { id });
      draft = {
        id: ata.id,
        titulo: ata.titulo,
        data: ata.data,
        responsavel_sub: ata.responsavel_sub || "",
        responsavel_nome: ata.responsavel_nome || "",
        participantes: ata.participantes,
        duracao: ata.duracao,
        itens: ata.itens.map((item) => ({ ...item, key: item.nup || item.objeto })),
      };
      saveDraft();
      fillMeta();
      renderItems();
      loadList();
      note(`Ata de ${new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR")} aberta.`);
    } catch (error) {
      note(error.message, true);
    }
  }

  async function save() {
    readMeta();
    if (expired) return relogin();
    if (!draft.titulo || !draft.data) {
      note("Informe o título e a data da reunião.", true);
      return;
    }
    if (pessoas && !draft.responsavel_sub) {
      note("Escolha o responsável pela ata.", true);
      return;
    }
    const button = document.getElementById("ata-save");
    button.disabled = true;
    draft.duracao = currentDuration() || "";
    try {
      const { id } = await api("POST", null, {
        id: draft.id,
        titulo: draft.titulo,
        data: draft.data,
        responsavel_sub: draft.responsavel_sub,
        participantes: draft.participantes,
        duracao: draft.duracao,
        itens: draft.itens.map(({ nup, contrato, contratada, objeto, tempo, texto }) => ({ nup, contrato, contratada, objeto, tempo, texto })),
      });
      draft.id = id;
      saveDraft();
      note(`Ata salva às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
      loadList();
    } catch (error) {
      note(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function boot() {
    if (!(await SSO.exigirLogin())) return;
    document.getElementById("menu-toggle").addEventListener("click", () => toggleMenu());
    document.getElementById("menu-list").addEventListener("click", (event) => {
      const button = event.target.closest(".view-tab");
      if (button) show(button.dataset.view);
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".view-menu")) toggleMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || document.getElementById("menu-list").hidden) return;
      toggleMenu(false);
      document.getElementById("menu-toggle").focus();
    });

    ["ata-titulo", "ata-data", "ata-participantes"].forEach((id) => {
      document.getElementById(id).addEventListener("input", readMeta);
    });
    document.getElementById("ata-responsavel").addEventListener("change", (event) => {
      const select = event.target;
      draft.responsavel_sub = select.value;
      draft.responsavel_nome = select.value ? select.selectedOptions[0].textContent : "";
      saveDraft();
    });

    document.getElementById("ata-from-checks").addEventListener("click", () => {
      const added = bringChecks();
      if (!added && !state.meeting.checks.size) {
        const empty = document.getElementById("ata-vazio");
        empty.hidden = false;
        empty.textContent = "Nenhum contrato foi marcado como lido nesta reunião.";
      }
    });

    document.getElementById("ata-busca").addEventListener("input", (event) => suggestions(event.target.value));
    document.getElementById("ata-sugestoes").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-add]");
      if (!button) return;
      const row = state.rows.find((item) => item.id === button.dataset.add);
      if (!row) return;
      addRow(row, state.meeting.checks.get(row.id));
      saveDraft();
      renderItems();
      document.getElementById("ata-busca").value = "";
      suggestions("");
    });

    const items = document.getElementById("ata-itens");
    items.addEventListener("input", (event) => {
      const field = event.target.closest("textarea[data-texto]");
      if (!field) return;
      draft.itens[Number(field.dataset.texto)].texto = field.value;
      saveDraft();
    });
    items.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-remove]");
      if (!button) return;
      draft.itens.splice(Number(button.dataset.remove), 1);
      saveDraft();
      renderItems();
    });

    document.getElementById("ata-lista").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-open]");
      if (button) openAta(button.dataset.open);
    });

    document.getElementById("ata-new").addEventListener("click", () => {
      draft = emptyDraft();
      saveDraft();
      fillMeta();
      renderItems();
      loadList();
    });

    document.getElementById("ata-print").addEventListener("click", () => {
      readMeta();
      document.body.classList.add("printing-ata");
      window.print();
    });
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-ata"));

    document.getElementById("ata-save").addEventListener("click", save);

    if (sessionStorage.getItem(returnKey)) {
      sessionStorage.removeItem(returnKey);
      show("ata");
    } else {
      fillMeta();
      loadPessoas();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { show };
})();
