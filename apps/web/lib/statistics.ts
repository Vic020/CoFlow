export const statisticLabels: Record<string, string> = {
  reports_created: "新增进展",
  reports_delivered: "其中当前已交付",
  delivery_links: "交付链接",
  reporters: "上报成员",
  todos_open: "未完成任务",
  todos_review: "待确认任务",
  todos_overdue: "逾期任务",
  todos_created: "新增任务",
  todos_completed: "完成任务",
  todos_reopened: "重开任务",
  todos_unscheduled: "待排期任务",
  calendar_nodes: "计划节点",
  scheduled_todos: "已排期任务",
  scheduled_completed: "其中当前已完成",
  collaborations_open: "待处理协作",
  collaborations_created: "新增协作",
  collaborations_completed: "完成协作",
  collaborations_transferred: "已转交任务的协作",
};
export type StatisticRecord = {
  id: string;
  title: string;
  url: string;
  at: string;
  project: string;
  domains: string[];
  member: string;
  agent: string;
  model: string;
  hours?: number;
};
export type StatisticsResult = {
  sources?: { agents: string[]; models: string[] };
  from: string;
  to: string;
  timezone: string;
  generated_at: string;
  revision: string;
  capabilities: Record<string, boolean>;
  metrics: { key: string; basis: string; count: number }[];
  trend: { day: string; values: Record<string, number> }[];
  groups: { key: string; values: Record<string, number> }[];
  details: StatisticRecord[];
  detail_total: number;
  next_offset: number;
  has_more: boolean;
  duration: Record<string, number>;
  coverage: string[];
};
