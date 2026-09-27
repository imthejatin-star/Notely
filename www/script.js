import { supabase } from "./supabase.js";
const {
  data: { session }
} = await supabase.auth.getSession();

if (!session) {
  window.location.href = "auth.html";
}
"use strict";

/*
  NOTELY
  Premium local-first notes + checklist application.

  Storage:
  notely_premium_v2

  This version is designed to gracefully migrate notes from
  the previous Notely version.
*/

const STORAGE_KEY = "notely_premium_v2";
const THEME_KEY = "notely_theme_v2";
const DRAFT_KEY = "notely_editor_draft_v2";

let state = loadState();

let activeFilter = "all";
let activeLabel = "";
let searchTerm = "";
let sortMode = "updated";

let editorMode = "note";
let editingId = null;
let editorDirty = false;
let editorOriginalSnapshot = "";
let checklistItems = [];
let showCompleted = true;

let undoData = null;
let toastTimer = null;
let autosaveTimer = null;

let contextNoteId = null;


/* =========================================================
   INITIAL STATE
========================================================= */

function defaultState() {
  return {
    notes: [],
    labels: ["School", "Personal", "Ideas"],
    version: 2
  };
}

function normalizeNote(note) {
  const now = Date.now();

  const normalized = {
    id: note.id || cryptoRandomId(),
    type: note.type === "checklist" ? "checklist" : "note",

    title: typeof note.title === "string" ? note.title : "",
    body: typeof note.body === "string" ? note.body : "",
    bodyHtml:
      typeof note.bodyHtml === "string"
        ? note.bodyHtml
        : escapeHTML(note.body || "").replace(/\n/g, "<br>"),

    checklist: Array.isArray(note.checklist)
      ? note.checklist.map(item => ({
          id: item.id || cryptoRandomId(),
          text: typeof item.text === "string" ? item.text : "",
          done: Boolean(item.done)
        }))
      : [],

    color: note.color || "default",
    label: typeof note.label === "string" ? note.label : "",

    pinned: Boolean(note.pinned),
    favorite: Boolean(note.favorite),
    archived: Boolean(note.archived),
    trashed: Boolean(note.trashed),

    reminderAt: note.reminderAt || "",

    createdAt: Number(note.createdAt) || now,
    updatedAt: Number(note.updatedAt) || now,

    reminderNotified: Boolean(note.reminderNotified)
  };

  return normalized;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        notes: parsed.map(normalizeNote),
        labels: ["School", "Personal", "Ideas"],
        version: 2
      };
    }

    return {
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.map(normalizeNote)
        : [],
      labels: Array.isArray(parsed.labels) && parsed.labels.length
        ? [...new Set([
            "School",
            "Personal",
            "Ideas",
            ...parsed.labels
              .filter(x => typeof x === "string")
              .map(x => x.trim())
              .filter(Boolean)
          ])]
        : ["School", "Personal", "Ideas"],
      version: 2
    };
  } catch (error) {
    console.error("Could not load Notely data:", error);
    return defaultState();
  }
}

function saveState(noteToSync = null) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(state)
  );

  if (noteToSync) {
    syncNoteToCloud(noteToSync);
  }
}

async function syncNoteToCloud(note) {
  if (!session || !note) return;

  const cloudNote = {
    id: note.id,
    user_id: session.user.id,

    title: note.title || "",

    body_html: note.bodyHtml || "",
    body_text: getNoteText(note) || "",

    type: note.type || "note",

    checklist: Array.isArray(note.checklist)
      ? note.checklist
      : [],

    color: note.color || "default",
    label: note.label || "",

    favorite: Boolean(note.favorite),
    pinned: Boolean(note.pinned),
    archived: Boolean(note.archived),
    trashed: Boolean(note.trashed),

    reminder_at: note.reminderAt || null,

    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString()
  };

  const { error } = await supabase
    .from("notes")
    .upsert(cloudNote, {
      onConflict: "id"
    });

  if (error) {
    console.error("Notely cloud sync error:", error);
    showToast("Cloud sync failed");
    return;
  }

  console.log("Notely: note synced to cloud", note.id);
}
function cryptoRandomId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return "n_" + Date.now() + "_" + Math.random().toString(36).slice(2);
}


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const notesGrid = $("notesGrid");
const emptyState = $("emptyState");
const emptyTitle = $("emptyTitle");
const emptyText = $("emptyText");

const editor = $("editor");
const overlay = $("overlay");

const noteTitle = $("noteTitle");
const richEditor = $("richEditor");
const checklistEditor = $("checklistEditor");
const checklistItemsEl = $("checklistItems");

const noteLabel = $("noteLabel");
const noteReminder = $("noteReminder");

const toast = $("toast");
const undoBar = $("undoBar");
const contextMenu = $("contextMenu");


/* =========================================================
   UTILITIES
========================================================= */

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHTML(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html || "";
  return temp.textContent || temp.innerText || "";
}

