/** Copy dictionaries for the archived-session Settings page. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '已归档会话',
  search: '搜索已归档会话',
  loading: '正在读取会话…',
  empty: '暂无已归档会话。',
  unavailable: '这里没有可恢复的已归档会话。',
  emptySearch: '没有匹配的会话。',
  unarchive: '取消归档',
  unarchiveNamed: '取消归档 {title}',
  ungrouped: '未分组',
  delete: '删除',
  deleteNamed: '删除 {title}',
  confirmTitle: '永久删除会话？',
  confirmBody: '“{title}”及其全部会话历史将被永久删除，此操作无法恢复。',
  confirmAcknowledge: '我已了解此操作无法恢复',
  confirmAction: '永久删除',
  cancel: '取消',
  close: '关闭',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
} satisfies Record<string, string>

/** Archived-session page locale key union. */
export type ArchivedSessionsLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Archived sessions',
  search: 'Search archived sessions',
  loading: 'Reading sessions…',
  empty: 'No archived sessions.',
  unavailable: 'No archived session here can be restored.',
  emptySearch: 'No matching sessions.',
  unarchive: 'Unarchive',
  unarchiveNamed: 'Unarchive {title}',
  ungrouped: 'Ungrouped',
  delete: 'Delete',
  deleteNamed: 'Delete {title}',
  confirmTitle: 'Delete session permanently?',
  confirmBody: '"{title}" and its entire session history will be permanently erased. This cannot be undone.',
  confirmAcknowledge: 'I understand this cannot be undone',
  confirmAction: 'Delete permanently',
  cancel: 'Cancel',
  close: 'Close',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
} satisfies Record<ArchivedSessionsLocaleKey, string>
