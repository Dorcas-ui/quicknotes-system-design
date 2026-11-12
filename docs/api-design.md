# QuickNotes API Design

This document describes the **real QuickNotes REST API** that the backend team will build. It is not the JSONPlaceholder practice API used by the browser client in this repository.

## 1. Conventions

| Topic | Decision |
|---|---|
| Base URL | `https://api.quicknotes.example/api/v1` |
| Format | JSON in requests and responses (`Content-Type: application/json`) |
| Authentication | `Authorization: Bearer <access_token>` on every endpoint except register and login |
| Resource names | Plural nouns (`/notes`, `/tags`); the HTTP method is the verb |
| IDs | Numeric ids (`"id": 42`) |
| Timestamps | ISO 8601 in UTC, e.g. `2026-11-12T09:30:00Z` |
| Ownership | A user can only see and change their own notes and tags |
| Versioning | The version is in the path (`/api/v1`) so breaking changes can ship as `/api/v2` |
| Pagination | Cursor based: `?limit=20&cursor=<opaque>`; responses include `next_cursor` (or `null` on the last page) |

## 2. Endpoints

| # | Method | Path | Description | Success status |
|---|---|---|---|---|
| 1 | `POST` | `/auth/register` | Create a user account | `201 Created` |
| 2 | `POST` | `/auth/login` | Exchange email and password for an access token | `200 OK` |
| 3 | `GET` | `/notes` | List the current user's notes (newest first). Optional filters: `tag`, `q` (search text), `limit`, `cursor` | `200 OK` |
| 4 | `POST` | `/notes` | Create a note | `201 Created` |
| 5 | `GET` | `/notes/{id}` | Get one note, including its tags | `200 OK` |
| 6 | `PUT` | `/notes/{id}` | Replace a note's title and body (full update) | `200 OK` |
| 7 | `PATCH` | `/notes/{id}` | Change only the fields that are sent (partial update) | `200 OK` |
| 8 | `DELETE` | `/notes/{id}` | Delete a note | `204 No Content` |
| 9 | `GET` | `/tags` | List the current user's tags | `200 OK` |
| 10 | `POST` | `/notes/{id}/tags` | Attach a tag to a note (creates the tag if it does not exist yet) | `201 Created` |
| 11 | `DELETE` | `/notes/{id}/tags/{tagId}` | Remove a tag from a note | `204 No Content` |

Notes on the design:

- `GET` never changes data and can be cached; `POST` creates; `PUT` replaces; `PATCH` edits part of a resource; `DELETE` removes.
- Tags are a sub-resource of a note (`/notes/{id}/tags`) because attaching a tag is a relationship between a note and a tag (see `data-model.md`).
- `DELETE` is idempotent: deleting a note twice leaves the same end state, although the second call returns `404`.
- Login is the only endpoint that returns a token. A `201`/`200` response never contains the password or its hash.

## 3. Request and response examples

### 3.1 Create a note: `POST /notes`

Request:

```http
POST /api/v1/notes HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{
  "title": "Buy milk",
  "body": "Two litres, and bread for tomorrow.",
  "tags": ["shopping", "home"]
}
```

Validation rules: `title` is required, 1 to 100 characters; `body` is optional (up to 10,000 characters); `tags` is optional (up to 10 names, each up to 50 characters).

Response `201 Created`:

```http
HTTP/1.1 201 Created
Location: /api/v1/notes/1042
Content-Type: application/json

{
  "id": 1042,
  "user_id": 7,
  "title": "Buy milk",
  "body": "Two litres, and bread for tomorrow.",
  "tags": [
    { "id": 3, "name": "shopping" },
    { "id": 9, "name": "home" }
  ],
  "created_at": "2026-11-12T09:30:00Z",
  "updated_at": "2026-11-12T09:30:00Z"
}
```

### 3.2 List notes: `GET /notes`

Request:

```http
GET /api/v1/notes?limit=2&tag=shopping HTTP/1.1
Host: api.quicknotes.example
Authorization: Bearer eyJhbGciOi...
```

Response `200 OK`:

