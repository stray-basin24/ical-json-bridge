# ical-json-bridge

Most tools that consume calendar data don't want raw `.ics` text — they want
an array of plain objects they can filter, sort, and render. And most
calendar exports only speak `.ics`. This is a small converter that goes both
ways: iCalendar text in one direction, a plain JSON event shape in the other.

No dependencies. The whole thing is a handful of pure functions operating on
strings and arrays — no file I/O, no network calls, no clock reads. That
also makes it easy to test: every function takes input and returns output,
nothing else.

## The JSON shape

```ts
interface CalendarEvent {
  uid: string;
  summary: string;
  start: string; // ISO 8601, e.g. "2024-01-15T09:00:00Z" or "2024-01-15" for all-day
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  tzid?: string; // set when DTSTART/DTEND carried a TZID param instead of UTC or floating time
}
```

## Usage

```ts
import { parseIcs, toIcs } from './src/index';

const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//example//EN
BEGIN:VEVENT
UID:standup-2024-01-15@example.com
SUMMARY:Team standup
DTSTART:20240115T090000Z
DTEND:20240115T091500Z
LOCATION:Zoom
END:VEVENT
END:VCALENDAR
`;

const events = parseIcs(ics);
// [{
//   uid: 'standup-2024-01-15@example.com',
//   summary: 'Team standup',
//   start: '2024-01-15T09:00:00Z',
//   end: '2024-01-15T09:15:00Z',
//   allDay: false,
//   location: 'Zoom',
// }]

const roundTripped = toIcs(events);
// back to a valid VCALENDAR block, folded and escaped per RFC 5545
```

Converting the other direction works the same way: build `CalendarEvent[]`
objects however you like (from a database row, a form, another API) and
pass them to `toIcs` to get text you can hand to a mail client or write to
an `.ics` file.

## What's handled right now

- `VEVENT` blocks with `UID`, `SUMMARY`, `DTSTART`, `DTEND`, `DESCRIPTION`,
  `LOCATION`.
- UTC (`...Z`) and floating date-times, plus all-day (`VALUE=DATE`) events.
- `TZID=...` on `DTSTART`/`DTEND`: the offset isn't resolved (there's no
  `VTIMEZONE`/tzdata table here), so `start`/`end` come back as floating
  wall-clock ISO strings and the zone name lands in `tzid`. Round-tripping
  through `toIcs` reproduces the same `TZID` param.
- Line folding/unfolding and text escaping per RFC 5545.

## What's not handled yet

- Recurrence (`RRULE`, `EXDATE`).
- `VALARM`, `VTIMEZONE`, and other component types.

## Building

```
tsc
```

(Requires a TypeScript compiler on your machine; this project has no
dependencies of its own, so nothing to install for the library itself.)

## Tests

```
npm test
```

This compiles and runs `src/index.test.ts` with Node. The tests use a small
built-in runner rather than a test framework, so there is still nothing to
install.
