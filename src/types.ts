export interface CalendarEvent {
  uid: string;
  summary: string;
  /** ISO 8601. "2024-01-15" when allDay is true, otherwise "2024-01-15T09:00:00Z" or without the trailing Z for a floating time. */
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  /** IANA zone name from a DTSTART/DTEND TZID param, e.g. "America/New_York". When set, start/end are wall-clock time in that zone, not UTC — there's no VTIMEZONE/offset table here to convert them. */
  tzid?: string;
}