```json
{
  "data": [
    {
      "id": 1042,
      "title": "Buy milk",
      "body": "Two litres, and bread for tomorrow.",
      "tags": [
        { "id": 3, "name": "shopping" },
        { "id": 9, "name": "home" }
      ],
      "created_at": "2026-11-12T09:30:00Z",
      "updated_at": "2026-11-12T09:30:00Z"
    },
    {
      "id": 1017,
      "title": "Birthday gift ideas",
      "body": "Book, scarf, headphones.",
      "tags": [
        { "id": 3, "name": "shopping" }
      ],
      "created_at": "2026-11-10T16:05:41Z",
      "updated_at": "2026-11-11T08:12:03Z"
    }
  ],
  "next_cursor": "eyJpZCI6MTAxN30",
  "limit": 2
}
```

An empty result is still `200 OK` with `"data": []` and `"next_cursor": null` (an empty list is not an error).

### 3.3 Partial update: `PATCH /notes/{id}`

```http
PATCH /api/v1/notes/1042 HTTP/1.1
Content-Type: application/json

{ "body": "Two litres of milk, bread and eggs." }
```

Response `200 OK` returns the full updated note (same shape as in 3.1, with a new `updated_at`).

### 3.4 Delete a note: `DELETE /notes/{id}`

```http
DELETE /api/v1/notes/1042 HTTP/1.1
Authorization: Bearer eyJhbGciOi...
```

Response: `204 No Content` (empty body).

### 3.5 Login: `POST /auth/login`

```json
{ "email": "amina@example.com", "password": "correct horse battery staple" }
```

Response `200 OK`:

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

## 4. Error responses

All errors use one consistent JSON shape and the correct HTTP status code, so clients can handle them in one place.

### 4.1 Status codes

| Status | Meaning | When QuickNotes returns it |
|---|---|---|
| `400 Bad Request` | The request is malformed or fails validation | Invalid JSON; missing `title`; `title` longer than 100 characters; bad `limit` or `cursor` |
| `401 Unauthorized` | Not authenticated | Missing, expired or invalid token; wrong email or password on login |
| `403 Forbidden` | Authenticated, but not allowed to do this | Using a read-only token to write; account suspended |
| `404 Not Found` | The resource does not exist (or is not visible to this user) | `GET /notes/9999`; reading another user's note (see below); deleting a note that is already gone |
| `409 Conflict` | The request clashes with current state | Registering an email that already exists |
| `429 Too Many Requests` | Rate limit exceeded | Too many requests per minute; response includes a `Retry-After` header |
| `500 Internal Server Error` | An unexpected server problem | Bug or failure on our side; the client may retry later |
| `503 Service Unavailable` | Temporarily overloaded or in maintenance | Dependencies down; includes `Retry-After` |

A note that belongs to someone else returns `404`, not `403`. This avoids revealing that a note with that id exists. `403` is reserved for cases where we want to tell an authenticated caller that the action itself is not permitted.

### 4.2 Error body example

`POST /notes` with a title that is too long, returning `400 Bad Request`:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request could not be processed because some fields are invalid.",
    "details": [
      {
        "field": "title",
        "issue": "Title must be 100 characters or fewer."
      }
    ],
    "request_id": "req_8f2c1d7a"
  }
}
```

Other examples (same shape):

```json
{ "error": { "code": "unauthorized", "message": "Your session has expired. Please log in again.", "request_id": "req_41b9e0aa" } }
```

```json
{ "error": { "code": "not_found", "message": "Note 9999 was not found.", "request_id": "req_a03d77c2" } }
```

```json
{ "error": { "code": "internal_error", "message": "Something went wrong on our side. Please try again later.", "request_id": "req_c5e91b30" } }
```

The `request_id` is also written to the server logs, so support can trace a failed call. `500` responses never include stack traces or database details.

### 4.3 Which endpoints can return which errors

| Endpoint | 400 | 401 | 403 | 404 | 409 | 429 | 500 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `POST /auth/register` | yes | | | | yes | yes | yes |
| `POST /auth/login` | yes | yes | yes | | | yes | yes |
| `GET /notes` | yes | yes | yes | | | yes | yes |
| `POST /notes` | yes | yes | yes | | | yes | yes |
| `GET /notes/{id}` | | yes | yes | yes | | yes | yes |
| `PUT` / `PATCH /notes/{id}` | yes | yes | yes | yes | | yes | yes |
| `DELETE /notes/{id}` | | yes | yes | yes | | yes | yes |
| `GET /tags` | | yes | yes | | | yes | yes |
| `POST /notes/{id}/tags` | yes | yes | yes | yes | | yes | yes |
| `DELETE /notes/{id}/tags/{tagId}` | | yes | yes | yes | | yes | yes |
