import {
  CalendarEvent,
  foldLine,
  escapeText,
  unescapeText,
  icsDateTimeToIso,
  isoToIcsDateTime,
  parseIcs,
  toIcs,
  unfoldLines,
} from './index';

// Hand-rolled runner so the project keeps zero dependencies, including
// @types/node. These two declarations are all the host access it needs.
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const process: { exitCode?: number };

const tests: Array<{ name: string; fn: () => void }> = [];

function test(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

// Sorted keys and dropped undefineds, so { a: 1, b: undefined } equals { a: 1 }.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

function assertEqual(actual: unknown, expected: unknown): void {
  const a = canonical(actual);
  const e = canonical(expected);
  if (a !== e) throw new Error(`expected ${e}\n    got      ${a}`);
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error('expected function to throw');
}

function wrap(...eventLines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...eventLines, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

test('parses a UTC event', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'UID:standup@example.com',
    'SUMMARY:Team standup',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T091500Z',
    'LOCATION:Zoom',
    'END:VEVENT',
  );
  assertEqual(parseIcs(ics), [
    {
      uid: 'standup@example.com',
      summary: 'Team standup',
      start: '2024-01-15T09:00:00Z',
      end: '2024-01-15T09:15:00Z',
      allDay: false,
      location: 'Zoom',
    },
  ]);
});

test('floating times keep no Z suffix', () => {
  assertEqual(icsDateTimeToIso('20240115T090000'), '2024-01-15T09:00:00');
  assertEqual(isoToIcsDateTime('2024-01-15T09:00:00'), '20240115T090000');
});

test('rejects malformed date values', () => {
  assertThrows(() => icsDateTimeToIso('2024-01-15'));
  assertThrows(() => icsDateTimeToIso('20240115T0900'));
  assertThrows(() => isoToIcsDateTime('20240115T090000Z'));
});

test('parses all-day events and writes VALUE=DATE back out', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'UID:holiday',
    'SUMMARY:Holiday',
    'DTSTART;VALUE=DATE:20240115',
    'DTEND;VALUE=DATE:20240116',
    'END:VEVENT',
  );
  const events = parseIcs(ics);
  assertEqual(events[0].start, '2024-01-15');
  assertEqual(events[0].end, '2024-01-16');
  assertEqual(events[0].allDay, true);
  const out = toIcs(events);
  assertEqual(out.includes('DTSTART;VALUE=DATE:20240115\r\n'), true);
  assertEqual(out.includes('DTEND;VALUE=DATE:20240116\r\n'), true);
});

test('keeps TZID as wall-clock time plus zone name', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'UID:ny',
    'SUMMARY:Call',
    'DTSTART;TZID=America/New_York:20240115T090000',
    'DTEND;TZID=America/New_York:20240115T100000',
    'END:VEVENT',
  );
  const events = parseIcs(ics);
  assertEqual(events[0].start, '2024-01-15T09:00:00');
  assertEqual(events[0].tzid, 'America/New_York');
  const out = toIcs(events);
  assertEqual(out.includes('DTSTART;TZID=America/New_York:20240115T090000\r\n'), true);
  assertEqual(out.includes('DTEND;TZID=America/New_York:20240115T100000\r\n'), true);
});

test('unfolds continuation lines, dropping one leading space or tab', () => {
  assertEqual(unfoldLines('SUMMARY:Hello\r\n  world\r\nUID:x'), ['SUMMARY:Hello world', 'UID:x']);
  assertEqual(unfoldLines('SUMMARY:ab\n\tcd\n'), ['SUMMARY:abcd']);
});

test('parses a folded SUMMARY', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'UID:fold',
    'SUMMARY:A very long tit',
    ' le split across lines',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T100000Z',
    'END:VEVENT',
  );
  assertEqual(parseIcs(ics)[0].summary, 'A very long title split across lines');
});

test('foldLine output stays within 75 chars and unfolds to the original', () => {
  const line = 'DESCRIPTION:' + 'abcdefghij'.repeat(25);
  const folded = foldLine(line);
  for (const physical of folded.split('\r\n')) {
    assertEqual(physical.length <= 75, true);
  }
  assertEqual(unfoldLines(folded), [line]);
});

test('short lines are not folded', () => {
  assertEqual(foldLine('UID:short'), 'UID:short');
});

test('escapes and unescapes text', () => {
  const raw = 'a, b; c\\d\ne';
  assertEqual(escapeText(raw), 'a\\, b\\; c\\\\d\\ne');
  assertEqual(unescapeText(escapeText(raw)), raw);
  assertEqual(unescapeText('line\\Nbreak'), 'line\nbreak');
});

test('skips events missing required properties', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'SUMMARY:No uid',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T100000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ok',
    'SUMMARY:Fine',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T100000Z',
    'END:VEVENT',
  );
  const events = parseIcs(ics);
  assertEqual(events.length, 1);
  assertEqual(events[0].uid, 'ok');
});

test('ignores properties outside a VEVENT', () => {
  const ics = wrap(
    'SUMMARY:calendar level',
    'BEGIN:VEVENT',
    'UID:a',
    'SUMMARY:Inside',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T100000Z',
    'END:VEVENT',
  );
  assertEqual(parseIcs(ics)[0].summary, 'Inside');
});

test('parses multiple events in order', () => {
  const ics = wrap(
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:First',
    'DTSTART:20240115T090000Z',
    'DTEND:20240115T100000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'SUMMARY:Second',
    'DTSTART:20240116T090000Z',
    'DTEND:20240116T100000Z',
    'END:VEVENT',
  );
  assertEqual(parseIcs(ics).map((e) => e.uid), ['1', '2']);
});

test('round-trips events through toIcs and parseIcs', () => {
  const events: CalendarEvent[] = [
    {
      uid: 'utc@example.com',
      summary: 'Planning, Q1; draft',
      start: '2024-03-01T14:00:00Z',
      end: '2024-03-01T15:30:00Z',
      allDay: false,
      description: 'Agenda:\nbudget, hiring; ' + 'long text '.repeat(30),
      location: 'Room 4, Floor 2',
    },
    {
      uid: 'allday@example.com',
      summary: 'Offsite',
      start: '2024-03-04',
      end: '2024-03-06',
      allDay: true,
    },
    {
      uid: 'zoned@example.com',
      summary: 'Sync',
      start: '2024-03-05T09:00:00',
      end: '2024-03-05T09:30:00',
      allDay: false,
      tzid: 'Europe/Berlin',
    },
  ];
  assertEqual(parseIcs(toIcs(events)), events);
});

test('toIcs output is stable across a second pass', () => {
  const events = parseIcs(
    wrap(
      'BEGIN:VEVENT',
      'UID:s',
      'SUMMARY:Stable',
      'DTSTART:20240115T090000Z',
      'DTEND:20240115T100000Z',
      'END:VEVENT',
    ),
  );
  const once = toIcs(events);
  assertEqual(toIcs(parseIcs(once)), once);
});

test('toIcs wraps events in a VCALENDAR with CRLF endings', () => {
  const out = toIcs([]);
  assertEqual(out, 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ical-json-bridge//EN\r\nEND:VCALENDAR\r\n');
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n    ${(err as Error).message}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exitCode = 1;
