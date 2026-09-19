// A minimal text/event-stream parser (the subset the API emits: event, data, id, retry, comments).
// Pure and incremental: feed it chunks as they arrive, it calls onEvent per complete event.

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  push(chunk: string): void;
  /** The last `retry:` value in ms, if the server sent one. */
  retry(): number | undefined;
}

export function createSseParser(onEvent: (e: SseEvent) => void): SseParser {
  let buf = "";
  let event = "";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  const dispatch = () => {
    if (data.length) onEvent({ event: event || "message", data: data.join("\n"), id });
    event = "";
    data = [];
  };

  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  };

  return {
    push(chunk) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.search(/\r\n|\n|\r/)) >= 0) {
        const sep = buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1;
        line(buf.slice(0, nl));
        buf = buf.slice(nl + sep);
      }
    },
    retry: () => retry,
  };
}
