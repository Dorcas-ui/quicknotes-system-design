# QuickNotes Data Model

This document describes the database design for the real QuickNotes service. SQL examples use PostgreSQL syntax.

## 1. Entities

QuickNotes stores four entities: **users**, **notes**, **tags** and **note_tags** (a join table that links notes and tags).

### users

| Column | Type | Key / constraint | Description |
|---|---|---|---|
| `id` | `BIGINT` (identity) | **Primary key** | Unique user id |
| `email` | `VARCHAR(255)` | `UNIQUE`, `NOT NULL` | Login email |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` | Hashed password (never the plain password) |
| `display_name` | `VARCHAR(100)` | `NOT NULL` | Name shown in the app |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, default `now()` | Sign-up time |

### notes

| Column | Type | Key / constraint | Description |
|---|---|---|---|
| `id` | `BIGINT` (identity) | **Primary key** | Unique note id |
| `user_id` | `BIGINT` | **Foreign key** to `users(id)`, `NOT NULL` | Owner of the note |
| `title` | `VARCHAR(100)` | `NOT NULL`, check not empty | Title (max 100, as in the API) |
| `body` | `TEXT` | nullable | Note text (optional) |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL`, default `now()` | Creation time |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL`, default `now()` | Last edit time |

### tags

| Column | Type | Key / constraint | Description |
|---|---|---|---|
| `id` | `BIGINT` (identity) | **Primary key** | Unique tag id |
| `user_id` | `BIGINT` | **Foreign key** to `users(id)`, `NOT NULL` | Owner of the tag |
| `name` | `VARCHAR(50)` | `NOT NULL` | Tag text, e.g. `shopping` |
| | | `UNIQUE (user_id, name)` | A user cannot have two tags with the same name |

### note_tags (join table)

| Column | Type | Key / constraint | Description |
|---|---|---|---|
| `note_id` | `BIGINT` | **Foreign key** to `notes(id)`, part of primary key | The note |
| `tag_id` | `BIGINT` | **Foreign key** to `tags(id)`, part of primary key | The tag |
| | | **Primary key** `(note_id, tag_id)` | A tag can be attached to a note only once |

## 2. Relationships

```
 users 1 ----------- * notes
   |                     |
   | 1                   | *
   |                     |
   *                     *
 tags  * ----------- * notes     (through note_tags)
```

- **users to notes: one-to-many.** One user owns many notes, but each note belongs to exactly one user. This is implemented with the foreign key `notes.user_id`.
- **users to tags: one-to-many.** One user owns many tags, and each tag belongs to one user (`tags.user_id`). Tags are per user, so one user's tag names never affect another's.
- **notes to tags: many-to-many.** One note can have many tags (`shopping`, `home`), and one tag can be attached to many notes. A relational database cannot store this directly in either table, so the join table `note_tags` holds one row per (note, tag) pair. It has two foreign keys, one to each side.
- **Deleting:** `ON DELETE CASCADE` is used on `notes.user_id`, `tags.user_id`, `note_tags.note_id` and `note_tags.tag_id`. Deleting a note removes its rows in `note_tags`, and deleting a user removes their notes and tags. Deleting a tag removes only the links, never the notes.

## 3. CREATE TABLE statements

```sql
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE notes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      VARCHAR(100) NOT NULL CHECK (length(trim(title)) > 0),
    body       TEXT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE tags (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name    VARCHAR(50) NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (user_id, name)
);

CREATE TABLE note_tags (
    note_id BIGINT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    tag_id  BIGINT NOT NULL REFERENCES tags  (id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);
```

## 4. Indexes

```sql
-- 1. Main list query: "this user's newest notes"
CREATE INDEX idx_notes_user_created
    ON notes (user_id, created_at DESC, id DESC);

-- 2. Reverse lookup: "all notes that have this tag"
CREATE INDEX idx_note_tags_tag_note
    ON note_tags (tag_id, note_id);
```

**Why these indexes:**

- `idx_notes_user_created` supports `GET /notes`, the most frequent request (see `architecture.md`: reads are about ten times more common than writes). Without it, the database would scan every note in the table to find one user's notes and then sort them. With it, the database jumps to the user's rows, already in newest-first order, and reads just one page. It also makes cursor pagination efficient.
- `idx_note_tags_tag_note` supports `GET /notes?tag=...`. The primary key `(note_id, tag_id)` already covers "tags of a note", but not the opposite direction, "notes of a tag".
- Primary keys and `UNIQUE` constraints (`users.email`, `tags(user_id, name)`) create indexes automatically. Indexes speed up reads but slow down writes slightly and use disk, so we add only the ones that serve known queries.

## 5. Example queries

**1. List a user's 20 newest notes (page one):**

```sql
SELECT id, title, body, created_at
FROM notes
WHERE user_id = 7
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**2. Next page using the cursor (keyset pagination), faster than `OFFSET` on large tables:**

```sql
SELECT id, title, body, created_at
FROM notes
WHERE user_id = 7
  AND (created_at, id) < ('2026-11-10 16:05:41+00', 1017)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**3. JOIN: all notes of a user that have the tag "shopping":**

```sql
SELECT n.id, n.title, n.created_at
FROM notes     AS n
JOIN note_tags AS nt ON nt.note_id = n.id
JOIN tags      AS t  ON t.id = nt.tag_id
WHERE n.user_id = 7
  AND t.name = 'shopping'
ORDER BY n.created_at DESC;
```

**4. Tags of each note, with a count per note (JOIN + GROUP BY):**

```sql
SELECT n.id, n.title, COUNT(nt.tag_id) AS tag_count
FROM notes AS n
LEFT JOIN note_tags AS nt ON nt.note_id = n.id
WHERE n.user_id = 7
GROUP BY n.id, n.title
ORDER BY n.id DESC;
```

**5. Create a note with a tag in one transaction (`POST /notes`):**

```sql
BEGIN;

INSERT INTO notes (user_id, title, body)
VALUES (7, 'Buy milk', 'Two litres, and bread for tomorrow.')
RETURNING id;                                   -- e.g. 1042

INSERT INTO tags (user_id, name)
VALUES (7, 'shopping')
ON CONFLICT (user_id, name) DO NOTHING;

INSERT INTO note_tags (note_id, tag_id)
SELECT 1042, id FROM tags WHERE user_id = 7 AND name = 'shopping';

COMMIT;
```

**6. Delete a note (its `note_tags` rows disappear by cascade):**

```sql
DELETE FROM notes WHERE id = 1042 AND user_id = 7;
```

All queries filter by `user_id`, which enforces the rule that users only see their own data.

## 6. SQL or NoSQL?

**Decision: a relational SQL database (PostgreSQL).**

QuickNotes data is naturally structured and connected: users own notes, notes have tags, and tags are shared across notes. This many-to-many relationship is exactly what SQL handles well, with foreign keys that stop orphaned or invalid data and `JOIN`s that answer questions like "which notes have this tag?". Creating a note with its tags must also be all-or-nothing, and SQL transactions (ACID) guarantee that. The load estimate in `architecture.md` (about 12 writes per second on average and under 1 TB of data per year for 1 million users) is well within what one PostgreSQL primary with read replicas can handle, so we do not need NoSQL's horizontal write scaling. If the service grows by orders of magnitude, we can add caching, more replicas and later partition (shard) by `user_id`, since every query already filters on it. The trade-off is that a fixed schema needs migrations when it changes, which we accept in exchange for consistency and simpler queries. A document database such as MongoDB would store a note with its tags in one document, but it makes tag-based queries and cross-note consistency harder.
