"use strict";

// Base URL of the practice API (JSONPlaceholder).
// The real QuickNotes API that the backend team will build is described in docs/api-design.md.
const API_URL = "https://jsonplaceholder.typicode.com/posts";

const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");

let isBusy = false;

/* ---------- Status messages ---------- */

// type is "loading", "success" or "error" (it becomes a CSS class).
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type || "";
}

// Disable the buttons while a request is running so nothing is sent twice.
function setBusy(busy) {
  isBusy = busy;
  loadBtn.disabled = busy;
}

/* ---------- Reusable request helper ---------- */

// Calls fetch, checks response.ok and throws on HTTP errors.
// Network failures make fetch itself throw, so callers use try / catch.
async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

// Turns a technical error into a message a user can understand.
function friendlyError(action, error) {
  if (error instanceof SyntaxError) {
    return `Could not ${action}: the server sent a response we could not read.`;
  }
  if (error.status >= 500) {
    return `Could not ${action}: the server had a problem. Please try again later.`;
  }
  if (error.status === 404) {
    return `Could not ${action}: the server could not find it.`;
  }
  if (error.status) {
    return `Could not ${action} (status ${error.status}).`;
  }
  return `Could not ${action}. Please check your internet connection and try again.`;
}

/* ---------- Rendering ---------- */

// User text is always inserted with textContent, never innerHTML.
function createNoteItem(note) {
  const item = document.createElement("li");
  item.className = "note";

  const title = document.createElement("h3");
  title.textContent = note.title;

  const body = document.createElement("p");
  body.textContent = note.body || "";

  item.append(title, body);
  return item;
}

function showEmptyState() {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = "No notes to show yet. Click \"Load notes\" to fetch some.";
  notesList.append(item);
}

function renderNotes(notes) {
  notesList.replaceChildren();
  if (notes.length === 0) {
    showEmptyState();
    return;
  }
  notes.forEach((note) => notesList.append(createNoteItem(note)));
}

/* ---------- GET: load notes ---------- */

async function loadNotes() {
  setBusy(true);
  showStatus("Loading notes...", "loading");

  try {
    const { data } = await request(`${API_URL}?_limit=10`);
    if (!Array.isArray(data)) {
      throw new SyntaxError("Expected a list of notes");
    }

    renderNotes(data);
    if (data.length === 0) {
      showStatus("The server has no notes yet.", "success");
    } else {
      const word = data.length === 1 ? "note" : "notes";
      showStatus(`Loaded ${data.length} ${word} from the server.`, "success");
    }
  } catch (error) {
    console.error(error);
    showStatus(friendlyError("load notes", error), "error");
  } finally {
    setBusy(false);
  }
}

/* ---------- Start-up ---------- */

loadBtn.addEventListener("click", loadNotes);
renderNotes([]); // show the empty state before anything is loaded
