# Venues & Rooms

> Source: `Book1.xlsx` (June 2026 room booking calendar) + earlier conversation context. Compiled June 2026.

## Concept

Two related entities:

- **Venue** — a physical or virtual location where training happens. The company runs trainings at two owned venues, several external hotels, and via virtual delivery.
- **Room** — a specific space within an owned venue. External venues and virtual delivery don't have rooms in the database — only owned venues do.

A session always has a venue (`sessions.venue_code`). It optionally has a room (`sessions.room_id`) — required for IP and JTC sessions, not applicable for hotels/HBL.

## Venue catalog

| Code | Name | Type | Notes |
|---|---|---|---|
| `IP` | International Plaza | owned | Tanjong Pagar MRT — central branch |
| `JTC` | JTC Summit | owned | Jurong East — west branch / HQ |
| `FURAMA` | Furama Hotel | external | External hotel — room booked ad-hoc |
| `HOLIDAYINN` | Holiday Inn | external | External hotel — room booked ad-hoc |
| `SCOTTS` | Scotts Hotel | external | External hotel — room booked ad-hoc |
| `HBL` | Home-Based Learning | virtual | Virtual delivery (Zoom etc.); no room needed |
| `LAVENDER` | Lavender Street | external | Used for Drone Flying / Piloting courses |
| `INHOUSE` | Client In-house | external | Sessions at client's premises; address varies |
| `OUTBOUND` | Outbound (external) | external | Catch-all for off-site trainings; was tracked in "Take Note" rows of the manual room calendar |

### Why three venue types

- **`owned`** venues have a fixed set of rooms with known capacities. Rooms are part of the catalog.
- **`external`** venues are physical but the company doesn't control rooms — bookings are ad-hoc per session. No room entries in the database; the session just references the venue.
- **`virtual`** is HBL. No physical room. The "venue" exists conceptually so sessions can be grouped by delivery mode in reporting.

## Room catalog

### International Plaza — 7 rooms, 4 with confirmed capacities

| Room ID | Name | Capacity |
|---|---|---|
| `ip-knowledge` | Knowledge | 16 |
| `ip-quality` | Quality | 20 |
| `ip-habits` | Habits | 18 |
| `ip-experience` | Experience | 30 |
| `ip-class1` | Class1 | — |
| `ip-class2` | Class2 | — |
| `ip-classroom` | Classroom | — |

### JTC Summit — 12 rooms, capacities not yet captured

| Room ID | Name | Capacity |
|---|---|---|
| `jtc-enjoyment` | Enjoyment | — |
| `jtc-gratitude` | Gratitude | — |
| `jtc-happiness` | Happiness | — |
| `jtc-wisdom` | Wisdom | — |
| `jtc-meeting-room` | Meeting Room | — |
| `jtc-adapt` | Adapt | — |
| `jtc-bond` | Bond | — |
| `jtc-concept` | Concept | — |
| `jtc-level20-roomA` | Level 20 (Room A) | — |
| `jtc-level20-roomB` | Level 20 (Room B) | — |
| `jtc-level20-roomC` | Level 20 (Room C) | — |
| `jtc-classroom` | Classroom | — |

**15 capacities to fill in** across the generic August schedule labels and JTC rooms. These need to come from facilities or be measured manually.

### Generic owned-room labels from August 2026 schedule

The August 2026 Master Schedule uses generic room labels in a separate room column. These labels are resolved only after the venue/address column has identified an owned venue:

| Venue | Observed label | Room ID |
|---|---|---|
| IP | Class1 | `ip-class1` |
| IP | Class2 | `ip-class2` |
| IP | Classroom | `ip-classroom` |
| JTC | Classroom | `jtc-classroom` |

Do not infer missing combinations. `jtc-class1` and `jtc-class2` are not catalogued because they were not observed in the August workbook. `Classroom` at one-off external/client addresses remains unresolved.

## Naming conventions

