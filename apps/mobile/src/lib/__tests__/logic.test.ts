import { createSseParser, type SseEvent } from "@/api/sse";
import type { Status, Task, TimeEntry } from "@/api/types";
import { boardOrder } from "../board";
import { invalidationsFor } from "../invalidate";
import { reminderAt } from "../reminders";
import { addDays, entrySeconds, formatClock, formatDuration, localDay, parseMinutes, todaySummary, weekStartOf } from "../time";

jest.mock("expo-notifications", () => ({ setNotificationHandler: jest.fn() }));

describe("SSE parser", () => {
  it("parses events split across chunks, CRLF, comments and retry", () => {
    const got: SseEvent[] = [];
    const p = createSseParser((e) => got.push(e));
    p.push("retry: 3000\n\nevent: timer.state\nda");
    p.push('ta: {"running":null}\r\n\r\n: keepalive\n\n');
    p.push("event: notification.new\ndata: a\ndata: b\n\n");
    expect(p.retry()).toBe(3000);
    expect(got).toEqual([
      { event: "timer.state", data: '{"running":null}', id: undefined },
      { event: "notification.new", data: "a\nb", id: undefined },
    ]);
  });

  it("maps events to the queries they invalidate", () => {
    expect(invalidationsFor({ event: "timer.started", data: "" })).toEqual(["running", "entries", "timesheet"]);
    expect(invalidationsFor({ event: "notification.new", data: "" })).toEqual(["inbox"]);
    expect(invalidationsFor({ event: "other", data: "" })).toEqual([]);
  });
});

const entry = (over: Partial<TimeEntry>): TimeEntry =>
  ({
    id: "e",
    user_id: "u",
    project_id: null,
    project_name: null,
    project_color: null,
    client_name: null,
    task_id: null,
    task_key: null,
    task_title: null,
    description: "",
    billable: true,
    source: "timer",
    started_at: "2026-09-18T09:00:00Z",
    ended_at: null,
    duration_s: null,
    locked: false,
    ...over,
  }) as TimeEntry;

describe("time math", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("counts a running entry to now and a stopped one by duration", () => {
    expect(entrySeconds(entry({}), now)).toBe(3 * 3600);
    expect(entrySeconds(entry({ ended_at: "2026-09-18T09:30:00Z", duration_s: 1800 }), now)).toBe(1800);
  });

  it("summarises today in the workspace timezone, merging the running timer once", () => {
    const running = entry({ id: "r", started_at: "2026-09-18T11:00:00Z" });
    const list = [
      entry({ id: "a", started_at: "2026-09-18T08:00:00Z", ended_at: "2026-09-18T09:00:00Z", duration_s: 3600 }),
      running,
      entry({ id: "old", started_at: "2026-09-17T08:00:00Z", ended_at: "2026-09-17T09:00:00Z", duration_s: 3600 }),
    ];
    const s = todaySummary(list, running, now, "UTC");
    expect(s.entries.map((e) => e.id)).toEqual(["r", "a"]);
    expect(s.total).toBe(3600 + 3600);
    // 23:30 UTC on the 17th is already the 18th in Cairo (UTC+3).
    expect(localDay(new Date("2026-09-17T23:30:00Z"), "Africa/Cairo")).toBe("2026-09-18");
  });

  it("formats clocks and durations", () => {
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(65, false)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(formatDuration(45 * 60)).toBe("45m");
  });

  it("parses durations people type", () => {
    expect(parseMinutes("1h30")).toBe(90);
    expect(parseMinutes("1:15")).toBe(75);
    expect(parseMinutes("45m")).toBe(45);
    expect(parseMinutes("1.5h")).toBe(90);
    expect(parseMinutes("90")).toBe(90);
    expect(parseMinutes("soon")).toBeNull();
  });

  it("finds the week start and walks days", () => {
    expect(weekStartOf(new Date(2026, 8, 18), 1)).toBe("2026-09-14"); // Friday → Monday
    expect(weekStartOf(new Date(2026, 8, 18), 6)).toBe("2026-09-12"); // Saturday weeks
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
  });

  it("schedules the long-timer reminder only in the future", () => {
    const e = { started_at: "2026-09-18T09:00:00Z" };
    expect(reminderAt(e, 8, now)).toBe(Date.parse("2026-09-18T17:00:00Z"));
    expect(reminderAt(e, 2, now)).toBeNull();
    expect(reminderAt(e, 0, now)).toBeNull();
  });
});

describe("board order", () => {
  const st = (id: string, category: Status["category"], position: number): Status =>
    ({ id, name: id, color: "", icon: "", labels: {}, category, position, project_id: "p", stage: category, task_count: 0 });
  const task = (key: string, status_id: string, position: number): Task =>
    ({ id: key, key, title: key, project_id: "p", status_id, position, priority: "none", completed_at: null }) as Task;

  it("groups doing → todo → done, by column then position", () => {
    const statuses = new Map([
      ["todo", st("todo", "todo", 1)],
      ["prog", st("prog", "doing", 2)],
      ["review", st("review", "doing", 3)],
      ["done", st("done", "done", 4)],
    ]);
    const out = boardOrder(
      [task("A", "todo", 2), task("B", "review", 1), task("C", "prog", 5), task("D", "todo", 1), task("E", "done", 1)],
      statuses,
    );
    expect(out.map((s) => [s.category, s.items.map((t) => t.key)])).toEqual([
      ["doing", ["C", "B"]],
      ["todo", ["D", "A"]],
      ["done", ["E"]],
    ]);
  });
});
