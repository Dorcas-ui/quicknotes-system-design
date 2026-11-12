# QuickNotes Architecture

QuickNotes is moving from a browser-only app (notes saved on one device) to an online service used by **1 million people**. This document describes the requirements, the expected load, the architecture and the main design decisions.

## 1. Requirements

### Functional requirements (what the system does)

1. Users can register and log in.
2. Users can create, read, update and delete their own notes (title up to 100 characters, optional body).
3. Users can list their notes, newest first, with pagination.
4. Users can add tags to notes and filter notes by tag.
5. Notes are available on every device the user logs in from.
6. A user can only see and change their own notes.

### Non-functional requirements (how well it works)

| Quality | Target |
|---|---|
| Availability | 99.9% uptime (about 8.8 hours of downtime per year at most); no single point of failure |
| Latency | `GET /notes` under 200 ms and `POST /notes` under 400 ms for 95% of requests |
| Scalability | Handle 1 million users now and 10 times more by adding servers, not rewriting |
| Durability | A saved note is never lost: database replication and daily backups |
| Consistency | A user sees their own new note immediately; other devices may lag by a few seconds |
| Security | HTTPS everywhere, hashed passwords, token-based authentication, per-user data isolation |
| Maintainability | Stateless app servers, monitoring and logging with request ids |

## 2. Load estimate for 1 million users

### Assumptions

| Assumption | Value |
|---|---|
| Registered users | 1,000,000 |
| Daily active users (DAU) | 20% = **200,000** |
| Reads per active user per day | 50 (`GET /notes` and `GET /notes/{id}`) |
| Writes per active user per day | 5 (3 new notes, 2 edits or deletes) |
| Average note size | 2 KB (title, body and metadata) |
| Storage overhead for indexes and tags | +50% |
| Seconds in a day | 86,400 |
| Peak traffic | 5 times the average |
| Cache hit rate | 80% |

### Reads per second

- Reads per day: 200,000 x 50 = 10,000,000
- Average: 10,000,000 / 86,400 = **about 116 reads/s**
- Peak (5x): **about 579 reads/s**
- With an 80% cache hit rate, only about 20% reach the database: **about 116 reads/s** at peak.

### Writes per second

- Writes per day: 200,000 x 5 = 1,000,000
- Average: 1,000,000 / 86,400 = **about 11.6 writes/s**
- Peak (5x): **about 58 writes/s**

### Storage per year

- New notes per day: 200,000 x 3 = 600,000
- Raw data per day: 600,000 x 2 KB = 1.2 GB
- Raw data per year: 1.2 GB x 365 = **438 GB**
- With indexes and tags (+50%): **about 657 GB per year**
- The read replica holds a full copy, so total database disk is about 1.3 TB per year. Backups come on top.

### What the numbers tell us

- The system is **read-heavy**: about 10 reads for every write.
- Peak load is about 637 requests per second in total (579 reads plus 58 writes). That is small enough that a few app servers and one database primary are enough, so the design focuses on **availability** and **cheap reads** rather than extreme scale.
- Bandwidth at peak is modest: 579 reads/s x about 10 KB = about 5.8 MB/s (roughly 46 Mbit/s).

## 3. Architecture diagram

```
                        +-----------+
                        |  Client   |  (browser / mobile app)
                        +-----+-----+
                              |
                        +-----v-----+
                        |    DNS    |  api.quicknotes.example -> load balancer
                        +-----+-----+  app.quicknotes.example -> CDN
                              |
              +---------------+----------------+
              | static files                   | API calls (HTTPS)
              | (HTML, CSS, JS)                | GET /notes, POST /notes ...
        +-----v-----+                  +-------v--------+
        |    CDN    |                  | Load Balancer  |  (redundant pair)
        +-----+-----+                  +---+--------+---+
              | cache miss                 |        |
      +-------v--------+           +-------v--+  +--v-------+
      |  Static files  |           |   App    |  |   App    |   ... App Server N
      | (object store) |           | Server 1 |  | Server 2 |   (stateless,
      +----------------+           +----+-----+  +-----+----+    in 2+ zones)
                                        |              |
                +-----------------------+--------------+-----------------+
                |                       |                                |
         +------v------+       +--------v--------+               +-------v-------+
         |    Cache    |       |   Primary DB    |               |     Queue     |
         |   (Redis)   |       | (all writes)    |               +-------+-------+
         +-------------+       +--------+--------+                       |
                                        | replication              +-----v-----+
                               +--------v--------+                 |  Worker   |
                               |  Read Replica   |                 | (async    |
                               |  (reads only)   |                 |  jobs)    |
                               +-----------------+                 +-----------+
```

How the parts connect:

- Every app server talks to the cache, the primary database, the read replica and the queue.
- **Reads:** app server, then cache, then (on a miss) read replica.
- **Writes:** app server, then primary database. The primary copies every change to the replica.
- **Background jobs:** app server puts a job on the queue; a worker takes it and does the slow work (sending a welcome email, updating the search index, nightly clean-up), writing results to the primary database when needed.
- Static files (HTML, CSS, JavaScript) come from the CDN and never reach the app servers.

## 4. Components: the problem each one solves

