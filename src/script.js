/* =========================================================
   CONFIGURAÇÃO DA API
   ========================================================= */

const API_BASE_URL = "http://127.0.0.1:5000";

const ARTIST_SEARCH_PARAM = "artist";

const ENDPOINTS = {
  register: "auth/register",
  login: "auth/login",
  logout: "auth/logout",
  artist: "artist/search",
  favorites: "favoriteArtist",
  recommend: "recommend",
};

// Limite de artistas que podem ser enviados de uma vez para o
// endpoint "recommend", pra não sobrecarregar o backend.
const MAX_DISCOVERY_SELECTION = 10;

// Como o JS não consegue ler um cookie HttpOnly, guardamos só o
// username no localStorage — apenas para exibição na tela e para
// saber que "provavelmente" há uma sessão ativa ao recarregar a
// página. Quem de fato valida a sessão é o backend, a cada chamada.
const USERNAME_KEY = "tunefinder_username";

function getStoredUsername() { return localStorage.getItem(USERNAME_KEY); }

function setSession(username) {
  localStorage.setItem(USERNAME_KEY, username);
}

function clearSession() {
  localStorage.removeItem(USERNAME_KEY);
}

/**
 * Wrapper de fetch com base URL, cookie de sessão e tratamento de erro
 * padronizado. Lança um Error (com err.status quando aplicável) quando
 * a resposta não é 2xx.
 */
