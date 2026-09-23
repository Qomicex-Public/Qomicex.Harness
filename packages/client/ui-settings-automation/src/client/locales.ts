/** Automation settings row dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'browser.label': '浏览器',
  'browser.hint': '新启动的浏览器使用的浏览器类型',
  'browser.chromium': 'Chromium（内置）',
  'browser.chrome': 'Chrome（系统安装）',
  'browser.msedge': 'Edge（系统安装）',
  'executablePath.label': '浏览器路径',
  'executablePath.hint': '可留空。留空时按所选浏览器自动查找安装位置',
  'executablePath.placeholder': '留空使用默认安装位置',
  'headless.label': '无头运行',
  'headless.hint': '不显示浏览器窗口；关闭后可在桌面上看到浏览器操作过程',
  'unavailable': '当前部署没有挂载设置服务，无法调整。',
  'saveFailed': '保存失败：',
} satisfies Record<string, string>

/** The automation namespace key union. */
export type AutomationLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'browser.label': 'Browser',
  'browser.hint': 'Which browser a newly launched browser resolves',
  'browser.chromium': 'Chromium (bundled)',
  'browser.chrome': 'Chrome (system install)',
  'browser.msedge': 'Edge (system install)',
  'executablePath.label': 'Browser path',
  'executablePath.hint': 'Optional. Leave empty to let the selected browser resolve its own installation',
  'executablePath.placeholder': 'Empty uses the default installation',
  'headless.label': 'Headless',
  'headless.hint': 'Run the browser without a visible window; turn off to watch it on the desktop',
  'unavailable': 'No settings service is mounted; this cannot be changed.',
  'saveFailed': 'Failed to save: ',
} satisfies Record<AutomationLocaleKey, string>