function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";

  const allowed = [
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "H2",
    "P",
    "BR",
    "UL",
    "OL",
    "LI"
  ];

  function clean(parent) {
    [...parent.children].forEach(child => {
      if (!allowed.includes(child.tagName)) {
        const fragment = document.createDocumentFragment();

        while (child.firstChild) {
          fragment.appendChild(child.firstChild);
        }

        child.replaceWith(fragment);
        return;
      }

      [...child.attributes].forEach(attr => {
        child.removeAttribute(attr.name);
      });

      clean(child);
    });
  }

  clean(template.content);

  return template.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);
  const now = new Date();

  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function formatFullDate(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatReminder(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getNoteText(note) {
  if (note.type === "checklist") {
    return note.checklist
      .map(item => item.text)
      .join(" ");
  }

  return stripHTML(note.bodyHtml || note.body || "");
}

function getPreview(note) {
  return getNoteText(note).replace(/\s+/g, " ").trim();
}

function getTaskStats(note) {
  const total = note.checklist.length;
  const completed = note.checklist.filter(item => item.done).length;

  return {
    total,
    completed,
    percentage: total ? Math.round((completed / total) * 100) : 0
  };
}

function isReminderDue(note) {
  if (!note.reminderAt) return false;

  const time = new Date(note.reminderAt).getTime();

  return Number.isFinite(time) && time <= Date.now() && !note.trashed;
}

function getReminderFuture(note) {
  if (!note.reminderAt) return false;

  const time = new Date(note.reminderAt).getTime();

  return Number.isFinite(time) && time > Date.now();
}

function escapeAttr(value) {
  return escapeHTML(value);
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {
  clearTimeout(toastTimer);

  toast.textContent = message;
  toast.classList.add("show");

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}


/* =========================================================
   THEME
========================================================= */

function loadTheme() {
  const theme = localStorage.getItem(THEME_KEY);

  if (theme === "light") {
    document.body.classList.add("light");
  }
}

function toggleTheme() {
  document.body.classList.toggle("light");

  localStorage.setItem(
    THEME_KEY,
    document.body.classList.contains("light")
      ? "light"
      : "dark"
  );
}


/* =========================================================
   DATE / PAGE
========================================================= */

function updateDate() {
  const now = new Date();

  $("dateLabel").textContent =
    now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).toUpperCase();
}


/* =========================================================
   FILTERING
========================================================= */

function getFilteredNotes() {
  let result = [...state.notes];

  if (activeFilter === "notes") {
    result = result.filter(n =>
      n.type === "note" &&
      !n.archived &&
      !n.trashed
    );
  }

  if (activeFilter === "tasks") {
    result = result.filter(n =>
      n.type === "checklist" &&
      !n.archived &&
      !n.trashed
    );
  }

  if (activeFilter === "favorites") {
    result = result.filter(n =>
      n.favorite &&
      !n.archived &&
      !n.trashed
    );
  }

  if (activeFilter === "pinned") {
    result = result.filter(n =>
      n.pinned &&
      !n.archived &&
      !n.trashed
    );
  }

  if (activeFilter === "archive") {
    result = result.filter(n =>
      n.archived &&
      !n.trashed
    );
  }

  if (activeFilter === "trash") {
    result = result.filter(n => n.trashed);
  }

  if (activeFilter === "all") {
    result = result.filter(n =>
      !n.archived &&
      !n.trashed
    );
  }

  if (activeLabel) {
    result = result.filter(n => n.label === activeLabel);
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();

    result = result.filter(note => {
      const haystack = [
        note.title,
        getNoteText(note),
        note.label,
        note.type
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }

  result.sort((a, b) => {
    if (sortMode === "updated") {
      return b.updatedAt - a.updatedAt;
    }

    if (sortMode === "created") {
      return b.createdAt - a.createdAt;
    }

    if (sortMode === "az") {
      return a.title.localeCompare(b.title);
    }

    if (sortMode === "za") {
      return b.title.localeCompare(a.title);
    }

    if (sortMode === "reminder") {
      const ar = a.reminderAt
        ? new Date(a.reminderAt).getTime()
        : Infinity;

      const br = b.reminderAt
        ? new Date(b.reminderAt).getTime()
        : Infinity;

      return ar - br;
    }

    return b.updatedAt - a.updatedAt;
  });

  return result;
}


/* =========================================================
   RENDER
========================================================= */

function render() {
  renderStats();
  renderLabels();
  renderNotes();
  updatePageTitle();
}

function renderStats() {
  const active = state.notes.filter(n =>
    !n.archived && !n.trashed
  );

  $("noteCount").textContent =
    active.filter(n => n.type === "note").length;

  $("taskCount").textContent =
    active.filter(n => n.type === "checklist").length;

  $("favoriteCount").textContent =
    active.filter(n => n.favorite).length;
}

function renderLabels() {
  const container = $("labelFilters");

  const labels = [...new Set(
    state.notes
      .map(n => n.label)
      .filter(Boolean)
      .concat(state.labels || [])
  )];

  container.innerHTML = "";

  const allButton = document.createElement("button");
  allButton.className =
    "label-filter" + (!activeLabel ? " active" : "");
  allButton.textContent = "All";
  allButton.addEventListener("click", () => {
    activeLabel = "";
    render();
  });

  container.appendChild(allButton);

  labels.forEach(label => {
    const button = document.createElement("button");

    button.className =
      "label-filter" +
      (activeLabel === label ? " active" : "");

    button.textContent = label;

    button.addEventListener("click", () => {
      activeLabel = activeLabel === label ? "" : label;
      render();
    });

    container.appendChild(button);
  });
}

function renderNotes() {
  const notes = getFilteredNotes();

  notesGrid.innerHTML = "";

  $("resultCount").textContent = notes.length;

  if (!notes.length) {
    notesGrid.style.display = "none";
    emptyState.style.display = "block";

    setEmptyMessage();

    return;
  }

  notesGrid.style.display = "grid";
  emptyState.style.display = "none";

  notes.forEach((note, index) => {
    notesGrid.appendChild(createCard(note, index));
  });
}

function setEmptyMessage() {
  const messages = {
    all: [
      "Nothing here yet",
      "Create your first note and make this space yours."
    ],
    notes: [
      "No notes",
      "Create a note to start writing."
    ],
    tasks: [
      "No checklists",
      "Create a checklist to plan your work."
    ],
    favorites: [
      "No favorites",
      "Favorite important notes to find them quickly."
    ],
    pinned: [
      "Nothing pinned",
      "Pin important notes to keep them at the top."
    ],
    archive: [
      "Archive is empty",
      "Archived notes will appear here."
    ],
    trash: [
      "Trash is empty",
      "Deleted notes will appear here."
    ]
  };

  const message = messages[activeFilter] || messages.all;

  emptyTitle.textContent = message[0];
  emptyText.textContent = message[1];

  $("emptyCreateBtn").style.display =
    activeFilter === "trash" ||
    activeFilter === "archive"
      ? "none"
      : "inline-flex";
}

function updatePageTitle() {
  const titles = {
    all: "All notes",
    notes: "Notes",
    tasks: "Tasks",
    favorites: "Favorites",
    pinned: "Pinned",
    archive: "Archive",
    trash: "Trash"
  };

  $("collectionTitle").textContent =
    activeLabel
      ? activeLabel
      : titles[activeFilter] || "All notes";
}


/* =========================================================
   NOTE CARD
========================================================= */

function createCard(note, index) {
  const card = document.createElement("article");

  card.className =
    `note-card ${note.color || "default"}`;

  card.dataset.id = note.id;

  card.style.animationDelay = `${Math.min(index * 35, 250)}ms`;

  const title = note.title.trim() || "Untitled";

  const type = note.type === "checklist"
    ? "CHECKLIST"
    : "NOTE";

  let content = "";

  if (note.type === "checklist") {
    const stats = getTaskStats(note);

    const visibleItems = note.checklist.slice(0, 3);

    content = `
      <div class="task-preview">
        ${visibleItems.map(item => `
          <div class="task-row-mini ${item.done ? "done" : ""}">
            <span class="mini-check"></span>
            <span>${escapeHTML(item.text)}</span>
          </div>
        `).join("")}

        ${note.checklist.length > 3
          ? `<div class="card-meta" style="margin-top:8px">
              +${note.checklist.length - 3} more
             </div>`
          : ""}
      </div>
    `;
  } else {
    const safeHTML = sanitizeHTML(note.bodyHtml || "");

    content = `
      <div class="card-preview">
        ${safeHTML || escapeHTML(getPreview(note) || "Empty note")}
      </div>
    `;
  }

  const stats =
    note.type === "checklist"
      ? getTaskStats(note)
      : null;

  card.innerHTML = `
    <div class="card-top">
      <span class="card-type">${type}</span>

      <div class="card-actions">

        <button
          class="card-action"
          data-action="favorite"
          title="Favorite"
        >${note.favorite ? "★" : "☆"}</button>

        <button
          class="card-action"
          data-action="pin"
          title="Pin"
        >${note.pinned ? "⌖" : "◇"}</button>

        <button
          class="card-action"
          data-action="more"
          title="More"
        >•••</button>

      </div>
    </div>

    <h3 class="card-title">${escapeHTML(title)}</h3>

    ${content}

    <div class="card-footer">

      <div class="card-meta">
        ${formatDate(note.updatedAt)}
        ${note.reminderAt ? " · " + escapeHTML(formatReminder(note.reminderAt)) : ""}
      </div>

      <div class="card-badges">

        ${
          note.label
            ? `<span class="badge">${escapeHTML(note.label)}</span>`
            : ""
        }

        ${
          note.reminderAt
            ? `<span class="badge reminder-badge">
                ${isReminderDue(note) ? "Due" : "Reminder"}
               </span>`
            : ""
        }

        ${
          stats
            ? `
              <span class="badge">
                ${stats.completed}/${stats.total}
              </span>
              <span class="progress-mini">
                <span style="width:${stats.percentage}%"></span>
              </span>
            `
            : ""
        }

      </div>

    </div>
  `;

  card.addEventListener("click", event => {
    if (
      event.target.closest(".card-action")
    ) {
      return;
    }

    openEditor(note.id);
  });

  card.querySelector('[data-action="favorite"]')
    .addEventListener("click", event => {
      event.stopPropagation();
      toggleFavorite(note.id);
    });

  card.querySelector('[data-action="pin"]')
    .addEventListener("click", event => {
      event.stopPropagation();
      togglePin(note.id);
    });

  card.querySelector('[data-action="more"]')
    .addEventListener("click", event => {
      event.stopPropagation();
      openContextMenu(note.id, event.currentTarget);
    });

  addSwipe(card, note.id);

  return card;
}


/* =========================================================
   SWIPE
========================================================= */

function addSwipe(element, id) {
  let startX = 0;
  let startY = 0;

  element.addEventListener("touchstart", event => {
    const touch = event.changedTouches[0];

    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  element.addEventListener("touchend", event => {
    const touch = event.changedTouches[0];

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy)) {
      return;
    }

    if (dx > 0) {
      togglePin(id);
      showToast("Pin updated");
    } else {
      archiveNote(id);
      showToast("Moved to archive");
    }
  }, { passive: true });
}


/* =========================================================
   NOTE ACTIONS
========================================================= */

function findNote(id) {
  return state.notes.find(note => note.id === id);
}

function togglePin(id) {
  const note = findNote(id);

  if (!note) return;

  note.pinned = !note.pinned;
  note.updatedAt = Date.now();

  saveState(note);
  render();
}

function toggleFavorite(id) {
  const note = findNote(id);

  if (!note) return;

  note.favorite = !note.favorite;
  note.updatedAt = Date.now();

  saveState(note);
  render();

  showToast(
    note.favorite
      ? "Added to favorites"
      : "Removed from favorites"
  );
}

function archiveNote(id) {
  const note = findNote(id);

  if (!note) return;

  note.archived = true;
  note.trashed = false;
  note.updatedAt = Date.now();

  saveState(note);
  render();
}

function restoreNote(id) {
  const note = findNote(id);

  if (!note) return;

  note.trashed = false;
  note.archived = false;
  note.updatedAt = Date.now();

  saveState(note);
  render();

  showToast("Note restored");
}

function restoreArchive(id) {
  const note = findNote(id);

  if (!note) return;

  note.archived = false;
  note.updatedAt = Date.now();

  saveState(note);
  render();

  showToast("Note restored");
}

function duplicateNote(id) {
  const original = findNote(id);

  if (!original) return;

  const copy = normalizeNote({
    ...original,
    id: cryptoRandomId(),
    title: original.title
      ? `${original.title} Copy`
      : "Untitled Copy",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    favorite: false,
    archived: false,
    trashed: false,
    reminderNotified: false,

    checklist: original.checklist.map(item => ({
      ...item,
      id: cryptoRandomId()
    }))
  });

  state.notes.unshift(copy);

  saveState(note);
  render();

  showToast("Note duplicated");
}

function moveToTrash(id) {
  const note = findNote(id);

  if (!note) return;

  undoData = {
    id,
    previous: {
      trashed: note.trashed,
      archived: note.archived
    }
  };

  note.trashed = true;
  note.archived = false;
  note.updatedAt = Date.now();

  saveState(note);
  render();

  showUndo();
}

function permanentlyDelete(id) {
  state.notes = state.notes.filter(note => note.id !== id);

  saveState();
  render();

  showToast("Deleted permanently");
}

function emptyTrash() {
  state.notes = state.notes.filter(note => !note.trashed);

  saveState(note);
  render();

  showToast("Trash emptied");
}


/* =========================================================
   UNDO
========================================================= */

function showUndo() {
  undoBar.classList.add("show");

  setTimeout(() => {
    undoBar.classList.remove("show");
    undoData = null;
  }, 4500);
}

$("undoBtn").addEventListener("click", () => {
  if (!undoData) return;

  const note = findNote(undoData.id);

  if (note) {
    note.trashed = undoData.previous.trashed;
    note.archived = undoData.previous.archived;

    saveState(note);
    render();
  }

  undoData = null;
  undoBar.classList.remove("show");

  showToast("Restored");
});


/* =========================================================
   CONTEXT MENU
========================================================= */

function openContextMenu(id, target) {
  const note = findNote(id);

  if (!note) return;

  contextNoteId = id;

  contextMenu.innerHTML = "";

  const actions = [];

  if (note.trashed) {
    actions.push({
      label: "Restore",
      action: "restore"
    });

    actions.push({
      label: "Delete permanently",
      action: "permanent-delete",
      danger: true
    });
  } else if (note.archived) {
    actions.push({
      label: "Restore from archive",
      action: "restore-archive"
    });

    actions.push({
      label: "Delete",
      action: "delete",
      danger: true
    });
  } else {
    actions.push({
      label: "Edit",
      action: "edit"
    });

    actions.push({
      label: note.favorite
        ? "Remove favorite"
        : "Add favorite",
      action: "favorite"
    });

    actions.push({
      label: note.pinned
        ? "Unpin"
        : "Pin",
      action: "pin"
    });

    actions.push({
      label: "Duplicate",
      action: "duplicate"
    });

    actions.push({
      label: "Share / copy",
      action: "share"
    });

    actions.push({
      label: "Archive",
      action: "archive"
    });

    actions.push({
      label: "Move to trash",
      action: "delete",
      danger: true
    });
  }

  actions.forEach(item => {
    const button = document.createElement("button");

    if (item.danger) {
      button.classList.add("danger");
    }

    button.textContent = item.label;

    button.addEventListener("click", () => {
      closeContextMenu();
      handleContextAction(item.action, id);
    });

    contextMenu.appendChild(button);
  });

  const rect = target.getBoundingClientRect();

  const width = 185;

  let left = rect.right - width;
  let top = rect.bottom + 7;

  if (left < 10) left = 10;

  if (left + width > window.innerWidth - 10) {
    left = window.innerWidth - width - 10;
  }

  if (top + 300 > window.innerHeight) {
    top = rect.top - 300;
  }

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${Math.max(10, top)}px`;

  contextMenu.classList.add("open");
}

function closeContextMenu() {
  contextMenu.classList.remove("open");
  contextNoteId = null;
}

function handleContextAction(action, id) {
  switch (action) {
    case "edit":
      openEditor(id);
      break;

    case "favorite":
      toggleFavorite(id);
      break;

    case "pin":
      togglePin(id);
      break;

    case "duplicate":
      duplicateNote(id);
      break;

    case "share":
      shareNote(id);
      break;

    case "archive":
      archiveNote(id);
      showToast("Moved to archive");
      break;

    case "delete":
      moveToTrash(id);
      break;

    case "restore":
      restoreNote(id);
      break;

    case "restore-archive":
      restoreArchive(id);
      break;

    case "permanent-delete":
      askDialog(
        "Delete permanently?",
        "This note cannot be recovered after permanent deletion.",
        () => permanentlyDelete(id)
      );
      break;
  }
}


/* =========================================================
   SHARE
========================================================= */

async function shareNote(id) {
  const note = findNote(id);

  if (!note) return;

  const text = buildShareText(note);

  try {
    if (navigator.share) {
      await navigator.share({
        title: note.title || "Notely note",
        text
      });

      return;
    }

    await navigator.clipboard.writeText(text);

    showToast("Copied to clipboard");
  } catch (error) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Could not share note");
    }
  }
}

function buildShareText(note) {
  let output = note.title || "Untitled";

  output += "\n\n";

  if (note.type === "checklist") {
    output += note.checklist
      .map(item =>
        `${item.done ? "✓" : "□"} ${item.text}`
      )
      .join("\n");
  } else {
    output += stripHTML(note.bodyHtml || "");
  }

  if (note.label) {
    output += `\n\nLabel: ${note.label}`;
  }

  return output.trim();
}


/* =========================================================
   EDITOR
========================================================= */

function openEditor(id = null, type = "note") {
  closeCreateMenu();
  closeMenu();
  closeContextMenu();

  editingId = id;

  if (id) {
    const note = findNote(id);

    if (!note) return;

    editorMode = note.type;

    loadNoteIntoEditor(note);
  } else {
    editorMode = type;

    loadNewEditor(type);
  }

  editor.classList.add("open");
  overlay.classList.add("open");

  document.body.style.overflow = "hidden";

  setTimeout(() => {
    if (editorMode === "note") {
      noteTitle.focus();
    } else {
      noteTitle.focus();
    }
  }, 350);
}

function loadNewEditor(type) {
  noteTitle.value = "";
  noteLabel.value = "";
  noteReminder.value = "";

  $("editorMode").textContent =
    type === "checklist" ? "CHECKLIST" : "NOTE";

  $("editorFavorite").classList.remove("active");
  $("editorFavorite").textContent = "☆";

  $("editorPin").classList.remove("active");
  $("editorPin").textContent = "◇";

  selectEditorColor("default");

  richEditor.innerHTML = "";

  checklistItems = [];

  if (type === "checklist") {
    richEditorWrapHide();
    checklistEditor.classList.add("visible");
    renderChecklistEditor();
  } else {
    richEditorWrapShow();
    checklistEditor.classList.remove("visible");
  }

  $("createdInfo").textContent = "New note";

  editorDirty = false;

  editorOriginalSnapshot = getEditorSnapshot();

  updateEditorCounters();
  updateAutosaveStatus("Ready");
}

function loadNoteIntoEditor(note) {
  noteTitle.value = note.title || "";
  noteLabel.value = note.label || "";
  noteReminder.value = note.reminderAt || "";

  $("editorMode").textContent =
    note.type === "checklist"
      ? "CHECKLIST"
      : "NOTE";

  $("editorFavorite").classList.toggle(
    "active",
    note.favorite
  );

  $("editorFavorite").textContent =
    note.favorite ? "★" : "☆";

  $("editorPin").classList.toggle(
    "active",
    note.pinned
  );

  $("editorPin").textContent =
    note.pinned ? "⌖" : "◇";

  selectEditorColor(note.color || "default");

  if (note.type === "checklist") {
    richEditorWrapHide();
    checklistEditor.classList.add("visible");

    checklistItems = note.checklist.map(item => ({
      id: item.id,
      text: item.text,
      done: item.done
    }));

    renderChecklistEditor();
  } else {
    richEditorWrapShow();
    checklistEditor.classList.remove("visible");

    richEditor.innerHTML =
      sanitizeHTML(
        note.bodyHtml ||
        escapeHTML(note.body || "").replace(/\n/g, "<br>")
      );
  }

  $("createdInfo").textContent =
    `Created ${formatFullDate(note.createdAt)}`;

  editorDirty = false;

  editorOriginalSnapshot = getEditorSnapshot();

  updateEditorCounters();
  updateAutosaveStatus("Saved");
}

function richEditorWrapShow() {
  $("richEditorWrap").style.display = "block";
}

function richEditorWrapHide() {
  $("richEditorWrap").style.display = "none";
}

function closeEditor() {
  if (!editor.classList.contains("open")) {
    return;
  }

  if (editorDirty) {
    $("unsavedDialog").classList.add("open");
    return;
  }

  actuallyCloseEditor();
}

function actuallyCloseEditor() {
  editor.classList.remove("open");
  overlay.classList.remove("open");

  document.body.style.overflow = "";

  editingId = null;
  checklistItems = [];

  clearDraft();

  $("unsavedDialog").classList.remove("open");
}

function getEditorSnapshot() {
  return JSON.stringify({
    mode: editorMode,
    title: noteTitle.value,
    bodyHtml: sanitizeHTML(richEditor.innerHTML),
    checklist: checklistItems,
    color: getSelectedColor(),
    label: noteLabel.value,
    reminderAt: noteReminder.value,
    favorite: $("editorFavorite").classList.contains("active"),
    pinned: $("editorPin").classList.contains("active")
  });
}

function markEditorDirty() {
  editorDirty = getEditorSnapshot() !== editorOriginalSnapshot;

  if (editorDirty) {
    updateAutosaveStatus("Unsaved");

    scheduleAutosave();
  } else {
    updateAutosaveStatus("Saved");
  }

  updateEditorCounters();
}

function updateAutosaveStatus(text) {
  $("autosaveStatus").textContent = text;
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);

  autosaveTimer = setTimeout(() => {
    if (!editorDirty) return;

    saveDraft();

    updateAutosaveStatus("Draft saved");
  }, 650);
}

function saveDraft() {
  const draft = {
    mode: editorMode,
    editingId,
    snapshot: getEditorSnapshot(),
    savedAt: Date.now()
  };

  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify(draft)
  );
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}


/* =========================================================
   SAVE
========================================================= */

function saveEditor(closeAfter = false) {
  const title = noteTitle.value.trim();

  const bodyHTML =
    sanitizeHTML(richEditor.innerHTML);

  const bodyText =
    stripHTML(bodyHTML).trim();

  const label = noteLabel.value.trim();
  const reminderAt = noteReminder.value;

  if (
    editorMode === "note" &&
    !title &&
    !bodyText
  ) {
    showToast("Add a title or some content first");
    return;
  }

  if (
    editorMode === "checklist" &&
    !title &&
    checklistItems.length === 0
  ) {
    showToast("Add a title or task first");
    return;
  }

  let note;

  if (editingId) {
    note = findNote(editingId);

    if (!note) return;
  } else {
    note = normalizeNote({
      id: cryptoRandomId(),
      type: editorMode,
      title: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    state.notes.unshift(note);
    editingId = note.id;
  }

  note.type = editorMode;
  note.title = title;
  note.label = label;
  note.reminderAt = reminderAt;
  note.color = getSelectedColor();

  note.favorite =
    $("editorFavorite").classList.contains("active");

  note.pinned =
    $("editorPin").classList.contains("active");

  note.updatedAt = Date.now();

  if (editorMode === "note") {
    note.bodyHtml = bodyHTML;
    note.body = bodyText;
    note.checklist = [];
  } else {
    note.checklist = checklistItems.map(item => ({
      id: item.id,
      text: item.text.trim(),
      done: Boolean(item.done)
    })).filter(item => item.text);

    note.body = "";
    note.bodyHtml = "";
  }

  saveState(note);

  editorDirty = false;
  editorOriginalSnapshot = getEditorSnapshot();

  clearDraft();

  updateAutosaveStatus("Saved");

  render();

  if (closeAfter) {
    actuallyCloseEditor();
  } else {
    showToast("Saved");
  }
}


/* =========================================================
   COLORS
========================================================= */

function getSelectedColor() {
  const selected =
    document.querySelector(".color-dot.active");

  return selected
    ? selected.dataset.color
    : "default";
}

function selectEditorColor(color) {
  document.querySelectorAll(".color-dot")
    .forEach(dot => {
      dot.classList.toggle(
        "active",
        dot.dataset.color === color
      );
    });
}


/* =========================================================
   FAVORITE / PIN FROM EDITOR
========================================================= */

$("editorFavorite").addEventListener("click", () => {
  const active =
    $("editorFavorite").classList.toggle("active");

  $("editorFavorite").textContent =
    active ? "★" : "☆";

  markEditorDirty();
});

$("editorPin").addEventListener("click", () => {
  const active =
    $("editorPin").classList.toggle("active");

  $("editorPin").textContent =
    active ? "⌖" : "◇";

  markEditorDirty();
});


/* =========================================================
   CHECKLIST
========================================================= */

function renderChecklistEditor() {
  checklistItemsEl.innerHTML = "";

  const items = showCompleted
    ? checklistItems
    : checklistItems.filter(item => !item.done);

  items.forEach(item => {
    const row = document.createElement("div");

    row.className =
      `check-item ${item.done ? "done" : ""}`;

    row.dataset.id = item.id;

    row.innerHTML = `
      <button class="check-item-check" aria-label="Toggle task"></button>

      <input
        class="check-item-text"
        value="${escapeAttr(item.text)}"
        maxlength="300"
      >

      <div class="check-item-actions">
        <button data-move="up" title="Move up">↑</button>
        <button data-move="down" title="Move down">↓</button>
        <button data-remove="true" title="Delete">×</button>
      </div>
    `;

    row.querySelector(".check-item-check")
      .addEventListener("click", () => {
        toggleChecklistItem(item.id);
      });

    row.querySelector(".check-item-text")
      .addEventListener("input", event => {
        const current = checklistItems.find(
          x => x.id === item.id
        );

        if (!current) return;

        current.text = event.target.value;

        markEditorDirty();
      });

    row.querySelector('[data-move="up"]')
      .addEventListener("click", () => {
        moveChecklistItem(item.id, -1);
      });

    row.querySelector('[data-move="down"]')
      .addEventListener("click", () => {
        moveChecklistItem(item.id, 1);
      });

    row.querySelector("[data-remove]")
      .addEventListener("click", () => {
        checklistItems =
          checklistItems.filter(x => x.id !== item.id);

        renderChecklistEditor();
        markEditorDirty();
      });

    checklistItemsEl.appendChild(row);
  });

  updateChecklistProgress();
}

function addChecklistItem() {
  const input = $("checkInput");
  const text = input.value.trim();

  if (!text) return;

  checklistItems.push({
    id: cryptoRandomId(),
    text,
    done: false
  });

  input.value = "";

  renderChecklistEditor();
  markEditorDirty();

  input.focus();
}

function toggleChecklistItem(id) {
  const item = checklistItems.find(
    x => x.id === id
  );

  if (!item) return;

  item.done = !item.done;

  renderChecklistEditor();
  markEditorDirty();
}

function moveChecklistItem(id, direction) {
  const index = checklistItems.findIndex(
    x => x.id === id
  );

  if (index < 0) return;

  const next = index + direction;

  if (next < 0 || next >= checklistItems.length) {
    return;
  }

  [
    checklistItems[index],
    checklistItems[next]
  ] = [
    checklistItems[next],
    checklistItems[index]
  ];

  renderChecklistEditor();
  markEditorDirty();
}

function updateChecklistProgress() {
  const total = checklistItems.length;

  const completed =
    checklistItems.filter(item => item.done).length;

  const percent =
    total
      ? Math.round((completed / total) * 100)
      : 0;

  $("checkProgress").textContent =
    `${percent}%`;

  $("progressBar").style.width =
    `${percent}%`;

  $("showCompletedBtn").textContent =
    showCompleted
      ? "Hide completed"
      : "Show completed";
}

$("addCheckBtn").addEventListener(
  "click",
  addChecklistItem
);

$("checkInput").addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addChecklistItem();
    }
  }
);

$("clearCompletedBtn").addEventListener("click", () => {
  const before = checklistItems.length;

  checklistItems =
    checklistItems.filter(item => !item.done);

  if (before !== checklistItems.length) {
    renderChecklistEditor();
    markEditorDirty();
  }
});

$("showCompletedBtn").addEventListener("click", () => {
  showCompleted = !showCompleted;
  renderChecklistEditor();
});


/* =========================================================
   RICH TEXT
========================================================= */

document.querySelectorAll(
  ".format-toolbar button"
).forEach(button => {
  button.addEventListener("mousedown", event => {
    event.preventDefault();
  });

  button.addEventListener("click", () => {
    const command = button.dataset.command;
    const value = button.dataset.value || null;

    richEditor.focus();

    try {
      document.execCommand(
        command,
        false,
        value
      );
    } catch (error) {
      console.warn("Formatting command failed:", error);
    }

    markEditorDirty();
  });
});

richEditor.addEventListener("input", markEditorDirty);

richEditor.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    document.execCommand("bold");
    markEditorDirty();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
    event.preventDefault();
    document.execCommand("italic");
    markEditorDirty();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
    event.preventDefault();
    document.execCommand("underline");
    markEditorDirty();
  }
});


/* =========================================================
   EDITOR INPUTS
========================================================= */

noteTitle.addEventListener("input", markEditorDirty);
noteLabel.addEventListener("change", markEditorDirty);
noteReminder.addEventListener("change", markEditorDirty);

document.querySelectorAll(".color-dot")
  .forEach(dot => {
    dot.addEventListener("click", () => {
      selectEditorColor(dot.dataset.color);
      markEditorDirty();
    });
  });

function updateEditorCounters() {
  const text =
    editorMode === "checklist"
      ? checklistItems.map(x => x.text).join(" ")
      : stripHTML(richEditor.innerHTML);

  const trimmed =
    text.trim();

  const words =
    trimmed
      ? trimmed.split(/\s+/).length
      : 0;

  $("wordCount").textContent =
    `${words} ${words === 1 ? "word" : "words"}`;

  $("charCount").textContent =
    `${text.length} characters`;
}


/* =========================================================
   DELETE FROM EDITOR
========================================================= */

$("deleteFromEditor").addEventListener("click", () => {
  if (!editingId) {
    actuallyCloseEditor();
    return;
  }

  const id = editingId;

  actuallyCloseEditor();

  moveToTrash(id);
});


/* =========================================================
   CUSTOM DIALOG
========================================================= */

let dialogCallback = null;

function askDialog(title, text, callback) {
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;

  dialogCallback = callback;

  $("dialogLayer").classList.add("open");
}

function closeDialog() {
  $("dialogLayer").classList.remove("open");
  dialogCallback = null;
}

$("dialogCancel").addEventListener(
  "click",
  closeDialog
);

$("dialogConfirm").addEventListener(
  "click",
  () => {
    const callback = dialogCallback;

    closeDialog();

    if (callback) callback();
  }
);


/* =========================================================
   UNSAVED CHANGES
========================================================= */

$("saveAndCloseBtn").addEventListener(
  "click",
  () => {
    $("unsavedDialog").classList.remove("open");
    saveEditor(true);
  }
);

$("discardAndCloseBtn").addEventListener(
  "click",
  () => {
    $("unsavedDialog").classList.remove("open");
    editorDirty = false;
    clearDraft();
    actuallyCloseEditor();
  }
);

$("keepEditingBtn").addEventListener(
  "click",
  () => {
    $("unsavedDialog").classList.remove("open");
  }
);


/* =========================================================
   LABEL CREATION
========================================================= */

$("addLabelBtn").addEventListener("click", () => {
  $("newLabelInput").value = "";
  $("labelDialog").classList.add("open");

  setTimeout(() => {
    $("newLabelInput").focus();
  }, 100);
});

$("labelCancel").addEventListener("click", () => {
  $("labelDialog").classList.remove("open");
});

$("labelConfirm").addEventListener("click", createLabel);

$("newLabelInput").addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      event.preventDefault();
      createLabel();
    }
  }
);

function createLabel() {
  const value =
    $("newLabelInput").value.trim();

  if (!value) return;

  const existing =
    state.labels.find(
      label => label.toLowerCase() === value.toLowerCase()
    );

  if (!existing) {
    state.labels.push(value);
    saveState();
  }

  renderLabelSelect();

  noteLabel.value = value;

  $("labelDialog").classList.remove("open");

  markEditorDirty();

  showToast("Label added");
}

function renderLabelSelect() {
  const current = noteLabel.value;

  noteLabel.innerHTML = `
    <option value="">No label</option>
  `;

  state.labels.forEach(label => {
    const option =
      document.createElement("option");

    option.value = label;
    option.textContent = label;

    noteLabel.appendChild(option);
  });

  noteLabel.value = current;
}


/* =========================================================
   CREATE MENU
========================================================= */

function openCreateMenu() {
  $("createMenu").classList.toggle("open");
}

function closeCreateMenu() {
  $("createMenu").classList.remove("open");
}

$("fab").addEventListener(
  "click",
  event => {
    event.stopPropagation();
    openCreateMenu();
  }
);

document.querySelectorAll(
  "[data-create]"
).forEach(button => {
  button.addEventListener("click", () => {
    const type = button.dataset.create;

    closeCreateMenu();

    openEditor(null, type);
  });
});

$("emptyCreateBtn").addEventListener(
  "click",
  () => openEditor(null, "note")
);


/* =========================================================
   SEARCH
========================================================= */

$("searchBtn").addEventListener("click", () => {
  $("searchPanel").classList.toggle("open");

  if ($("searchPanel").classList.contains("open")) {
    setTimeout(() => {
      $("searchInput").focus();
    }, 100);
  }
});

$("searchInput").addEventListener(
  "input",
  event => {
    searchTerm =
      event.target.value.trim();

    renderNotes();
  }
);

$("clearSearch").addEventListener(
  "click",
  () => {
    $("searchInput").value = "";
    searchTerm = "";
    renderNotes();
    $("searchInput").focus();
  }
);


/* =========================================================
   SORT
========================================================= */

$("sortBtn").addEventListener(
  "click",
  event => {
    event.stopPropagation();

    $("sortMenu").classList.toggle("open");
  }
);

document.querySelectorAll(
  "#sortMenu button"
).forEach(button => {
  button.addEventListener("click", () => {
    sortMode = button.dataset.sort;

    const labels = {
      updated: "Recent",
      created: "Created",
      az: "A → Z",
      za: "Z → A",
      reminder: "Reminder"
    };

    $("sortLabel").textContent =
      labels[sortMode] || "Recent";

    $("sortMenu").classList.remove("open");

    renderNotes();
  });
});


/* =========================================================
   FILTER TABS
========================================================= */

document.querySelectorAll(
  ".tab"
).forEach(tab => {
  tab.addEventListener("click", () => {
    setFilter(tab.dataset.filter);
  });
});

document.querySelectorAll(
  ".side-item[data-filter]"
).forEach(item => {
  item.addEventListener("click", () => {
    setFilter(item.dataset.filter);
    closeMenu();
  });
});

function setFilter(filter) {
  activeFilter = filter;
  activeLabel = "";

  document.querySelectorAll(".tab")
    .forEach(tab => {
      tab.classList.toggle(
        "active",
        tab.dataset.filter === filter
      );
    });

  document.querySelectorAll(
    ".side-item[data-filter]"
  ).forEach(item => {
    item.classList.toggle(
      "active",
      item.dataset.filter === filter
    );
  });

  render();
}


/* =========================================================
   SIDE MENU
========================================================= */

function openMenu() {
  $("sideMenu").classList.add("open");
  overlay.classList.add("open");
}

function closeMenu() {
  $("sideMenu").classList.remove("open");

  if (!editor.classList.contains("open")) {
    overlay.classList.remove("open");
  }
}

$("menuBtn").addEventListener("click", openMenu);
$("closeMenu").addEventListener("click", closeMenu);


/* =========================================================
   OVERLAY
========================================================= */

overlay.addEventListener("click", () => {
  if (editor.classList.contains("open")) {
    closeEditor();
    return;
  }

  closeMenu();
  closeCreateMenu();
  closeContextMenu();
});


/* =========================================================
   EDITOR BUTTONS
========================================================= */

$("editorClose").addEventListener(
  "click",
  closeEditor
);

$("saveBtn").addEventListener(
  "click",
  () => saveEditor(false)
);


/* =========================================================
   THEME
========================================================= */

$("themeBtn").addEventListener(
  "click",
  toggleTheme
);

$("sideThemeBtn").addEventListener(
  "click",
  () => {
    toggleTheme();
    closeMenu();
  }
);


/* =========================================================
   EXPORT
========================================================= */

$("exportBtn").addEventListener(
  "click",
  exportData
);

function exportData() {
  const backup = {
    app: "Notely",
    version: 2,
    exportedAt: new Date().toISOString(),
    data: state
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  const date =
    new Date()
      .toISOString()
      .slice(0, 10);

  anchor.href = url;
  anchor.download = `notely-backup-${date}.json`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);

  showToast("Backup exported");
}


/* =========================================================
   IMPORT
========================================================= */

$("importBtn").addEventListener(
  "click",
  () => $("importFile").click()
);

$("importFile").addEventListener(
  "change",
  async event => {
    const file = event.target.files[0];

    if (!file) return;

    try {
      const text =
        await file.text();

      const parsed =
        JSON.parse(text);

      const imported =
        parsed.data || parsed;

      if (
        !imported ||
        !Array.isArray(imported.notes)
      ) {
        throw new Error("Invalid backup");
      }

      askDialog(
        "Import backup?",
        "Importing will replace the current local Notely data.",
        () => {
          state = {
            notes: imported.notes.map(normalizeNote),
            labels:
              Array.isArray(imported.labels)
                ? imported.labels
                : ["School", "Personal", "Ideas"],
            version: 2
          };

          saveState();
          render();
          renderLabelSelect();

          showToast("Backup imported");
        }
      );

    } catch (error) {
      console.error(error);
      showToast("Invalid backup file");
    }

    event.target.value = "";
  }
);


/* =========================================================
   CLEAR ALL
========================================================= */

$("clearAllBtn").addEventListener(
  "click",
  () => {
    askDialog(
      "Clear all data?",
      "This will permanently remove every note, checklist and label from this device.",
      () => {
        state = defaultState();

        saveState();
        render();
        renderLabelSelect();

        closeMenu();

        showToast("All data cleared");
      }
    );
  }
);


/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    if (editor.classList.contains("open")) {
      event.preventDefault();
      saveEditor(false);
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();

    $("searchPanel").classList.add("open");

    setTimeout(() => {
      $("searchInput").focus();
    }, 50);
  }

  if (event.key === "Escape") {
    if ($("contextMenu").classList.contains("open")) {
      closeContextMenu();
      return;
    }

    if ($("sortMenu").classList.contains("open")) {
      $("sortMenu").classList.remove("open");
      return;
    }

    if ($("createMenu").classList.contains("open")) {
      closeCreateMenu();
      return;
    }

    if ($("unsavedDialog").classList.contains("open")) {
      $("unsavedDialog").classList.remove("open");
      return;
    }

    if ($("dialogLayer").classList.contains("open")) {
      closeDialog();
      return;
    }

    if ($("labelDialog").classList.contains("open")) {
      $("labelDialog").classList.remove("open");
      return;
    }

    if (editor.classList.contains("open")) {
      closeEditor();
      return;
    }

    closeMenu();
  }
});


/* =========================================================
   GLOBAL CLICK
========================================================= */

document.addEventListener("click", event => {
  if (
    !event.target.closest(".context-menu") &&
    !event.target.closest('[data-action="more"]')
  ) {
    closeContextMenu();
  }

  if (
    !event.target.closest(".sort-menu") &&
    !event.target.closest("#sortBtn")
  ) {
    $("sortMenu").classList.remove("open");
  }

  if (
    !event.target.closest(".create-menu") &&
    !event.target.closest("#fab")
  ) {
    closeCreateMenu();
  }
});


/* =========================================================
   REMINDER CHECK
========================================================= */

function checkReminders() {
  let changed = false;

  state.notes.forEach(note => {
    if (!note.reminderAt) return;

    if (
      isReminderDue(note) &&
      !note.reminderNotified
    ) {
      note.reminderNotified = true;
      changed = true;

      showToast(
        `Reminder: ${note.title || "Untitled note"}`
      );
    }
  });

  if (changed) {
    saveState();
    render();
  }
}


/* =========================================================
   DRAFT RECOVERY
========================================================= */

function checkDraftRecovery() {
  try {
    const raw =
      localStorage.getItem(DRAFT_KEY);

    if (!raw) return;

    const draft =
      JSON.parse(raw);

    if (!draft || !draft.snapshot) {
      clearDraft();
      return;
    }

    const age =
      Date.now() - Number(draft.savedAt || 0);

    if (age > 24 * 60 * 60 * 1000) {
      clearDraft();
    }
  } catch {
    clearDraft();
  }
}


/* =========================================================
   INITIALIZE
========================================================= */

function initialize() {
  loadTheme();
  updateDate();

  renderLabelSelect();
  render();

  checkReminders();
  checkDraftRecovery();

  setInterval(checkReminders, 30000);
}

initialize();