- **Client:** gives the user an interface to read and write notes and talks to the API over HTTPS.
- **DNS:** turns a readable name such as `api.quicknotes.example` into the address of the load balancer, so users never need to know server addresses and we can move servers without changing the name.
- **CDN:** serves static files (and any cacheable public content) from locations near the user, so pages load fast and the app servers are not busy sending the same files again and again.
- **Load balancer:** spreads incoming requests across the app servers and stops sending traffic to a server that fails its health check, so no single server is overloaded and one failure does not take the service down.
- **App servers (two or more):** run the QuickNotes logic (authentication, validation, reading and writing notes); because they are stateless we can add or remove servers to match traffic.
- **Cache (Redis):** keeps frequently read data (such as each user's first page of notes) in memory so most `GET /notes` requests avoid the slower database.
- **Primary database (PostgreSQL):** is the single source of truth, storing users, notes and tags with transactions so data stays correct and is never half-saved.
- **Read replica:** holds a continuously updated copy of the primary that serves read queries, which keeps the read-heavy traffic off the primary and acts as a ready standby if the primary fails.
- **Queue:** holds jobs waiting to be done, so the API can reply immediately and slow work does not block users or get lost during traffic spikes.
- **Worker:** takes jobs from the queue and runs them in the background (emails, search indexing, clean-up), so those tasks never slow down a user's request.

## 5. Request flows

### 5.1 `GET /notes` (list notes)

1. The client sends `GET /api/v1/notes?limit=20` with its access token.
2. DNS has already resolved `api.quicknotes.example` to the load balancer.
3. The **load balancer** picks a healthy app server and forwards the request.
4. The **app server** checks the token (authentication) and finds the user id (for example 7).
5. It builds a cache key such as `notes:user:7:first-page` and asks the **cache**.
6. **Cache hit (about 80% of requests):** the cached JSON is returned right away, skipping steps 7 to 8.
7. **Cache miss:** the app server queries the **read replica** (`WHERE user_id = 7 ORDER BY created_at DESC LIMIT 20`, which uses the index `idx_notes_user_created`).
8. The app server stores the result in the cache with a short expiry (for example 60 seconds).
9. The app server returns `200 OK` with the notes and `next_cursor`. The response travels back through the load balancer to the client.
10. If anything fails along the way, the client receives a JSON error with the correct status (`401`, `500` and so on, see `api-design.md`).

### 5.2 `POST /notes` (create a note)

1. The client sends `POST /api/v1/notes` with a JSON body (`title`, optional `body`, optional `tags`) and its token.
2. The **load balancer** forwards it to a healthy app server.
3. The **app server** authenticates the user and **validates** the body (title required and at most 100 characters). Invalid input is rejected immediately with `400`, and nothing is written.
4. In one database transaction on the **primary database**, it inserts the note and any tags and links (`notes`, `tags`, `note_tags`), then commits. Only now is the note safely saved.
5. The app server **deletes the user's cached first page** (`notes:user:7:first-page`) so the next list request will not show stale data.
6. The app server puts a job on the **queue** (for example "update search index for note 1042"). This is quick and does not wait for the work itself.
7. The app server returns `201 Created` with the new note and a `Location` header. The user sees success without waiting for the background work.
8. Later, a **worker** takes the job from the queue, does the slow work and, if needed, writes the result to the primary database. If the job fails, it is retried; after several failures it goes to a dead-letter queue for investigation.
9. The primary **replicates** the new note to the read replica, usually within milliseconds.

## 6. Trade-offs

1. **Caching: speed versus freshness.** The cache makes most reads very fast and reduces database load by about 80%, but cached data can be out of date and must be invalidated when a note changes. We delete the cache entry on every write and use a short expiry (60 seconds) as a safety net. The cost is extra complexity and a small chance that a second device briefly shows an older list.
2. **Read replica: scalability versus replication lag.** Sending reads to a replica protects the primary and gives us a standby copy, but the replica can be a few milliseconds to seconds behind the primary. A user who just created a note and immediately lists notes might not see it. To avoid this we invalidate the cache on write and, for a few seconds after a user writes, read that user's list from the primary.
3. **Queue and worker: responsiveness versus complexity.** Moving slow tasks off the request path keeps `POST /notes` fast and absorbs traffic spikes, but results arrive later (eventual consistency) and we must run, monitor and retry workers, and make jobs safe to run twice (idempotent).
4. **One primary SQL database: consistency versus write scaling.** A single primary keeps data consistent and transactions simple, which is right for about 58 writes per second at peak, but it limits write capacity. If writes grow beyond what one machine can handle, we would partition (shard) by `user_id`, which is more complex. We accept the simple design now because the estimate is far below that limit.
5. **Redundancy: reliability versus cost.** Running two or more of each component across zones costs more than running one, but it is required to meet the 99.9% availability target.

## 7. Avoiding single points of failure

A single point of failure (SPOF) is a component whose failure would stop the whole system. Each component is made redundant:

| Component | How the single point of failure is avoided |
|---|---|
| DNS | Use a managed DNS provider that runs on many servers worldwide, with a short TTL so addresses can be changed quickly |
| CDN | Provider has many edge locations; if one fails, requests go to another. Static files also exist in the origin storage |
| Load balancer | Run a redundant pair (or a managed multi-zone load balancer) with automatic failover |
| App servers | Run at least two (we plan three) in different availability zones; the load balancer removes unhealthy ones; they are stateless, so any server can handle any request |
| Cache | Redis with a replica and automatic failover; if the cache is down, requests fall through to the database (slower but still working), and the database is protected with rate limiting |
| Primary database | The read replica is a hot standby: if the primary fails, it is promoted to primary automatically (or by the on-call engineer), and a new replica is created. Daily backups and point-in-time recovery protect against data loss |
| Read replica | If it fails, reads fall back to the primary until a new replica is built; a second replica can be added |
| Queue | Use a replicated, managed queue so jobs survive a node failure; failed jobs are retried |
| Worker | Run two or more workers; any worker can take any job |

Other protections: health checks and automatic restarts, deployments one server at a time (rolling updates), monitoring and alerts on error rate and latency, and spreading components across at least two availability zones so the loss of one data centre does not stop QuickNotes.