- **Room ID** (database key): lowercase, hyphenated, prefixed with venue code. Examples: `ip-knowledge`, `jtc-level20-roomA`, `ip-class1`.
- **Display name**: the operational name people use ("Knowledge", "Level 20 (Room A)").
- **Disambiguating multiple rooms on the same level**: use `Level XX (Room A/B/C)` format.

## What's NOT a room (despite appearing in the room booking Excel)

The manual room booking Excel has rows labelled `Take Note` and `Class Cancelled`. These look like rooms but are calendar tracking artifacts:

- **`Take Note`** rows → sessions happening off-site / outbound. Modelled in the database via the `OUTBOUND` venue, not as a room.
- **`Class Cancelled`** rows → sessions that were originally scheduled but cancelled. Modelled via `sessions.status = 'Cancelled'`, not as a room.

These do not appear in the rooms catalog.

## Room assignment workflow

The website (when built) will provide a room overview UI similar to the current manual Excel. The planner uses it to:

- See which rooms are free on a given day
- Drag/assign sessions to rooms
- Be warned if a session's expected enrollment exceeds the room's capacity

The AI assistant should suggest rooms based on:

- The session's confirmed/expected `pax` count vs `rooms.capacity`
- The session's venue (must match — can't put an IP session in a JTC room)
- Avoid double-booking (a room can host only one session per day, or one per half-day if we model that later)

For HBL sessions: no room needed. The room field is simply null.
For hotel/external sessions: no room needed in v1. The hotel address gets stored as session metadata if needed for printing.

## What's deferred

These are real concerns but not in v1:

- **Half-day room slots** — sometimes a room hosts AM and PM sessions on the same day. Currently we assume one session per room per day. Real workflow may have AM/PM splits.
- **Room features** — projector, whiteboard, computers per seat, etc. Not modelled in v1. Add as boolean columns to `rooms` later if needed.
- **Hotel room sizes** — if "Furama" can hold sessions of varying sizes depending on which room is booked, that's not modelled. Currently the venue is enough.
- **Inhouse client address tracking** — when a session runs at a client's office, the address would be useful for the trainer's confirmation note. Add later as `sessions.external_venue_address` if needed.

## File schemas

### `venues.csv`

```
code      — primary key (e.g. IP, JTC, FURAMA, HBL)
name      — display name
type      — owned | external | virtual
address   — physical address (blank for virtual; blank for hotels where it varies)
notes     — free text
```

### `rooms.csv`

```
room_id     — primary key (e.g. ip-knowledge, jtc-level20-roomA)
venue_code  — FK to venues.code (only 'owned' venues have rooms)
name        — display name (e.g. "Knowledge", "Level 20 (Room A)")
capacity    — integer (max pax). Blank means not yet captured.
notes       — free text
```

## Counts

- Venues: 9 (2 owned, 6 external, 1 virtual)
- Rooms: 19 (4 with capacity, 15 missing capacity)

## What this entity enables

Once `venues.csv` and `rooms.csv` are loaded into the database:

1. The Master Schedule Excel parser can resolve `Venue` column values to venue codes
2. The Planning UI can show a room-overview grid (the equivalent of the manual Book1.xlsx, but live)
3. The AI assistant can answer "which rooms are free on Aug 15?" or "can a 22-person class fit anywhere on Tue?"
4. Capacity warnings can fire when `confirmed_pax > rooms.capacity`
5. Cost-per-participant calculations can consider venue type (in-house vs hotel may have different cost structures later)

## To-do before the website goes live

1. **Fill in JTC room capacities** (11 rooms). Either measure them, ask facilities, or enter best estimates and refine later.
2. **Confirm hotel list is complete.** Are Furama, Holiday Inn, and Scotts the only three? Are there others not in the June 2026 schedule?
3. **Confirm Inhouse and Outbound modelling.** Do these appear as venue values in the Master Schedule Excel, or do they get expressed differently?
4. **Consider half-day rooming** if any rooms get double-booked AM/PM in reality.
