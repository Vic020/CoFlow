import type { Todo } from "./todo";

// The API supports all columns in a single paginated query; never truncate at 200.
export async function loadTodoPages(
  read: <T>(path: string) => Promise<T>,
  filters: Record<string, string>,
): Promise<Todo[]> {
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries(filters).filter(
        ([key, value]) => value !== "" && !(key === "scope" && value === "all"),
      ),
    ),
  );
  params.set("limit", "200");
  const items: Todo[] = [];
  const cursors = new Set<string>();
  for (;;) {
    const page = await read<{ items: Todo[]; next_cursor: string }>(
      `/todos?${params}`,
    );
    items.push(...page.items);
    if (!page.next_cursor) return items;
    if (cursors.has(page.next_cursor))
      throw new Error("分页已变化，请刷新看板");
    cursors.add(page.next_cursor);
    params.set("cursor", page.next_cursor);
  }
}
