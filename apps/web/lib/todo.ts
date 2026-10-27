import type { Link } from "./types";
export type TodoColumn = {
  task_count?: number;
  id: string;
  name: string;
  done: boolean;
  archived: boolean;
  revision: number;
};
export type TodoEvent = {
  id: string;
  actor_id: string;
  agent: string;
  model: string;
  action: string;
  created_at: string;
  before: Partial<Todo>;
  after: Partial<Todo>;
};
export type Todo = {
  unavailable_reports?: number;
  id: string;
  source_id: string;
  creator_id: string;
  title: string;
  body: string;
  column_id: string;
  previous_column_id: string;
  assignee_id: string;
  project_id: string;
  domains: string[];
  priority: string;
  due_date: string;
  links: Link[];
  report_ids: string[];
  collaboration_id: string;
  agent: string;
  model: string;
  revision: number;
  archived: boolean;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  comments: {
    id: string;
    author_id: string;
    body: string;
    mentions: string[];
    created_at: string;
    deleted: boolean;
  }[];
  history: TodoEvent[];
};
export type TodoBoardData = {
  history?: TodoEvent[];
  revision: number;
  default_done_id: string;
  columns: TodoColumn[];
};
export const emptyTodo = (column: string): Todo => ({
  id: "",
  source_id: "",
  creator_id: "",
  title: "",
  body: "",
  column_id: column,
  previous_column_id: "",
  assignee_id: "",
  project_id: "",
  domains: [],
  priority: "none",
  due_date: "",
  links: [],
  report_ids: [],
  collaboration_id: "",
  agent: "",
  model: "",
  revision: 0,
  archived: false,
  position: 0,
  completed_at: null,
  created_at: "",
  updated_at: "",
  comments: [],
  history: [],
});
// Built-in columns are translated; user names and renamed columns remain authored content.
export function defaultColumnName(c: TodoColumn) {
  return (
    c.revision === 1 && ["backlog", "doing", "review", "done"].includes(c.id)
  );
}
