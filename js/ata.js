/* Aba da ata: rascunho no navegador, login pelo SSO e gravação pela função "ata" do Supabase. */
const Ata = (() => {
  const storageKey = "set-ata-rascunho";
  const returnKey = "set-ata-voltar";
  const tokenKey = "set-ata-token";
  let draft = loadDraft();
  let expired = false;
  let editando = !draft.id;
  let pedindoToken = false;
  let pendenteExcluir = null;

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function comite(tipo = draft?.tipo) {
    return tipo === "comite";
  }

  function tituloPadrao(tipo) {
    const hoje = new Date().toLocaleDateString("pt-BR");
    return comite(tipo) ? `Reunião do Comitê Executivo ${hoje}` : `Reunião de contratos ${hoje}`;
  }

  function emptyDraft(tipo = "contratos") {
    const today = new Date();
    return {
      id: null,
      tipo: comite(tipo) ? "comite" : "contratos",
      titulo: tituloPadrao(tipo),
      data: localISO(today),
      responsavel_nome: "",
      participantes: null,
      duracao: "",
      inicio: "",
      fim: "",
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
          ...(sessionStorage.getItem(tokenKey) ? { "x-ata-token": sessionStorage.getItem(tokenKey) } : {}),
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
      throw new Error(data.erro || "O acesso à ata foi recusado. Saia e entre de novo.");
    }
    if (response.status === 403) {
      sessionStorage.removeItem(tokenKey);
      aplicarTrava();
      throw new Error(data.erro || "O token de edição não confere.");
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

  function nomeAta() {
    const data = (dataBR(draft.data) || "").replaceAll("/", "-") || "sem-data";
    return comite() ? `Ata da Reunião do Comitê ${data}` : `Ata da Reunião de Contratos ${data}`;
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
    document.getElementById("view-comite").hidden = view !== "comite";
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
    if (view !== "ata") esquecerToken();
    if (view === "ata") {
      aplicarTipo();
      fillMeta();
      renderItems();
      loadList();
    }
    if (view === "comite") Comite.show();
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
      aplicarTrava();
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
      aplicarTrava();
      return;
    }
    recente.hidden = true;
    nota.textContent = "Quem confirmou presença na data da ata. Desmarque quem não entra na ata.";
    host.innerHTML = opcoes
      .map((nome) => {
        const on = marcados.has(chaveNome(nome)) ? " checked" : "";
        return `<label class="freq-check"><input type="checkbox" value="${esc(nome)}"${on} /> ${esc(nome)}<span class="freq-virgula" aria-hidden="true">,</span></label>`;
      })
      .join("");
    aplicarTrava();
  }

  function temToken() {
    return Boolean(sessionStorage.getItem(tokenKey));
  }

  function travada() {
    return Boolean(draft.id) && !editando;
  }

  function erroToken(texto) {
    const erro = document.getElementById("ata-token-erro");
    if (!erro) return;
    erro.hidden = !texto;
    erro.textContent = texto || "";
  }

  function fecharToken() {
    pedindoToken = false;
    pendenteExcluir = null;
    const dialog = document.getElementById("ata-token-dialog");
    if (dialog?.open) dialog.close();
    erroToken("");
  }

  function esquecerToken() {
    sessionStorage.removeItem(tokenKey);
    editando = false;
    fecharToken();
  }

  function aplicarTrava() {
    const salva = Boolean(draft.id);
    const trava = travada();
    document.getElementById("ata-edit").hidden = !trava;
    document.getElementById("ata-delete").hidden = !salva;
    document.getElementById("ata-save").hidden = trava;
    document.getElementById("ata-save").disabled = false;
    if (!pedindoToken) fecharToken();
    ["ata-titulo", "ata-data", "ata-responsavel", "ata-from-checks", "ata-busca"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.disabled = trava;
    });
    document.getElementById("ata-tipo").disabled = salva;
    document.querySelectorAll("#ata-participantes-lista input, #ata-itens textarea, #ata-itens button, #ata-presenca-recente").forEach((field) => {
      field.disabled = trava;
    });
  }

  function pedirToken(excluirId) {
    pendenteExcluir = excluirId || null;
    pedindoToken = true;
    document.getElementById("ata-editor-nota").textContent = pendenteExcluir
      ? "Informe o token para excluir a ata."
      : "Informe o token para editar a ata.";
    erroToken("");
    const campo = document.getElementById("ata-token");
    campo.value = "";
    const dialog = document.getElementById("ata-token-dialog");
    if (!dialog.open) dialog.showModal();
    campo.focus();
  }

  function readParticipantes() {
    const boxes = [...document.querySelectorAll("#ata-participantes-lista input[type=checkbox]")];
    if (!boxes.length) return;
    draft.participantes = boxes
      .filter((box) => box.checked)
      .map((box) => box.value)
      .join(", ");
  }

  function reuniao() {
    if (comite()) {
      const m = Comite.meeting();
      return { startedAt: m.startedAt, inicio: m.inicio, fim: m.fim, elapsed: Comite.elapsed() };
    }
    return { startedAt: state.meeting.startedAt, inicio: state.meeting.inicio, fim: state.meeting.fim, elapsed: meetingElapsed() };
  }

  function reuniaoViva() {
    return !draft.id || draft.data === localISO();
  }

  function horariosAtuais() {
    const atual = reuniao();
    if (atual.inicio && reuniaoViva()) return { inicio: atual.inicio, fim: atual.fim || "" };
    return { inicio: draft.inicio || "", fim: draft.fim || "" };
  }

  function fillHorarios() {
    const horas = horariosAtuais();
    document.getElementById("ata-inicio").value = horas.inicio || "—";
    document.getElementById("ata-fim").value = horas.fim || "—";
    if (reuniao().inicio && reuniaoViva()) {
      draft.inicio = horas.inicio;
      draft.fim = horas.fim;
      saveDraft();
    }
    return horas;
  }

  function currentDuration() {
    const atual = reuniao();
    if (!atual.startedAt || !reuniaoViva()) return draft.duracao;
    return atual.elapsed == null ? draft.duracao : formatDuration(atual.elapsed);
  }

  function aplicarTipo() {
    const ehComite = comite();
    document.getElementById("ata-tipo").value = ehComite ? "comite" : "contratos";
    document.getElementById("ata-heading").textContent = ehComite ? "Ata do Comitê Executivo" : "Ata da reunião de contratos";
    document.getElementById("ata-subtitulo").textContent = ehComite
      ? "Descreva o que foi falado sobre cada projeto. O rascunho fica neste navegador até ser salvo."
      : "Descreva o que foi falado sobre cada objeto. O rascunho fica neste navegador até ser salvo.";
    document.getElementById("ata-from-checks").textContent = ehComite ? "Trazer projetos discutidos" : "Trazer contratos lidos";
    document.getElementById("ata-busca-rotulo").textContent = ehComite ? "Incluir projeto" : "Incluir contrato";
    document.getElementById("ata-busca").placeholder = ehComite ? "Nome do projeto" : "Objeto, NUP, contrato ou contratada";
    document.getElementById("ata-vazio").textContent = ehComite
      ? "Nenhum projeto na ata. Traga os projetos discutidos ou busque um projeto."
      : "Nenhum objeto na ata. Traga os contratos marcados como lidos ou busque um contrato.";
  }

  async function trocarTipo(tipo) {
    if (draft.id) return;
    readMeta();
    const anterior = draft.tipo;
    draft.tipo = comite(tipo) ? "comite" : "contratos";
    if (!draft.titulo || draft.titulo === tituloPadrao(anterior)) draft.titulo = tituloPadrao(draft.tipo);
    draft.itens = [];
    draft.inicio = "";
    draft.fim = "";
    draft.duracao = "";
    saveDraft();
    aplicarTipo();
    fillMeta();
    renderItems();
    loadList();
    if (comite()) Comite.load();
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
    fillHorarios();
    renderParticipantes();
    aplicarTrava();
  }

  function readMeta() {
    draft.titulo = document.getElementById("ata-titulo").value.trim();
    draft.data = document.getElementById("ata-data").value;
    draft.responsavel_nome = document.getElementById("ata-responsavel").value.trim();
    readParticipantes();
    saveDraft();
  }

  function addRow(row) {
    const key = itemKey(row);
    if (draft.itens.find((item) => item.key === key)) return false;
    draft.itens.push({
      key,
      nup: row.nup || "",
      contrato: row.contrato || "",
      contratada: row.contratada || "",
      objeto: row.objeto || "",
      tempo: "",
      texto: "",
    });
    return true;
  }

  function addProjeto(projeto) {
    const key = `p:${projeto.id}`;
    if (draft.itens.find((item) => item.key === key)) return false;
    draft.itens.push({ key, ref: projeto.id, nup: "", contrato: "", contratada: "", objeto: projeto.nome || projeto.id, tempo: "", texto: "" });
    return true;
  }

  function marcados() {
    return comite() ? Comite.meeting().checks : state.meeting.checks;
  }

  function reuniaoAtual() {
    return comite() ? Comite.meeting() : state.meeting;
  }

  function idDoItem(item) {
    if (item.ref) return item.ref;
    const row = state.rows.find((linha) => linha.id === item.key || linha.nup === item.key || itemKey(linha) === item.key);
    return row?.id || item.key;
  }

  function tempoDoPonto(id) {
    const atual = reuniaoAtual();
    if (atual.currentId === id && atual.currentStartedAt) return Math.max(0, Date.now() - atual.currentStartedAt);
    const stamp = atual.checks.get(id);
    return typeof stamp === "number" ? stamp : null;
  }

  function aplicarTempos() {
    draft.itens.forEach((item) => {
      if (item.tempo) return;
      const ms = tempoDoPonto(idDoItem(item));
      if (ms != null) item.tempo = stampText(ms);
    });
  }

  function bringChecks() {
    let added = 0;
    if (comite()) {
      Comite.meeting().checks.forEach((_tempo, id) => {
        const projeto = Comite.projetos().find((item) => item.id === id);
        if (projeto && addProjeto(projeto)) added += 1;
      });
    } else {
      state.meeting.checks.forEach((_tempo, id) => {
        const row = state.rows.find((item) => item.id === id);
        if (row && addRow(row)) added += 1;
      });
    }
    saveDraft();
    renderItems();
    return added;
  }

  function renderItems() {
    const host = document.getElementById("ata-itens");
    document.getElementById("ata-vazio").hidden = draft.itens.length > 0;
    host.innerHTML = draft.itens
      .map((item, index) => {
        const meta = item.ref ? "Projeto" : [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
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
          <textarea id="ata-texto-${index}" data-texto="${index}" placeholder="O que foi falado sobre este ${item.ref ? "projeto" : "objeto"}">${esc(item.texto)}</textarea>
          <div class="ata-texto-print">${esc(item.texto)}</div>
        </article>`;
      })
      .join("");
    aplicarTrava();
  }

  function suggestions(query) {
    const list = document.getElementById("ata-sugestoes");
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (comite()) {
      const projetos = Comite.projetos();
      if (term.length >= 2 && !projetos.length) {
        Comite.load().then(() => {
          if (document.getElementById("ata-busca").value.trim().toLocaleLowerCase("pt-BR") === term && Comite.projetos().length) suggestions(query);
        });
      }
      const achados = term.length < 2
        ? []
        : projetos.filter((projeto) => `${projeto.nome} ${projeto.id}`.toLocaleLowerCase("pt-BR").includes(term)).slice(0, 8);
      list.hidden = achados.length === 0;
      list.innerHTML = achados
        .map((projeto) => `<li><button type="button" data-add-projeto="${esc(projeto.id)}"><strong>${esc(projeto.nome)}</strong> — ${projeto.itens.length} itens em aberto</button></li>`)
        .join("");
      return;
    }
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
      const data = await api("GET", { tipo: draft.tipo });
      list.innerHTML = data.atas.length
        ? data.atas
            .map((ata) => {
              const when = ata.data ? new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR") : "";
              const current = ata.id === draft.id ? " is-on" : "";
              const who = ata.responsavel_nome ? `Responsável: ${ata.responsavel_nome}` : ata.autor_nome || "";
              return `<li class="ata-salva-item"><button type="button" class="ata-open${current}" data-open="${esc(ata.id)}"><strong>${esc(when)}</strong> ${esc(ata.titulo)}<span>${esc(who)}</span></button><button type="button" class="btn-danger btn-small" data-delete="${esc(ata.id)}">Excluir</button></li>`;
            })
            .join("")
        : `<li class="hint">Nenhuma ata ${comite() ? "do Comitê Executivo" : "de contratos"} salva ainda.</li>`;
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
        tipo: ata.tipo === "comite" ? "comite" : "contratos",
        titulo: ata.titulo,
        data: ata.data,
        responsavel_nome: ata.responsavel_nome || "",
        participantes: ata.participantes,
        duracao: ata.duracao,
        inicio: ata.inicio || "",
        fim: ata.fim || "",
        itens: ata.itens.map((item) => ({ ...item, key: item.ref ? `p:${item.ref}` : item.nup || item.objeto })),
      };
      editando = false;
      pedindoToken = false;
      pendenteExcluir = null;
      saveDraft();
      aplicarTipo();
      fillMeta();
      renderItems();
      loadList();
      note(`Ata de ${new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR")} aberta. Ela está fechada para edição.`);
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
    if (travada()) {
      pedirToken();
      note("A ata está concluída. Use Editar ata e o token para alterar.", true);
      return;
    }
    const button = document.getElementById("ata-save");
    button.disabled = true;
    aplicarTempos();
    renderItems();
    draft.duracao = currentDuration() || "";
    const horas = fillHorarios();
    draft.inicio = horas.inicio;
    draft.fim = horas.fim;
    try {
      const { id } = await api("POST", null, {
        id: draft.id,
        tipo: draft.tipo,
        titulo: draft.titulo,
        data: draft.data,
        responsavel_nome: draft.responsavel_nome,
        participantes: draft.participantes || "",
        duracao: draft.duracao,
        inicio: draft.inicio,
        fim: draft.fim,
        itens: draft.itens.map(({ nup, contrato, contratada, objeto, tempo, texto, ref }) => ({ nup, contrato, contratada, objeto, tempo, texto, ref: ref || "" })),
      });
      draft.id = id;
      editando = false;
      pedindoToken = false;
      pendenteExcluir = null;
      saveDraft();
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      note(`Ata concluída às ${hora}. Os campos foram fechados.`);
      loadList();
    } catch (error) {
      note(error.message, true);
    } finally {
      aplicarTrava();
    }
  }

  async function liberarEdicao(event) {
    event?.preventDefault();
    const token = document.getElementById("ata-token").value.trim();
    if (!token) {
      erroToken("Informe o token de edição.");
      return;
    }
    let response;
    try {
      response = await fetch("/api/validar-token", {
        method: "POST",
        headers: { "x-ata-token": token },
      });
    } catch (error) {
      erroToken("Não foi possível confirmar o token de edição.");
      return;
    }
    if (!response.ok) {
      erroToken(response.status === 404 ? "O token de edição só funciona no site publicado." : "O token de edição não confere.");
      return;
    }
    sessionStorage.setItem(tokenKey, token);
    document.getElementById("ata-token").value = "";
    const alvo = pendenteExcluir;
    pendenteExcluir = null;
    pedindoToken = false;
    fecharToken();
    if (alvo) {
      aplicarTrava();
      return excluir(alvo);
    }
    editando = true;
    aplicarTrava();
    note("Edição liberada. Conclua de novo para fechar a ata.");
  }

  function pedirEdicao() {
    if (!draft.id) return;
    if (temToken()) {
      editando = true;
      pedindoToken = false;
      aplicarTrava();
      note("Edição liberada. Conclua de novo para fechar a ata.");
      return;
    }
    pedirToken();
  }

  function pedirExclusao(id) {
    const alvo = id || draft.id;
    if (!alvo) return;
    if (!temToken()) {
      pedirToken(alvo);
      note("Informe o token para excluir a ata.", true);
      return;
    }
    excluir(alvo);
  }

  async function excluir(id) {
    const alvo = id || draft.id;
    if (!alvo || !temToken()) return;
    if (!window.confirm("Excluir esta ata salva? Essa ação não desfaz.")) return;
    const button = document.getElementById("ata-delete");
    button.disabled = true;
    try {
      await api("DELETE", { id: alvo });
      if (draft.id === alvo) {
        draft = emptyDraft(draft.tipo);
        editando = true;
        saveDraft();
        fillMeta();
        renderItems();
      }
      loadList();
      note("Ata excluída.");
    } catch (error) {
      note(error.message, true);
    } finally {
      button.disabled = false;
      aplicarTrava();
    }
  }

  function xml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function paragrafo(texto, opcoes = {}) {
    const negrito = opcoes.negrito ? "<w:b/>" : "";
    const cor = opcoes.cor ? `<w:color w:val="${opcoes.cor}"/>` : "";
    const tamanho = opcoes.tamanho || "22";
    const depois = opcoes.depois == null ? "40" : opcoes.depois;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${depois}"/></w:pPr><w:r><w:rPr>${negrito}${cor}<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="${tamanho}"/></w:rPr><w:t xml:space="preserve">${xml(texto)}</w:t></w:r></w:p>`;
  }

  function celula(conteudo, fill, borda, span, largura) {
    const fundo = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
    const cor = borda || "C8CACB";
    const lado = ["top", "left", "bottom", "right"]
      .map((nome) => `<w:${nome} w:val="single" w:sz="4" w:space="0" w:color="${cor}"/>`)
      .join("");
    const colunas = span ? `<w:gridSpan w:val="${span}"/>` : "";
    const medida = largura ? `<w:tcW w:w="${largura}" w:type="dxa"/>` : "";
    return `<w:tc><w:tcPr>${medida}${colunas}<w:vAlign w:val="top"/>${fundo}<w:tcBorders>${lado}</w:tcBorders><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>${conteudo}</w:tc>`;
  }

  function tabela(linhas) {
    const grade = [3200, 1800, 3200, 2000].map((largura) => `<w:gridCol w:w="${largura}"/>`).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>${grade}</w:tblGrid>${linhas
      .map((celulas) => `<w:tr>${celulas.join("")}</w:tr>`)
      .join("")}</w:tbl>`;
  }

  function campo(rotulo, valor, fill, borda, valorCor, largura, span) {
    return celula(
      paragrafo(rotulo, { tamanho: "16", cor: "6D6E71", depois: "40" }) +
        paragrafo(valor || "—", { negrito: true, cor: valorCor || "4D4D4D", depois: "0" }),
      fill || "FFFFFF",
      borda,
      span,
      largura,
    );
  }

  async function baixarDocx() {
    readMeta();
    if (typeof JSZip === "undefined") {
      note("Não foi possível gerar o arquivo Word.", true);
      return;
    }
    const ehComite = comite();
    const rotuloItem = ehComite ? "Projeto" : "Contrato";
    const blocos = [
      paragrafo(ehComite ? "Ata do Comitê Executivo" : "Ata da reunião de contratos", { negrito: true, tamanho: "32", cor: "4D4D4D", depois: "80" }),
      paragrafo(`Descreva o que foi falado sobre cada ${ehComite ? "projeto" : "objeto"}.`, { tamanho: "18", cor: "6D6E71", depois: "160" }),
    ];
    const horas = fillHorarios();
    const linhas = [[
      campo("TÍTULO", draft.titulo, "FFFFFF", "C8CACB", "4D4D4D", 3200),
      campo("DATA", dataBR(draft.data), "FFFFFF", "C8CACB", "4D4D4D", 1800),
      campo("RESPONSÁVEL", draft.responsavel_nome, "FFFFFF", "C8CACB", "4D4D4D", 3200),
      campo("DURAÇÃO", currentDuration() || draft.duracao, "E8F7EA", "B7E0BE", "2F9A3D", 2000),
    ], [
      campo("INÍCIO", horas.inicio, "E8F7EA", "B7E0BE", "2F9A3D", 5000, 2),
      campo("FIM", horas.fim, "E8F7EA", "B7E0BE", "2F9A3D", 5200, 2),
    ], [
      celula(
        paragrafo("PARTICIPANTES", { tamanho: "16", cor: "6D6E71", depois: "60" }) +
          paragrafo(nomesSalvos().join(", ") || "Nenhuma presença registrada nesta data.", { negrito: true, depois: "0" }),
        "E6F7F5",
        "B7E0DA",
        4,
      ),
    ]];
    draft.itens.forEach((item) => {
      const meta = item.ref ? "Projeto" : [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
      const partes = String(item.texto || "").split(/\n/);
      const texto = (partes.some((linha) => linha.trim()) ? partes : [" "])
        .map((linha) => paragrafo(linha, { depois: "40" }))
        .join("");
      linhas.push([
        celula(
          paragrafo(meta || rotuloItem, { tamanho: "16", cor: "6D6E71", depois: "40" }) +
            paragrafo(item.objeto || rotuloItem, { negrito: true, depois: "0" }),
          "E6F3FB",
          "C5DFF0",
          3,
          8200,
        ),
        celula(
          paragrafo(item.tempo || "", { negrito: true, cor: "2F9A3D", depois: "0" }),
          "E8F7EA",
          "B7E0BE",
          null,
          2000,
        ),
      ]);
      linhas.push([celula(texto, "FFFFFF", "C8CACB", 4)]);
    });
    blocos.push(tabela(linhas));
    if (!draft.itens.length) blocos.push(paragrafo(ehComite ? "Nenhum projeto nesta ata." : "Nenhum objeto nesta ata.", { cor: "6D6E71" }));
    const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${blocos.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="851" w:right="851" w:bottom="851" w:left="851"/></w:sectPr></w:body>
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
    const nome = `${nomeAta()}.docx`;
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
      fillHorarios();
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

    document.getElementById("ata-tipo").addEventListener("change", (event) => trocarTipo(event.target.value));

    document.getElementById("ata-from-checks").addEventListener("click", async () => {
      if (comite() && Comite.meeting().checks.size) await Comite.load();
      const added = bringChecks();
      if (!added && !marcados().size) {
        const empty = document.getElementById("ata-vazio");
        empty.hidden = false;
        empty.textContent = comite()
          ? "Nenhum projeto foi marcado como discutido na reunião do Comitê."
          : "Nenhum contrato foi marcado como lido nesta reunião.";
      }
    });

    document.getElementById("ata-busca").addEventListener("input", (event) => suggestions(event.target.value));
    document.getElementById("ata-sugestoes").addEventListener("click", (event) => {
      const projetoBtn = event.target.closest("button[data-add-projeto]");
      if (projetoBtn) {
        const projeto = Comite.projetos().find((item) => item.id === projetoBtn.dataset.addProjeto);
        if (!projeto) return;
        addProjeto(projeto);
        saveDraft();
        renderItems();
        document.getElementById("ata-busca").value = "";
        suggestions("");
        return;
      }
      const button = event.target.closest("button[data-add]");
      if (!button) return;
      const row = state.rows.find((item) => item.id === button.dataset.add);
      if (!row) return;
      addRow(row);
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
      const remove = event.target.closest("button[data-delete]");
      if (remove) {
        pedirExclusao(remove.dataset.delete);
        return;
      }
      const button = event.target.closest("button[data-open]");
      if (button) openAta(button.dataset.open);
    });

    document.getElementById("ata-new").addEventListener("click", () => {
      draft = emptyDraft(draft.tipo);
      editando = true;
      pedindoToken = false;
      pendenteExcluir = null;
      saveDraft();
      fillMeta();
      aplicarTipo();
      renderItems();
      loadList();
    });

    document.getElementById("ata-print").addEventListener("click", () => {
      readMeta();
      fillHorarios();
      document.querySelectorAll(".ata-print-value[data-print]").forEach((span) => {
        const field = document.getElementById(span.dataset.print);
        const value = field && field.value;
        span.textContent = span.dataset.print === "ata-data" && value ? dataBR(value) : value || "—";
      });
      document.querySelectorAll(".ata-item textarea").forEach((area) => {
        const box = area.parentElement.querySelector(".ata-texto-print");
        if (box) box.textContent = area.value;
      });
      const nomes = [...document.querySelectorAll("#ata-participantes-lista .freq-check")];
      nomes.forEach((label) => label.classList.remove("is-ultimo"));
      nomes.filter((label) => label.querySelector("input")?.checked).at(-1)?.classList.add("is-ultimo");
      const titulo = document.title;
      document.title = nomeAta();
      document.body.classList.add("printing-ata");
      window.print();
      window.addEventListener("afterprint", () => {
        document.title = titulo;
      }, { once: true });
    });
    document.getElementById("ata-docx").addEventListener("click", baixarDocx);
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-ata"));

    document.getElementById("ata-save").addEventListener("click", save);
    document.getElementById("ata-edit").addEventListener("click", pedirEdicao);
    document.getElementById("ata-delete").addEventListener("click", () => pedirExclusao());
    document.getElementById("ata-token-form").addEventListener("submit", liberarEdicao);
    document.getElementById("ata-token-cancel").addEventListener("click", fecharToken);
    document.getElementById("ata-token-close").addEventListener("click", fecharToken);
    const tokenDialog = document.getElementById("ata-token-dialog");
    tokenDialog.addEventListener("cancel", () => {
      pedindoToken = false;
      pendenteExcluir = null;
    });
    tokenDialog.addEventListener("click", (event) => {
      if (event.target === tokenDialog) fecharToken();
    });

    const vista = sessionStorage.getItem("set-vista");
    sessionStorage.removeItem("set-vista");
    if (sessionStorage.getItem(returnKey) || vista === "ata") {
      sessionStorage.removeItem(returnKey);
      show("ata");
    } else if (vista === "frequencia" || vista === "comite") {
      show(vista);
    } else {
      aplicarTipo();
      fillMeta();
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
  return {
    show,
    api,
    atualizarHorarios() {
      const duracao = document.getElementById("ata-duracao");
      if (duracao) duracao.value = currentDuration() || "Reunião não iniciada";
      fillHorarios();
    },
  };
})();
