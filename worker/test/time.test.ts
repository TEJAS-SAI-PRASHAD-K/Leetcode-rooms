import { describe, expect, it } from "vitest";
import {
  addDays,
  dayWindow,
  epochForLocalTime,
  isPastPickDeadline,
  isValidTimeZone,
  localDate,
} from "../src/time.js";

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("localDate", () => {
  it("rolls the date over at local midnight, not UTC midnight", () => {
    // 2026-10-25T20:00:00Z is already the 26th in Asia/Kolkata (UTC+5:30).
    const t = Math.floor(Date.parse("2026-10-25T20:00:00Z") / 1000);
    expect(localDate(t, "UTC")).toBe("2026-10-25");
    expect(localDate(t, "Asia/Kolkata")).toBe("2026-10-26");
    // ...and still the 25th in Los Angeles.
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-10-25");
  });
});

describe("epochForLocalTime", () => {
  it("resolves a local wall time to the right instant", () => {
    const t = epochForLocalTime("2026-10-25", "00:00", "Asia/Kolkata");
    // Local midnight IST is 18:30 UTC the previous day.
    expect(new Date(t * 1000).toISOString()).toBe("2026-10-24T18:30:00.000Z");
  });

  it("round-trips through localDate", () => {
    for (const tz of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Australia/Sydney"]) {
      const t = epochForLocalTime("2026-06-15", "12:00", tz);
      expect(localDate(t, tz)).toBe("2026-06-15");
    }
  });

  it("handles a DST fall-back date without drifting off the day", () => {
    // US DST ended 2026-11-01. Local midnight must still be on 11-01.
    const t = epochForLocalTime("2026-11-01", "00:00", "America/New_York");
    expect(localDate(t, "America/New_York")).toBe("2026-11-01");
  });

  it("handles a DST spring-forward date without drifting off the day", () => {
    // US DST began 2026-03-08; 02:00-03:00 local does not exist.
    const t = epochForLocalTime("2026-03-08", "00:00", "America/New_York");
    expect(localDate(t, "America/New_York")).toBe("2026-03-08");
  });
});

describe("dayWindow", () => {
  it("spans exactly one local day", () => {
    const { start, end } = dayWindow("2026-10-25", "Asia/Kolkata");
    expect(localDate(start, "Asia/Kolkata")).toBe("2026-10-25");
    expect(localDate(end, "Asia/Kolkata")).toBe("2026-10-25");
    expect(end - start).toBe(86_399);
  });

  it("is 23 hours long on a spring-forward day", () => {
    // The window must track real elapsed time, or a solve late on the clock
    // change day would fall outside it and go unverified.
    const { start, end } = dayWindow("2026-03-08", "America/New_York");
    expect(end - start).toBe(23 * 3600 - 1);
  });

  it("is 25 hours long on a fall-back day", () => {
    const { start, end } = dayWindow("2026-11-01", "America/New_York");
    expect(end - start).toBe(25 * 3600 - 1);
  });

  it("leaves no gap between consecutive days", () => {
    const a = dayWindow("2026-10-25", "Asia/Kolkata");
    const b = dayWindow("2026-10-26", "Asia/Kolkata");
    expect(b.start - a.end).toBe(1);
  });
});

describe("addDays", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isPastPickDeadline", () => {
  const base = {
    date: "2026-10-25",
    pickDeadlineLocal: "20:00",
    timeZone: "Asia/Kolkata",
  };

  it("is false before and true after the local deadline", () => {
    const deadline = epochForLocalTime("2026-10-25", "20:00", "Asia/Kolkata");
    expect(isPastPickDeadline({ ...base, now: deadline - 60 })).toBe(false);
    expect(isPastPickDeadline({ ...base, now: deadline + 60 })).toBe(true);
  });

  it("is judged in the room's zone, not the server's", () => {
    // 15:00 UTC is past 20:00 IST but well before 20:00 in New York.
    const now = Math.floor(Date.parse("2026-10-25T15:00:00Z") / 1000);
    expect(isPastPickDeadline({ ...base, now })).toBe(true);
    expect(
      isPastPickDeadline({ ...base, now, timeZone: "America/New_York" }),
    ).toBe(false);
  });
});
