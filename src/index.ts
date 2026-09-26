import type { CalendarEvent } from './types';

export type { CalendarEvent };

// RFC 5545 folds lines at 75 octets by inserting CRLF followed by a
// single space or tab. Unfolding has to happen before anything else
// touches the text, or a long SUMMARY/DESCRIPTION gets split mid-value.
export function unfoldLines(ics: string): string[] {
  const rawLines = ics.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

export function foldLine(line: string): string {
  const limit = 75;
  if (line.length <= limit) return line;
  let result = line.slice(0, limit);
  let rest = line.slice(limit);
  while (rest.length > 0) {
    const chunkSize = limit - 1; // leave room for the leading space
    result += '\r\n ' + rest.slice(0, chunkSize);
    rest = rest.slice(chunkSize);
  }
  return result;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function unescapeText(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') {
        result += '\n';
        i++;
      } else if (next === '\\' || next === ';' || next === ',') {
        result += next;
        i++;
      } else {
        result += c;
      }
    } else {
      result += c;
    }
  }
  return result;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

function splitContentLine(line: string): ContentLine {
  const colonIndex = line.indexOf(':');
  const head = colonIndex === -1 ? line : line.slice(0, colonIndex);
  const value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq !== -1) {
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
    }
  }
  return { name, params, value };
}

const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

// No Date object here on purpose: parsing a floating (no "Z") value with
// `new Date(...)` pulls in the host's local timezone, which makes the
// result depend on where the code runs instead of only on its input.
export function icsDateTimeToIso(value: string): string {
  const dt = DATE_TIME_RE.exec(value);
  if (dt) {
    const [, y, mo, d, h, mi, s, z] = dt;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
  }
  const d = DATE_RE.exec(value);
  if (d) {
    const [, y, mo, day] = d;
    return `${y}-${mo}-${day}`;
  }
  throw new Error(`unrecognized ICS date value: ${value}`);
}

const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z)?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoToIcsDateTime(iso: string): string {
  const dt = ISO_DATE_TIME_RE.exec(iso);
  if (dt) {
    const [, y, mo, d, h, mi, s, z] = dt;
    return `${y}${mo}${d}T${h}${mi}${s}${z ? 'Z' : ''}`;
  }
  const d = ISO_DATE_RE.exec(iso);
  if (d) {
    const [, y, mo, day] = d;
    return `${y}${mo}${day}`;
  }
  throw new Error(`unrecognized ISO date value: ${iso}`);
}

export function parseIcs(ics: string): CalendarEvent[] {
  const lines = unfoldLines(ics);
  const events: CalendarEvent[] = [];
  let current: Partial<CalendarEvent> | null = null;

  for (const line of lines) {
    const { name, params, value } = splitContentLine(line);

    if (name === 'BEGIN' && value === 'VEVENT') {
      current = {};
      continue;
    }

    if (name === 'END' && value === 'VEVENT') {
      if (current && current.uid && current.summary && current.start && current.end) {
        events.push({
          uid: current.uid,
          summary: current.summary,
          start: current.start,
          end: current.end,
          allDay: current.allDay ?? false,
          description: current.description,
          location: current.location,
          tzid: current.tzid,
        });
      }
      current = null;
      continue;
    }

    if (!current) continue;

    switch (name) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeText(value);
        break;
      case 'LOCATION':
        current.location = unescapeText(value);
        break;
      case 'DTSTART':
        current.start = icsDateTimeToIso(value);
        current.allDay = params.VALUE === 'DATE';
        if (params.TZID) current.tzid = params.TZID;
        break;
      case 'DTEND':
        current.end = icsDateTimeToIso(value);
        if (params.TZID) current.tzid = params.TZID;
        break;
      default:
        break;
    }
  }

  return events;
}

export function toIcs(events: CalendarEvent[]): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ical-json-bridge//EN'];

  for (const event of events) {
    const dateParams = event.allDay ? ';VALUE=DATE' : event.tzid ? `;TZID=${event.tzid}` : '';
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${event.uid}`));
    lines.push(foldLine(`SUMMARY:${escapeText(event.summary)}`));
    lines.push(foldLine(`DTSTART${dateParams}:${isoToIcsDateTime(event.start)}`));
    lines.push(foldLine(`DTEND${dateParams}:${isoToIcsDateTime(event.end)}`));
    if (event.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(event.description)}`));
    }
    if (event.location) {
      lines.push(foldLine(`LOCATION:${escapeText(event.location)}`));
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
