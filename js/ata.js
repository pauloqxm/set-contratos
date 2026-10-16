/* Aba da ata: rascunho no navegador, login pelo SSO e gravação pela função "ata" do Supabase. */
const Ata = (() => {
  const storageKey = "set-ata-rascunho";
  const returnKey = "set-ata-voltar";
  let draft = loadDraft();
  let expired = false;

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function emptyDraft() {
    const today = new Date();
    return {
      id: null,
      titulo: `Reunião de contratos ${today.toLocaleDateString("pt-BR")}`,
      data: localISO(today),
      responsavel_nome: "",
      participantes: null,
      duracao: "",
      itens: [],
    };
  }

  function loadDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.itens)) {
        const draft = { ...emptyDraft(), ...saved };
        const local = localISO();
        const utc = new Date().toISOString().slice(0, 10);
        if (!draft.id && draft.data === utc && utc !== local) draft.data = local;
        return draft;
      }
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
    const raw = SSO.user()?.profile || {};
    return {
      sub: raw.sub || "",
      name: SSO.displayName(),
      email: (raw.email || "").trim(),
    };
  }

  async function api(method, params, body, retried) {
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
          "x-sso-name": who.name,
          "x-sso-email": who.email,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error("Não foi possível falar com o banco. A função da ata precisa estar publicada no Supabase.");
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      if (!retried && (await SSO.renovar())) return api(method, params, body, true);
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
    document.getElementById("view-painel").hidden = view !== "painel";
    document.getElementById("view-ata").hidden = view !== "ata";
    document.getElementById("view-frequencia").hidden = view !== "frequencia";
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
    if (view === "ata") {
      fillMeta();
      renderItems();
      loadList();
    }
    if (view === "frequencia") Frequencia.show();
  }

  function nomesSalvos() {
    return String(draft.participantes || "")
      .split(",")
      .map((nome) => nome.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function chaveNome(nome) {
    return nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("pt-BR");
  }

  function dataBR(iso) {
    if (!iso || !iso.includes("-")) return iso || "";
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  async function renderParticipantes(refreshed) {
    const host = document.getElementById("ata-participantes-lista");
    const nota = document.getElementById("ata-participantes-nota");
    let people = Frequencia.presentes(draft.data);
    if (people === null) {
      host.innerHTML = "";
      nota.textContent = Frequencia.erro() || "Carregando a lista de presença…";
      if (!Frequencia.erro()) {
        try {
          await Frequencia.load();
        } catch (err) {
          /* a nota mostra o erro na próxima passagem */
        }
        people = Frequencia.presentes(draft.data);
      }
    }
    if (!people) {
      nota.textContent = Frequencia.erro() || "Não foi possível ler a lista de presença.";
      document.getElementById("ata-presenca-recente").hidden = true;
      return;
    }
    if (!people.length && !refreshed && !Frequencia.erro()) {
      try {
        await Frequencia.load(true);
      } catch (err) {
        /* a nota mostra o resultado abaixo */
      }
      return renderParticipantes(true);
    }
    if (!draft.id && draft.participantes == null && people.length) {
      draft.participantes = people.map((pessoa) => pessoa.nome).join(", ");
      saveDraft();
    }
    const salvos = nomesSalvos();
    const chaves = new Set(people.map((pessoa) => chaveNome(pessoa.nome)));
    const extras = salvos.filter((nome) => !chaves.has(chaveNome(nome)));
    const marcados = new Set(salvos.map(chaveNome));
    const opcoes = people.map((pessoa) => pessoa.nome).concat(extras);
    const recente = document.getElementById("ata-presenca-recente");
    if (!opcoes.length) {
      host.innerHTML = "";
      const ultima = Frequencia.ultimaData();
      recente.hidden = !ultima || ultima === draft.data;
      recente.textContent = ultima ? `Usar a presença de ${dataBR(ultima)}` : "Usar a presença mais recente";
      nota.textContent = ultima && ultima !== draft.data
        ? `Nenhuma presença em ${dataBR(draft.data)}. A mais recente na planilha é ${dataBR(ultima)}.`
        : "Nenhuma presença registrada nesta data.";
      return;
    }
    recente.hidden = true;
    nota.textContent = "Quem confirmou presença na data da ata. Desmarque quem não entra na ata.";
    host.innerHTML = opcoes
      .map((nome) => {
        const on = marcados.has(chaveNome(nome)) ? " checked" : "";
        return `<label class="freq-check"><input type="checkbox" value="${esc(nome)}"${on} /> ${esc(nome)}</label>`;
      })
      .join("");
  }

  function readParticipantes() {
    const boxes = [...document.querySelectorAll("#ata-participantes-lista input[type=checkbox]")];
    if (!boxes.length) return;
    draft.participantes = boxes
      .filter((box) => box.checked)
      .map((box) => box.value)
      .join(", ");
  }

  function currentDuration() {
    const elapsed = meetingElapsed();
    return elapsed == null ? draft.duracao : formatDuration(elapsed);
  }

  function fillMeta() {
    if (!draft.id && !draft.responsavel_nome) {
      draft.responsavel_nome = SSO.displayName() || "";
      saveDraft();
    }
    document.getElementById("ata-titulo").value = draft.titulo;
    document.getElementById("ata-data").value = draft.data;
    document.getElementById("ata-responsavel").value = draft.responsavel_nome;
    document.getElementById("ata-duracao").value = currentDuration() || "Reunião não iniciada";
    renderParticipantes();
  }

  function readMeta() {
    draft.titulo = document.getElementById("ata-titulo").value.trim();
    draft.data = document.getElementById("ata-data").value;
    draft.responsavel_nome = document.getElementById("ata-responsavel").value.trim();
    readParticipantes();
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
    if (!draft.responsavel_nome) {
      note("Informe o responsável pela ata.", true);
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
        responsavel_nome: draft.responsavel_nome,
        participantes: draft.participantes || "",
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

  function xml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function paragrafo(texto, negrito) {
    const marca = negrito ? "<w:b/>" : "";
    return `<w:p><w:r><w:rPr>${marca}<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${xml(texto)}</w:t></w:r></w:p>`;
  }

  async function baixarDocx() {
    readMeta();
    if (typeof JSZip === "undefined") {
      note("Não foi possível gerar o arquivo Word.", true);
      return;
    }
    const blocos = [
      paragrafo("Ata da reunião", true),
      paragrafo(draft.titulo || "Reunião de contratos"),
      paragrafo(`Data: ${dataBR(draft.data)}`),
      paragrafo(`Responsável: ${draft.responsavel_nome || "—"}`),
      paragrafo(`Duração: ${currentDuration() || draft.duracao || "—"}`),
      paragrafo(`Participantes: ${nomesSalvos().join(", ") || "—"}`),
      paragrafo(""),
    ];
    draft.itens.forEach((item, index) => {
      const meta = [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
      blocos.push(paragrafo(`${index + 1}. ${item.objeto || "Contrato"}`, true));
      if (meta) blocos.push(paragrafo(meta));
      if (item.tempo) blocos.push(paragrafo(`Tempo: ${item.tempo}`));
      String(item.texto || "Sem registro.")
        .split(/\n/)
        .forEach((linha) => blocos.push(paragrafo(linha)));
      blocos.push(paragrafo(""));
    });
    if (!draft.itens.length) blocos.push(paragrafo("Nenhum objeto nesta ata."));
    const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${blocos.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.folder("word").file("document.xml", documento);
    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const link = document.createElement("a");
    const nome = `ata-${draft.data || "reuniao"}.docx`;
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    link.click();
    URL.revokeObjectURL(link.href);
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

    ["ata-titulo", "ata-responsavel"].forEach((id) => {
      document.getElementById(id).addEventListener("input", readMeta);
    });
    document.getElementById("ata-data").addEventListener("change", async () => {
      draft.titulo = document.getElementById("ata-titulo").value.trim();
      draft.data = document.getElementById("ata-data").value;
      draft.responsavel_nome = document.getElementById("ata-responsavel").value.trim();
      try {
        await Frequencia.load();
      } catch (err) {
        /* renderParticipantes mostra o erro */
      }
      const people = Frequencia.presentes(draft.data) || [];
      draft.participantes = people.map((pessoa) => pessoa.nome).join(", ");
      saveDraft();
      renderParticipantes();
    });
    document.getElementById("ata-participantes-lista").addEventListener("change", readMeta);
    document.getElementById("ata-presenca-recente").addEventListener("click", () => {
      const data = Frequencia.ultimaData();
      if (!data) return;
      const input = document.getElementById("ata-data");
      input.value = data;
      input.dispatchEvent(new Event("change"));
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
    document.getElementById("ata-docx").addEventListener("click", baixarDocx);
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-ata"));

    document.getElementById("ata-save").addEventListener("click", save);

    const vista = sessionStorage.getItem("set-vista");
    sessionStorage.removeItem("set-vista");
    if (sessionStorage.getItem(returnKey) || vista === "ata") {
      sessionStorage.removeItem(returnKey);
      show("ata");
    } else if (vista === "frequencia") {
      show("frequencia");
    } else {
      fillMeta();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { show };
})();
