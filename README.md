# QuickNotes System Design

## Description

QuickNotes is a notes app that is moving from a browser-only app to a real online service for 1 million users. This repository has two parts:

1. **A browser API client** (`index.html`, `api.js`, `style.css`) that proves the front end can talk to an API. It uses the JSONPlaceholder practice API to **load** (GET), **create** (POST) and **delete** (DELETE) notes. It shows loading, success, error and empty states, validates the title (required, maximum 100 characters), disables buttons while a request is running, and inserts user text with `textContent` only.
2. **Design documents** for the real backend that the engineering team will build: the REST API, the database model and the system architecture.

## How to run the API client

The client is plain HTML, CSS and JavaScript, so there is nothing to install. It needs an internet connection because it calls `https://jsonplaceholder.typicode.com/posts`.

**Option 1: open the file**

1. Download or clone this repository.
2. Double-click `index.html` to open it in your browser.

**Option 2: run a small local server (optional)**

```
cd quicknotes-system-design
python -m http.server 8000
```

(On Windows you can use `py -m http.server 8000`.) Then open <http://localhost:8000>.

**Using the app**

- Click **Load notes** to fetch 10 notes (`GET /posts?_limit=10`).
- Fill in the form and click **Add note** to create a note (`POST /posts`). The title is required and must be 100 characters or fewer; the body is optional.
- Click **Delete** on a note to remove it (`DELETE /posts/{id}`).

JSONPlaceholder is a fake API: it replies with realistic responses but does not store anything. A created note always comes back with id 101, and a deleted note comes back when you reload. `api.js` explains how the client handles this.

## Design documents

| Document | What it covers |
|---|---|
| [docs/api-design.md](docs/api-design.md) | REST endpoints, request and response examples, error codes |
| [docs/data-model.md](docs/data-model.md) | Tables, keys, relationships, SQL, indexes, SQL vs NoSQL decision |
| [docs/architecture.md](docs/architecture.md) | Requirements, load estimate for 1 million users, diagram, request flows, trade-offs, single points of failure |

## Project structure

```
quicknotes-system-design/
├── index.html
├── api.js
├── style.css
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## What I learned

- **Talking to an API takes more than one `fetch` call.** A reusable `request()` function that checks `response.ok` and throws on errors keeps the code tidy, and wrapping every call in `try` / `catch` / `finally` means the buttons are always re-enabled, even after a failure. I also learned that `fetch` only rejects on network failures, so HTTP errors such as 404 or 500 must be detected by hand.
- **Good interfaces show every state.** Users need to see loading, success, error and empty states, and buttons must be disabled while a request runs so nothing is sent twice. Validating input before sending a request saves a trip to the server.
- **Never put user text into `innerHTML`.** Using `textContent` means a title such as `<b>hi</b>` is shown as text and cannot run code (protection against cross-site scripting).
- **A fake API behaves differently from a real one.** JSONPlaceholder does not save anything, so I had to decide how the page should behave and explain it in a comment. It showed me why a design document is needed for the real backend.
- **Estimating load drives the design.** Working out reads and writes per second (about 116 reads/s and 12 writes/s on average, 5 times that at peak) showed that QuickNotes is read-heavy, which is why the design uses a cache and a read replica.
- **Every component solves a specific problem, and every choice has a cost.** Caching adds the risk of stale data, replicas add lag, and queues add complexity. Avoiding single points of failure means running two or more of each part.
- **Data modelling needs the right relationships.** Notes and tags are many-to-many, so a join table (`note_tags`) is required, and indexes should match the queries that run most often.
