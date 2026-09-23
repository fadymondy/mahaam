// API methods owned by the issues feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
import type { MahaamClient } from "@mahaam/client";

import type { Comment } from "../shared/types";

const e = encodeURIComponent;

export function issuesApi(c: MahaamClient) {
  return {
    /** Edit your own comment. */
    editComment: (id: string, body: string) => c.request<Comment>("PATCH", `/api/w/comments/${e(id)}`, { body: { body } }),
    /** Delete your own comment (managers: any). */
    deleteComment: (id: string) => c.request<void>("DELETE", `/api/w/comments/${e(id)}`),
  };
}
