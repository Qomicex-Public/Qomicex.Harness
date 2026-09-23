/** Web provider selection row copy (zh). */
export const zh = {
  'search.title': '网页搜索工具',
  'fetch.title': '网页抓取工具',
  'provider.deepseek-official': 'DeepSeek 官方搜索',
  'provider.firecrawl': 'Firecrawl',
  'provider.exa': 'Exa',
  'provider.perplexity': 'Perplexity',
  'provider.http': '匿名 HTTP 抓取',
}

/** Web provider selection row copy (en). */
export const en = {
  'search.title': 'Web search backend',
  'fetch.title': 'Web fetch backend',
  'provider.deepseek-official': 'DeepSeek official search',
  'provider.firecrawl': 'Firecrawl',
  'provider.exa': 'Exa',
  'provider.perplexity': 'Perplexity',
  'provider.http': 'Anonymous HTTP fetch',
}

/** Row copy keys: the two row titles plus one label key per provider id. */
export type WebSettingsKey = keyof typeof en
