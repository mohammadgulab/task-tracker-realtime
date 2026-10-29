// TeamBoard frontend: plain JavaScript, no build step.
(() => {
  const COLUMNS = [
    { id: 'todo', name: 'To do' },
    { id: 'in_progress', name: 'In progress' },
    { id: 'done', name: 'Done' },
  ];
  const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

  const state = {
    token: localStorage.getItem('tb_token'),
    me: null,
    users: [],
    tasks: new Map(),
    online: [],
    socket: null,
    editing: null,
    dragId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // ---------- helpers ----------
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...options, headers, body: options.body && JSON.stringify(options.body) });
    if (res.status === 401 && state.token && !path.startsWith('/api/auth/login')) {
      logout();
      throw new Error('Your session has expired, please log in again');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.details && data.details.map((d) => d.message).join('. ');
      throw new Error(detail || data.error || 'Request failed');
    }
    return data;
  }

  const initials = (name = '?') =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const colorFor = (id) => COLORS[(Number(id) || 0) % COLORS.length];

  function avatar(user, size = '') {
    const a = el('span', `avatar ${size}`.trim(), initials(user.name));
    a.style.background = colorFor(user.id);
    a.title = user.name;
    return a;
  }

  function timeAgo(iso) {
    const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
    const secs = Math.max(0, (Date.now() - date) / 1000);
    if (secs < 45) return 'just now';
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function toast(text) {
    const t = el('div', 'toast', text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3200);
  }

  const columnTasks = (status) =>
    [...state.tasks.values()].filter((t) => t.status === status).sort((a, b) => a.position - b.position);

  // ---------- auth screen ----------
  let mode = 'login';
  function setMode(next) {
    mode = next;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    $('#name-field').hidden = mode !== 'register';
    $('#auth-title').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
    $('#auth-sub').textContent = mode === 'login' ? 'Log in to open your team board.' : 'Join the board in a few seconds.';
    $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create account';
    $('#auth-form').elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  }

  async function submitAuth(e) {
    e.preventDefault();
    const f = e.target;
    const body = { email: f.elements.email.value, password: f.elements.password.value };
    if (mode === 'register') body.name = f.elements.name.value;
    $('#auth-submit').disabled = true;
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body });
      state.token = data.token;
      localStorage.setItem('tb_token', data.token);
      await startBoard(data.user);
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      $('#auth-submit').disabled = false;
    }
  }

  function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
  }

  function logout() {
    localStorage.removeItem('tb_token');
    state.token = null;
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    $('#me-menu').hidden = true;
    showAuth();
  }

  // ---------- board ----------
  async function startBoard(user) {
    state.me = user;
    const [{ tasks }, { users }, { activity }] = await Promise.all([
      api('/api/tasks'),
      api('/api/users'),
      api('/api/activity'),
    ]);
    state.users = users;
    state.tasks = new Map(tasks.map((t) => [t.id, t]));

    $('#auth').hidden = true;
    $('#app').hidden = false;
    const meBtn = $('#me-btn');
    meBtn.replaceChildren(avatar(user));
    $('#me-name').textContent = user.name;
    $('#me-email').textContent = user.email;

    renderBoard();
    renderFeed(activity);
    connectSocket();
  }

  function renderTabs() {
    const tabs = $('#col-tabs');
    const active = $('#board').dataset.active;
    tabs.replaceChildren(
      ...COLUMNS.map((c) => {
        const b = el('button', c.id === active ? 'active' : '', c.name);
        b.append(el('span', 'n', String(columnTasks(c.id).length)));
        b.onclick = () => {
          $('#board').dataset.active = c.id;
          renderTabs();
        };
        return b;
      })
    );
  }

  function renderBoard(flashId) {
    const board = $('#board');
    board.replaceChildren(
      ...COLUMNS.map((c) => {
        const col = el('section', 'column');
        col.dataset.status = c.id;
        const head = el('div', 'column-head');
        head.append(el('span', 'dot'), el('h2', '', c.name), el('span', 'count', String(columnTasks(c.id).length)));
        const add = el('button', 'icon-btn add', '+');
        add.title = `Add a task to ${c.name}`;
        add.onclick = () => openModal(null, c.id);
        head.append(add);

        const list = el('ol', 'cards');
        const items = columnTasks(c.id);
        if (!items.length) list.append(el('li', 'empty', 'No tasks here yet'));
        items.forEach((t) => list.append(renderCard(t, t.id === flashId)));
        wireDrop(col, list, c.id);
        col.append(head, list);
        return col;
      })
    );
    renderTabs();
  }

  function renderCard(t, flash) {
    const card = el('li', `card${flash ? ' flash' : ''}`);
    card.dataset.id = t.id;
    card.draggable = true;

    const top = el('div', 'card-top');
    top.append(el('span', `pill ${t.priority}`, t.priority), el('span', 'card-id', `#${t.id}`));
    const more = el('button', 'more', '•••');
    more.setAttribute('aria-label', 'Task actions');
    more.onclick = (e) => {
      e.stopPropagation();
      openMenu(t.id, more);
    };
    top.append(more);

    card.append(top, el('h3', '', t.title));
    if (t.description) card.append(el('p', '', t.description));

    const foot = el('div', 'card-foot');
    const who = el('div', 'who');
    if (t.assignee) who.append(avatar(t.assignee, 'sm'), el('span', '', t.assignee.name));
    else who.append(el('span', 'unassigned'), el('span', '', 'Unassigned'));
    foot.append(who, el('span', 'when', timeAgo(t.updated_at)));
    card.append(foot);

    card.addEventListener('click', () => openModal(t));
    card.addEventListener('dragstart', (e) => {
      state.dragId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(t.id));
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      state.dragId = null;
      clearDropUi();
    });
    return card;
  }

  // ---------- drag and drop ----------
  let marker = null;
  function clearDropUi() {
    document.querySelectorAll('.column.drag-over').forEach((c) => c.classList.remove('drag-over'));
    if (marker) marker.remove();
    marker = null;
  }

  // Index among the other cards in the column, based on the pointer height.
  function dropIndex(list, y) {
    const cards = [...list.querySelectorAll('.card')].filter((c) => Number(c.dataset.id) !== state.dragId);
    const idx = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { index: idx === -1 ? cards.length : idx, before: cards[idx] || null };
  }

  function wireDrop(col, list, status) {
    col.addEventListener('dragover', (e) => {
      if (state.dragId == null) return;
      e.preventDefault();
      document.querySelectorAll('.column.drag-over').forEach((c) => c !== col && c.classList.remove('drag-over'));
      col.classList.add('drag-over');
      const { before } = dropIndex(list, e.clientY);
      if (!marker) marker = el('li', 'drop-marker');
      if (before) list.insertBefore(marker, before);
      else list.append(marker);
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
        if (marker && marker.parentNode === list) marker.remove();
      }
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = state.dragId;
      const { index } = dropIndex(list, e.clientY);
      clearDropUi();
      if (id != null) moveTask(id, status, index);
    });
  }

  // Applies a move locally first, then saves it. The server reply and the
  // socket event both carry the final positions.
  async function moveTask(id, status, index) {
    const task = state.tasks.get(id);
    if (!task) return;
    const target = columnTasks(status).filter((t) => t.id !== id);
    index = Math.max(0, Math.min(index, target.length));
    if (task.status === status && columnTasks(status).indexOf(task) === index) return;

    const before = new Map([...state.tasks].map(([k, v]) => [k, { ...v }]));
    const from = task.status;
    target.splice(index, 0, task);
    task.status = status;
    target.forEach((t, i) => (t.position = i));
    if (from !== status) columnTasks(from).forEach((t, i) => (t.position = i));
    renderBoard(id);

    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: { status, position: index } });
    } catch (err) {
      state.tasks = before;
      renderBoard();
      toast(err.message);
    }
  }

  // ---------- card menu (touch friendly) ----------
  function closeMenu() {
    $('#card-menu').hidden = true;
  }

  function openMenu(id, anchor) {
    const task = state.tasks.get(id);
    const menu = $('#card-menu');
    menu.replaceChildren(el('h4', '', 'Move to'));
    COLUMNS.forEach((c) => {
      const b = el('button');
      const dot = el('span', 'dot');
      dot.style.background = c.id === 'todo' ? '#8b8fa8' : c.id === 'done' ? '#0f9f6e' : '#4f46e5';
      b.append(dot, document.createTextNode(c.name + (c.id === task.status ? ' (current)' : '')));
      b.disabled = c.id === task.status;
      b.onclick = () => {
        closeMenu();
        moveTask(id, c.id, 0);
        toast(`Moved to ${c.name}`);
      };
      menu.append(b);
    });
    const list = columnTasks(task.status);
    const pos = list.indexOf(task);
    const up = el('button', '', 'Move up');
    up.disabled = pos <= 0;
    up.onclick = () => { closeMenu(); moveTask(id, task.status, pos - 1); };
    const down = el('button', '', 'Move down');
    down.disabled = pos >= list.length - 1;
    down.onclick = () => { closeMenu(); moveTask(id, task.status, pos + 1); };
    const edit = el('button', '', 'Edit task');
    edit.onclick = () => { closeMenu(); openModal(task); };
    const del = el('button', 'danger', 'Delete task');
    del.onclick = () => { closeMenu(); removeTask(task); };
    menu.append(el('hr'), up, down, el('hr'), edit, del);

    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8);
    const top = r.bottom + 6 + menu.offsetHeight > window.innerHeight ? r.top - menu.offsetHeight - 6 : r.bottom + 6;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  // ---------- create / edit ----------
  function openModal(task, status = 'todo') {
    state.editing = task ? task.id : null;
    const f = $('#task-form');
    f.reset();
    const sel = $('#assignee-select');
    sel.replaceChildren(new Option('Unassigned', ''), ...state.users.map((u) => new Option(u.name, u.id)));
    f.elements.title.value = task ? task.title : '';
    f.elements.description.value = task ? task.description : '';
    f.elements.priority.value = task ? task.priority : 'medium';
    f.elements.status.value = task ? task.status : status;
    sel.value = task && task.assignee ? String(task.assignee.id) : task ? '' : String(state.me.id);
    $('#modal-title').textContent = task ? `Edit task #${task.id}` : 'New task';
    $('#task-submit').textContent = task ? 'Save changes' : 'Create task';
    $('#delete-task-btn').hidden = !task;
    $('#task-error').textContent = '';
    $('#modal').hidden = false;
    setTimeout(() => f.elements.title.focus(), 30);
  }

  function closeModal() {
    $('#modal').hidden = true;
    state.editing = null;
  }

  async function submitTask(e) {
    e.preventDefault();
    const f = e.target;
    const body = {
      title: f.elements.title.value,
      description: f.elements.description.value,
      priority: f.elements.priority.value,
      assignee_id: f.elements.assignee_id.value ? Number(f.elements.assignee_id.value) : null,
    };
    try {
      if (state.editing) {
        const current = state.tasks.get(state.editing);
        if (f.elements.status.value !== current.status) body.status = f.elements.status.value;
        const { task } = await api(`/api/tasks/${state.editing}`, { method: 'PATCH', body });
        upsert(task);
      } else {
        body.status = f.elements.status.value;
        const { task } = await api('/api/tasks', { method: 'POST', body });
        upsert(task);
        $('#board').dataset.active = task.status;
        renderBoard(task.id);
      }
      closeModal();
    } catch (err) {
      $('#task-error').textContent = err.message;
    }
  }

  async function removeTask(task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      state.tasks.delete(task.id);
      closeModal();
      renderBoard();
    } catch (err) {
      toast(err.message);
    }
  }

  function upsert(task) {
    state.tasks.set(task.id, task);
  }

  // ---------- activity + presence ----------
  function feedItem(a, isNew) {
    const li = el('li', isNew ? 'new' : '');
    li.append(avatar({ id: a.user_id, name: a.user_name || '?' }, 'sm'));
    const body = el('div');
    body.append(el('strong', '', a.user_name || 'Someone'), document.createTextNode(` ${a.message}`));
    const time = el('time', '', timeAgo(a.created_at));
    time.dataset.ts = a.created_at;
    body.append(time);
    li.append(body);
    return li;
  }

  function renderFeed(items) {
    const feed = $('#feed');
    feed.replaceChildren(...items.map((a) => feedItem(a, false)));
    if (!items.length) feed.append(el('li', 'muted', 'Nothing yet. Changes will show up here.'));
  }

  function renderOnline() {
    const box = $('#online-avatars');
    box.replaceChildren(...state.online.slice(0, 5).map((u) => avatar(u)));
    const n = state.online.length;
    $('#online-count').textContent = `${n} online`;
    $('#online').title = state.online.map((u) => u.name).join(', ');
  }

  // ---------- realtime ----------
  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    const socket = io({ auth: { token: state.token } });
    state.socket = socket;
    const conn = $('#conn-state');

    socket.on('connect', () => { conn.textContent = 'Live'; conn.classList.remove('off'); });
    socket.on('disconnect', () => { conn.textContent = 'Offline'; conn.classList.add('off'); });
    socket.on('connect_error', (err) => {
      conn.textContent = 'Offline';
      conn.classList.add('off');
      if (err.message === 'unauthorized') logout();
    });
    // After a reconnect, reload the board so nothing is missed.
    socket.io.on('reconnect', async () => {
      const { tasks } = await api('/api/tasks');
      state.tasks = new Map(tasks.map((t) => [t.id, t]));
      renderBoard();
    });

    const fromOther = (by) => by && state.me && by.id !== state.me.id;

    socket.on('presence:update', ({ users }) => {
      state.online = users;
      renderOnline();
    });

    socket.on('task:created', ({ task, by }) => {
      upsert(task);
      renderBoard(fromOther(by) ? task.id : null);
      if (fromOther(by)) toast(`${by.name} added "${task.title}"`);
    });

    socket.on('task:updated', ({ task, by }) => {
      upsert(task);
      renderBoard(fromOther(by) ? task.id : null);
    });

    socket.on('task:moved', ({ task, positions, by }) => {
      upsert(task);
      positions.forEach((p) => {
        const t = state.tasks.get(p.id);
        if (t) { t.status = p.status; t.position = p.position; }
      });
      renderBoard(fromOther(by) ? task.id : null);
      if (fromOther(by)) toast(`${by.name} moved "${task.title}"`);
    });

    socket.on('task:deleted', ({ id, by }) => {
      const t = state.tasks.get(id);
      state.tasks.delete(id);
      if (state.editing === id) closeModal();
      renderBoard();
      if (t && fromOther(by)) toast(`${by.name} deleted "${t.title}"`);
    });

    socket.on('activity:new', (a) => {
      const feed = $('#feed');
      const placeholder = feed.querySelector('.muted');
      if (placeholder) placeholder.remove();
      feed.prepend(feedItem(a, true));
      while (feed.children.length > 30) feed.lastChild.remove();
    });
  }

  // Keep relative times fresh.
  setInterval(() => {
    document.querySelectorAll('#feed time').forEach((t) => (t.textContent = timeAgo(t.dataset.ts)));
  }, 30000);

  // ---------- wiring ----------
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#demo-btn').onclick = () => {
    setMode('login');
    const f = $('#auth-form');
    f.elements.email.value = 'demo@example.com';
    f.elements.password.value = 'demo1234';
    f.requestSubmit();
  };
  $('#task-form').addEventListener('submit', submitTask);
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#delete-task-btn').onclick = () => removeTask(state.tasks.get(state.editing));
  $('#new-task-btn').onclick = () => openModal(null, $('#board').dataset.active || 'todo');
  $('#me-btn').onclick = (e) => { e.stopPropagation(); $('#me-menu').hidden = !$('#me-menu').hidden; };
  $('#logout-btn').onclick = logout;
  $('#activity-toggle').onclick = () => $('#activity').classList.add('open');
  $('#activity-close').onclick = () => $('#activity').classList.remove('open');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#card-menu')) closeMenu();
    if (!e.target.closest('.me')) $('#me-menu').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); closeModal(); }
  });
  window.addEventListener('resize', closeMenu);

  // ---------- start ----------
  (async () => {
    if (!state.token) return showAuth();
    try {
      const { user } = await api('/api/auth/me');
      await startBoard(user);
    } catch {
      showAuth();
    }
  })();
})();
