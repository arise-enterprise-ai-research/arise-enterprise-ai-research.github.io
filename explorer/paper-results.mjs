// Published aggregate references stay outside the catalog of recorded task runs.
export const automationBenchPaper = {
  source: {
    title: 'AutomationBench, arXiv v1, section 6',
    url: 'https://arxiv.org/html/2604.18934v1#S6',
    scoringUrl: 'https://arxiv.org/html/2604.18934v1#S4',
    published: '2026-04-21',
  },
  taskSet: 'Private evaluation tasks',
  taskLevelResults: false,
  entries: [
    {id: 'opus-4.7-max', model: 'Opus 4.7', effort: 'max', scorePercent: 9.9, costPerTaskUsd: 1.80},
    {id: 'gemini-3.1-pro-high', model: 'Gemini 3.1 Pro', effort: 'high', scorePercent: 9.6, costPerTaskUsd: 0.54},
    {id: 'gpt-5.4-high', model: 'GPT 5.4', effort: 'high', scorePercent: 7.6, costPerTaskUsd: 1.93},
    {id: 'sonnet-4.6-max', model: 'Sonnet 4.6', effort: 'max', scorePercent: 5.3, costPerTaskUsd: 1.81},
    {id: 'haiku-4.5', model: 'Haiku 4.5', effort: 'not specified', scorePercent: 1.5, costPerTaskUsd: 0.18},
    {id: 'gpt-5.4-none', model: 'GPT 5.4', effort: 'no reasoning', scorePercent: 1.2, costPerTaskUsd: 0.19},
  ],
};