async function apiFetch(path, options = {}) {
  const { params, ...fetchOptions } = options;

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  
  const url = new URL(`${API_BASE_URL}/${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      ...fetchOptions,
      headers,
      credentials: "include",
     });
  } catch (networkError) {
    throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão.");
  }

  let data = null;
  const rawText = await response.text();
  if (rawText) {
    try { data = JSON.parse(rawText); } catch { /* resposta não era JSON */ }
  }

  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `Erro ${response.status} ao falar com o servidor.`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return data;
}

function isUnauthorized(err) {
  return err && err.status === 401;
}

/* --- chamadas de autenticação --- */
async function apiRegister(username, password) {
  const data = await apiFetch(ENDPOINTS.register, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return { username: data?.id || username };
}

async function apiLogin(username, password) {
  const data = await apiFetch(ENDPOINTS.login, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return { username: data?.id || username };
}

async function apiLogout() {
  await apiFetch(ENDPOINTS.logout, { method: "POST" });
}

async function apiGetFavorites() {
  const data = await apiFetch(ENDPOINTS.favorites, { method: "GET" });
  const list = Array.isArray(data) ? data : (data?.favorite_artists || []);
  return list.map(normalizeArtist);
}

async function apiAddFavorite(artist) {
  return apiFetch(ENDPOINTS.favorites, {
    method: "POST",
    body: JSON.stringify({
      id_artist: artist.id,
      artist_name: artist.name,
      note: artist.note
    }),
  });
}

async function apiRemoveFavorite(artistId) {
  return apiFetch(ENDPOINTS.favorites, {
    method: "DELETE",
    body: JSON.stringify({ id_artist: artistId }),
  });
}

async function apiUpdateFavorite(artistId, note) {
  return apiFetch(ENDPOINTS.favorites, {
    method: "PUT",
    body: JSON.stringify({ id_artist: artistId, note: note }),
  });
}

/* --- busca de artista no sistema externo --- */
async function apiSearchArtists(query) {
  const data = await apiFetch(ENDPOINTS.artist, {
    method: "GET",
    params: {
      [ARTIST_SEARCH_PARAM]: query
    }
  });

  const list = Array.isArray(data) ? data : (data?.results || data?.artists || []);
  return list.map(normalizeArtist);
}

/* --- recomendação a partir de artistas favoritos selecionados --- */
async function apiRecommend(artistIds) {
  const data = await apiFetch(ENDPOINTS.recommend, {
    method: "POST",
    body: JSON.stringify({ artist_ids: artistIds }),
  });
  const list = Array.isArray(data) ? data : (data?.suggestions || data?.artists || []);
  return list.map(normalizeArtist);
}

/**
 * Normaliza um artista vindo de qualquer endpoint (busca externa ou
 * favoritos) para o formato interno usado pela UI:
 * { id, name, color: string }
 */
const PALETTE = ["#e3a23c", "#e2604a", "#4f9d92", "#8b7ec8"];

function colorForId(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) % PALETTE.length;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function normalizeArtist(raw) {
  const id = String(raw.id ?? raw.id_artist ?? raw.mbid ?? raw.name);
  const name = raw.name ?? raw.artist_name ?? "Artista sem nome";
  
  return { id, name, color: colorForId(id) };
}

/* -----------------------------------------------------------
   Toast utilitário
   ----------------------------------------------------------- */
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setStatus(elId, message, isError = false) {
  const el = document.getElementById(elId);
  if (!message) {
    el.classList.add("is-hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.classList.remove("is-hidden");
}

/* -----------------------------------------------------------
   Estado em memória dos favoritos (espelha o backend)
   ----------------------------------------------------------- */
let favoritesCache = [];

/* -----------------------------------------------------------
   Autenticação — troca de abas login/registro
   ----------------------------------------------------------- */
const authTabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

authTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    authTabs.forEach(t => {
      t.classList.remove("is-active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");

    const isLogin = tab.dataset.tab === "login";
    loginForm.classList.toggle("is-hidden", !isLogin);
    registerForm.classList.toggle("is-hidden", isLogin);
    document.getElementById("login-error").textContent = "";
    document.getElementById("register-error").textContent = "";
  });
});

/* -----------------------------------------------------------
   Registro de novo usuário
   ----------------------------------------------------------- */
registerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl = document.getElementById("register-error");
  errorEl.textContent = "";

  const username = document.getElementById("register-username").value.trim();
  const password = document.getElementById("register-password").value;
  const confirm = document.getElementById("register-password-confirm").value;

  if (username.length < 3) {
    errorEl.textContent = "O usuário precisa ter ao menos 3 caracteres.";
    return;
  }
  if (password.length < 4) {
    errorEl.textContent = "A senha precisa ter ao menos 4 caracteres.";
    return;
  }
  if (password !== confirm) {
    errorEl.textContent = "As senhas não coincidem.";
    return;
  }

  const submitBtn = registerForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Criando conta...";

  try {
    const { username: confirmedUsername } = await apiRegister(username, password);
    setSession(confirmedUsername);
    showToast(`Conta criada. Bem-vindo(a), ${confirmedUsername}.`);
    await enterApp();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Criar conta";
  }
});

/* -----------------------------------------------------------
   Login
   ----------------------------------------------------------- */
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  const submitBtn = loginForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando...";

  try {
    const { username: confirmedUsername } = await apiLogin(username, password);
    setSession(confirmedUsername);
    showToast(`De volta, ${confirmedUsername}.`);
    await enterApp();
  } catch (err) {
    errorEl.textContent = err.message || "Usuário ou senha incorretos.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
  }
});

/* -----------------------------------------------------------
   Logout
   ----------------------------------------------------------- */
document.getElementById("logout-btn").addEventListener("click", async () => {
  const btn = document.getElementById("logout-btn");
  btn.disabled = true;
  try {
    await apiLogout();
  } catch (err) {
    // mesmo se o backend falhar, seguimos limpando a sessão local
    console.warn("Falha ao chamar auth/logout:", err.message);
  } finally {
    goToLoginScreen();
    btn.disabled = false;
  }
});

/** Limpa o estado local e volta para a tela de login. */
function goToLoginScreen() {
    clearSession();
    favoritesCache = [];
    loginForm.reset();
    registerForm.reset();
    document.getElementById("app-screen").classList.add("is-hidden");
    document.getElementById("auth-screen").classList.remove("is-hidden");  
}

/* -----------------------------------------------------------
   Navegação entre views (Favoritos / Descobrir / Buscar)
   ----------------------------------------------------------- */
function switchView(viewName) {
  document.getElementById("view-favorites").classList.toggle("is-hidden", viewName !== "favorites");
  document.getElementById("view-discovery").classList.toggle("is-hidden", viewName !== "discovery");
  document.getElementById("view-search").classList.toggle("is-hidden", viewName !== "search");

  // a tela de busca é uma sub-tela de Favoritos, então mantém aquele
  // item do menu ativo
  const navTarget = viewName === "search" ? "favorites" : viewName;
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.view === navTarget);
  });

  if (viewName === "discovery") renderDiscoveryDial();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.getElementById("go-to-search-btn").addEventListener("click", () => {
  switchView("search");
  document.getElementById("search-input").focus();
});

document.getElementById("back-to-favorites-btn").addEventListener("click", () => {
  switchView("favorites");
});

/* -----------------------------------------------------------
   Entrar no app: carrega favoritos do backend e renderiza tudo
   ----------------------------------------------------------- */
async function enterApp() {
  const username = getStoredUsername();
  if (!username) return;

  document.getElementById("auth-screen").classList.add("is-hidden");
  document.getElementById("app-screen").classList.remove("is-hidden");
  document.getElementById("current-user").textContent = username;

  const sessionValid = await loadFavoritesFromServer();
  if (!sessionValid) {
    goToLoginScreen();
    return;
  }
  switchView("favorites");
}

/**
 * Busca os favoritos no backend. Retorna false quando a sessão está
 * inválida/expirada (401), para retornar usuário para o login.
 * Outros erros (rede, 500 etc.) são apenas exibidos,
 * mantendo o usuário na tela em que está.
 */
async function loadFavoritesFromServer() {
  setStatus("favorites-status", "Carregando favoritos...");
  try {
    favoritesCache = await apiGetFavorites();
    setStatus("favorites-status", null);
  } catch (err) {
    if (isUnauthorized(err)) return false;
    setStatus("favorites-status", `Não foi possível carregar seus favoritos: ${err.message}`, true);
    favoritesCache = [];
  }
  renderFavorites();
  return true;
}

/* =============================================================
   FAVORITOS
   ============================================================= */
function renderFavorites() {
  const grid = document.getElementById("favorites-grid");
  const empty = document.getElementById("favorites-empty");

  grid.innerHTML = "";

  if (favoritesCache.length === 0) {
    empty.classList.remove("is-hidden");
  } else {
    empty.classList.add("is-hidden");
    favoritesCache.forEach(artist => {
      grid.appendChild(buildRecordCard(artist, { removable: true }));
    });
  }
}

function buildRecordCard(artist, { removable = false, addable = false, alreadyAdded = false } = {}) {
  const li = document.createElement("li");
  li.className = "record-card";

  const disc = document.createElement("div");
  disc.className = "record-disc";
  disc.style.setProperty("--disc-color", artist.color);
  li.appendChild(disc);

  const name = document.createElement("p");
  name.className = "record-name";
  name.textContent = artist.name;
  li.appendChild(name);

  if (removable) {
    const noteWrap = document.createElement("div");
    noteWrap.className = "record-note-wrap";
    renderNoteView(noteWrap, artist);
    li.appendChild(noteWrap);
  }

  if (removable) {
    const btn = document.createElement("button");
    btn.className = "btn-remove";
    btn.textContent = "Remover";
    btn.addEventListener("click", () => removeFavorite(artist));
    li.appendChild(btn);
  }

  if (addable) {
    const btn = document.createElement("button");
    btn.className = "btn-add-small";
    if (alreadyAdded) {
      btn.textContent = "Adicionado ✓";
      btn.disabled = true;
      li.classList.add("is-added");
    } else {
      btn.textContent = "Adicionar aos favoritos";
      btn.addEventListener("click", () => addFavoriteFromSearch(artist, li, btn));
    }
    li.appendChild(btn);
  }

  return li;
}

/**
 * Nota pessoal de um favorito — modo de exibição: mostra o texto (se
 * houver) e um botão para editar.
 */
function renderNoteView(container, artist) {
  container.innerHTML = "";

  if (artist.note) {
    const note = document.createElement("p");
    note.className = "record-note";
    note.textContent = artist.note;
    container.appendChild(note);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "btn-add-small";
  editBtn.textContent = artist.note ? "Editar nota" : "Adicionar nota";
  editBtn.addEventListener("click", () => renderNoteEdit(container, artist));
  container.appendChild(editBtn);
}

/**
 * Nota pessoal de um favorito — modo de edição: campo de texto +
 * Salvar (chama PUT fav_artist) / Cancelar.
 */
function renderNoteEdit(container, artist) {
  container.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "note-input";
  input.value = artist.note || "";
  input.maxLength = 140;
  input.placeholder = "Ex: descobri em um show em 2019";

  const actions = document.createElement("div");
  actions.className = "note-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn-add-small";
  saveBtn.textContent = "Salvar";
  saveBtn.addEventListener("click", async () => {
    const newNote = input.value.trim();
    saveBtn.disabled = true;
    saveBtn.textContent = "Salvando...";
    try {
      await apiUpdateFavorite(artist.id, newNote);
      artist.note = newNote;
      const cached = favoritesCache.find(a => a.id === artist.id);
      if (cached) cached.note = newNote;
      renderNoteView(container, artist);
      showToast("Nota atualizada.");
    } catch (err) {
      if (isUnauthorized(err)) { goToLoginScreen(); return; }
      saveBtn.disabled = false;
      saveBtn.textContent = "Salvar";
      showToast(`Não foi possível salvar a nota: ${err.message}`);
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-remove";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => renderNoteView(container, artist));

  actions.append(saveBtn, cancelBtn);
  container.append(input, actions);
  input.focus();
}

async function addFavoriteFromSearch(artist, cardEl, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Adicionando...";
  try {
    await apiAddFavorite(artist);
    favoritesCache = [...favoritesCache, artist];
    btnEl.textContent = "Adicionado ✓";
    cardEl.classList.add("is-added");
    showToast(`${artist.name} adicionado aos favoritos.`);
    renderFavorites();
    renderDiscoveryDial();
  } catch (err) {
    if (isUnauthorized(err)) { goToLoginScreen(); return; }
    btnEl.disabled = false;
    btnEl.textContent = "Adicionar aos favoritos";
    showToast(`Não foi possível adicionar: ${err.message}`);
  }
}

async function removeFavorite(artist) {
  try {
    await apiRemoveFavorite(artist.id);
    favoritesCache = favoritesCache.filter(a => a.id !== artist.id);
    selectedDiscoveryIds.delete(artist.id);
    renderFavorites();
    renderDiscoveryDial();
    showToast(`${artist.name} removido dos favoritos.`);
  } catch (err) {
    if (isUnauthorized(err)) { goToLoginScreen(); return; }
    showToast(`Não foi possível remover: ${err.message}`);
  }
}

/* =============================================================
   BUSCAR ARTISTA (sistema externo)
   ============================================================= */
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchSubmitBtn = document.getElementById("search-submit-btn");
const searchResultsGrid = document.getElementById("search-results-grid");

searchForm.addEventListener("submit", async e => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  searchSubmitBtn.disabled = true;
  searchSubmitBtn.textContent = "Buscando...";
  searchResultsGrid.innerHTML = "";
  setStatus("search-status", "Buscando artistas...");

  try {
    const results = await apiSearchArtists(query);
    setStatus("search-status", null);

    if (results.length === 0) {
      setStatus("search-status", "Nenhum artista encontrado para essa busca.");
    } else {
      const favoriteIds = new Set(favoritesCache.map(a => a.id));
      results.forEach(artist => {
        searchResultsGrid.appendChild(
          buildRecordCard(artist, { addable: true, alreadyAdded: favoriteIds.has(artist.id) })
        );
      });
    }
  } catch (err) {
    if (isUnauthorized(err)) { goToLoginScreen(); return; }
    setStatus("search-status", `Erro ao buscar: ${err.message}`, true);
  } finally {
    searchSubmitBtn.disabled = false;
    searchSubmitBtn.textContent = "Buscar";
  }
});

/* =============================================================
   DESCOBRIR
   ============================================================= */
const selectedDiscoveryIds = new Set();
const discoverySubmitBtn = document.getElementById("discovery-submit-btn");

function renderDiscoveryDial() {
  const dial = document.getElementById("discovery-dial");
  const empty = document.getElementById("discovery-empty");

  dial.innerHTML = "";

  // remove da seleção qualquer id que não seja mais favorito
  const favoriteIds = new Set(favoritesCache.map(a => a.id));
  [...selectedDiscoveryIds].forEach(id => {
    if (!favoriteIds.has(id)) selectedDiscoveryIds.delete(id);
  });

  if (favoritesCache.length === 0) {
    empty.classList.remove("is-hidden");
    discoverySubmitBtn.disabled = true;
    document.getElementById("discovery-results").classList.add("is-hidden");
    return;
  }
  empty.classList.add("is-hidden");

  favoritesCache.forEach(artist => {
    const chip = document.createElement("li");
    chip.className = "dial-chip";
    chip.setAttribute("role", "checkbox");
    chip.setAttribute("aria-checked", String(selectedDiscoveryIds.has(artist.id)));
    chip.tabIndex = 0;
    if (selectedDiscoveryIds.has(artist.id)) chip.classList.add("is-selected");

    const disc = document.createElement("span");
    disc.className = "mini-disc";
    disc.style.setProperty("--disc-color", artist.color);

    const label = document.createElement("span");
    label.textContent = artist.name;

    chip.append(disc, label);

    const toggle = () => {
      if (selectedDiscoveryIds.has(artist.id)) {
        selectedDiscoveryIds.delete(artist.id);
      } else {
        if (selectedDiscoveryIds.size >= MAX_DISCOVERY_SELECTION) {
          showToast(`Você pode selecionar no máximo ${MAX_DISCOVERY_SELECTION} artistas por vez.`);
          return;
        }
        selectedDiscoveryIds.add(artist.id);
      }
      renderDiscoveryDial();
    };
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    dial.appendChild(chip);
  });

  discoverySubmitBtn.disabled = selectedDiscoveryIds.size === 0;
}

discoverySubmitBtn.addEventListener("click", async () => {
  const selectedIds = [...selectedDiscoveryIds];
  if (selectedIds.length === 0) return;

  if (selectedIds.length > MAX_DISCOVERY_SELECTION) {
    setStatus(
      "discovery-status",
      `Selecione no máximo ${MAX_DISCOVERY_SELECTION} artistas por vez (você marcou ${selectedIds.length}).`,
      true
    );
    return;
  }

  const results = document.getElementById("discovery-results");
  const grid = document.getElementById("discovery-grid");
  const sourceNameEl = document.getElementById("discovery-source-name");

  discoverySubmitBtn.disabled = true;
  discoverySubmitBtn.textContent = "Descobrindo...";
  setStatus("discovery-status", "Buscando sugestões...");
  results.classList.add("is-hidden");

  try {
    const recommendations = await apiRecommend(selectedIds);
    setStatus("discovery-status", null);

    const selectedNames = favoritesCache
      .filter(a => selectedDiscoveryIds.has(a.id))
      .map(a => a.name);
    sourceNameEl.textContent = selectedNames.join(", ");

    grid.innerHTML = "";
    if (recommendations.length === 0) {
      const li = document.createElement("li");
      li.style.color = "var(--paper-dim)";
      li.style.fontSize = "0.88rem";
      li.textContent = "Nenhuma sugestão encontrada para essa combinação de favoritos.";
      grid.appendChild(li);
    } else {
      const favoriteIds = new Set(favoritesCache.map(a => a.id));
      recommendations.forEach(artist => {
        artist.note = "Sugerido à partir de " + selectedNames.join(", ");
        grid.appendChild(buildRecordCard(artist, { addable: true, alreadyAdded: favoriteIds.has(artist.id) }));
      });
    }
    results.classList.remove("is-hidden");
  } catch (err) {
    if (isUnauthorized(err)) { goToLoginScreen(); return; }
    setStatus("discovery-status", `Não foi possível buscar sugestões: ${err.message}`, true);
  } finally {
    discoverySubmitBtn.disabled = selectedDiscoveryIds.size === 0;
    discoverySubmitBtn.textContent = "Descobrir novos artistas";
  }
});

/* -----------------------------------------------------------
   Boot: se há um username salvo, tentamos entrar direto no app —
   a validade real da sessão (cookie) é conferida dentro de
   enterApp(), que volta pro login sozinho se o cookie não for aceito.
   ----------------------------------------------------------- */
(function init() {
  if (getStoredUsername()) {
    enterApp();
  }
})();