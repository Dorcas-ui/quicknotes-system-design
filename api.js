"use strict";

// Base URL of the practice API (JSONPlaceholder).
// The real QuickNotes API that the backend team will build is described in docs/api-design.md.
const API_URL = "https://jsonplaceholder.typicode.com/posts";

const MAX_TITLE_LENGTH = 100;

const loadBtn = document.getElementById("load-btn");
const statusEl = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title-input");
const bodyInput = document.getElementById("body-input");
const submitBtn = document.getElementById("submit-btn");

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
  submitBtn.disabled = busy;
  notesList.querySelectorAll(".delete-btn").forEach((button) => {
    button.disabled = busy;
  });
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

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.disabled = isBusy;
  deleteBtn.setAttribute("aria-label", `Delete note: ${note.title}`);

  item.dataset.id = note.id;
  item.append(title, body, deleteBtn);
  return item;
}

function showEmptyState() {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = "No notes to show yet. Click \"Load notes\" to fetch some.";
  notesList.append(item);
}

// Adds one note at the top of the list (and removes the empty-state message).
function addNoteToTop(note) {
  const emptyItem = notesList.querySelector(".empty");
  if (emptyItem) {
    emptyItem.remove();
  }
  notesList.prepend(createNoteItem(note));
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

/* ---------- POST: create a note ---------- */

// Returns an error message, or "" when the title is valid.
function validateTitle(title) {
  if (title.length === 0) {
    return "Please enter a title for your note.";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `The title must be ${MAX_TITLE_LENGTH} characters or fewer (it is ${title.length}).`;
  }
  return "";
}

async function createNote(event) {
  event.preventDefault();
  if (isBusy) {
    return;
  }

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim(); // the body is optional

  const problem = validateTitle(title);
  if (problem) {
    titleInput.setAttribute("aria-invalid", "true");
    showStatus(problem, "error");
    titleInput.focus();
    return;
  }
  titleInput.removeAttribute("aria-invalid");

  setBusy(true);
  showStatus("Saving your note...", "loading");

  try {
    const { status, data } = await request(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, userId: 1 }),
    });

    addNoteToTop(data);
    noteForm.reset();
    showStatus(`Note created (status ${status}, id ${data.id}).`, "success");
  } catch (error) {
    console.error(error);
    showStatus(friendlyError("create the note", error), "error");
  } finally {
    setBusy(false);
  }
}

/* ---------- DELETE: remove a note ---------- */

// IMPORTANT: JSONPlaceholder is a fake API. It accepts POST and DELETE requests and
// answers with realistic status codes, but it never really stores or removes anything.
//   - A note we "create" is not saved: the server only returns it with a made-up id
//     (always 101), so every new note has the same id.
//   - A DELETE returns 200 even though nothing changes on the server.
// To keep the page behaving like a real app, our approach is:
//   1. Send the DELETE request and wait for a successful response.
//   2. Only then remove that note from the list on the page.
//   3. Remove the note by its <li> element, not by id, because several new notes can
//      share the id 101 and we must delete only the one the user clicked.
// Because nothing is saved, clicking "Load notes" again brings back the original ten
// notes, and notes created in this session disappear. A real backend would persist both.
async function deleteNote(item) {
  if (isBusy) {
    return;
  }

  setBusy(true);
  showStatus("Deleting note...", "loading");

  try {
    const { status } = await request(`${API_URL}/${item.dataset.id}`, {
      method: "DELETE",
    });

    item.remove();
    if (notesList.children.length === 0) {
      showEmptyState();
    }
    showStatus(`Note deleted (status ${status}).`, "success");
  } catch (error) {
    console.error(error);
    showStatus(friendlyError("delete the note", error), "error");
  } finally {
    setBusy(false);
  }
}

// One listener on the list handles every Delete button (event delegation).
function handleListClick(event) {
  const button = event.target.closest(".delete-btn");
  if (button) {
    deleteNote(button.closest(".note"));
  }
}

/* ---------- Start-up ---------- */

loadBtn.addEventListener("click", loadNotes);
noteForm.addEventListener("submit", createNote);
notesList.addEventListener("click", handleListClick);
renderNotes([]); // show the empty state before anything is loaded
