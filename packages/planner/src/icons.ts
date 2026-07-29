/**
 * The built-in icon vocabulary.
 *
 * The zero-API-key visuals path draws from `lucide-static`, so the planner only
 * ever emits asset ids that are real lucide icon slugs. Keys here are the words
 * an author actually writes; the value is the icon slug plus a drawing prompt
 * that the (opt-in) image adapters can use instead.
 *
 * Deliberately conservative: long-stable lucide names only, so an icon-set
 * upgrade cannot silently blank out a video.
 */

export type IconEntry = {
  /** lucide-static slug — `icons/<slug>.svg`. */
  slug: string;
  /** Words and phrases that should resolve to this icon. */
  terms: string[];
  /** Fallback prompt for generative adapters. */
  prompt: string;
};

export const ICONS: IconEntry[] = [
  {
    slug: 'user',
    terms: ['user', 'person', 'customer', 'client', 'human', 'reader', 'learner', 'student'],
    prompt: 'a single person, simple line drawing',
  },
  {
    slug: 'users',
    terms: ['users', 'people', 'team', 'group', 'audience', 'community', 'crowd', 'staff'],
    prompt: 'a small group of people',
  },
  {
    slug: 'brain',
    terms: [
      'brain',
      'intelligence',
      'thinking',
      'cognition',
      'mind',
      'neural',
      'learning',
      'intuition',
    ],
    prompt: 'a stylised brain',
  },
  {
    slug: 'bot',
    terms: ['bot', 'agent', 'robot', 'assistant', 'chatbot', 'llm'],
    prompt: 'a friendly robot head',
  },
  {
    slug: 'cpu',
    terms: ['cpu', 'processor', 'chip', 'compute', 'hardware', 'gpu', 'silicon'],
    prompt: 'a microchip seen from above',
  },
  {
    slug: 'database',
    terms: ['database', 'table', 'sql', 'store', 'storage', 'warehouse', 'dataset', 'records'],
    prompt: 'a stack of database discs',
  },
  {
    slug: 'server',
    terms: ['server', 'backend', 'host', 'machine', 'instance', 'node', 'cluster'],
    prompt: 'a rack server',
  },
  {
    slug: 'cloud',
    terms: ['cloud', 'saas', 'hosted', 'remote', 'aws', 'azure', 'internet'],
    prompt: 'a cloud outline',
  },
  {
    slug: 'globe',
    terms: [
      'globe',
      'world',
      'global',
      'web',
      'internet',
      'earth',
      'planet',
      'network',
      'http',
      'website',
    ],
    prompt: 'a globe with meridians',
  },
  {
    slug: 'network',
    terms: ['topology', 'graph', 'mesh', 'connections', 'links', 'nodes'],
    prompt: 'three connected nodes',
  },
  {
    slug: 'share-2',
    terms: ['share', 'sharing', 'distribute', 'broadcast', 'publish'],
    prompt: 'a share node graph',
  },
  {
    slug: 'git-branch',
    terms: ['branch', 'git', 'version', 'fork', 'variant', 'alternative'],
    prompt: 'a branching version line',
  },
  {
    slug: 'git-merge',
    terms: ['merge', 'combine', 'join', 'integrate', 'converge'],
    prompt: 'two lines merging',
  },
  {
    slug: 'workflow',
    terms: ['workflow', 'pipeline', 'process', 'stages', 'orchestration'],
    prompt: 'connected boxes forming a pipeline',
  },
  {
    slug: 'repeat',
    terms: ['repeat', 'loop', 'iterate', 'iteration', 'cycle', 'again', 'recursion'],
    prompt: 'a circular arrow loop',
  },
  {
    slug: 'code',
    terms: ['code', 'source', 'program', 'script', 'syntax', 'software'],
    prompt: 'angle brackets',
  },
  {
    slug: 'terminal',
    terms: ['terminal', 'shell', 'cli', 'command', 'console', 'bash'],
    prompt: 'a terminal window with a prompt',
  },
  {
    slug: 'file-text',
    terms: ['file', 'document', 'doc', 'paper', 'report', 'text', 'article', 'page'],
    prompt: 'a document with lines of text',
  },
  {
    slug: 'folder',
    terms: ['folder', 'directory', 'project', 'repository', 'collection'],
    prompt: 'a folder',
  },
  {
    slug: 'search',
    terms: ['search', 'find', 'lookup', 'query', 'retrieval', 'discover', 'explore'],
    prompt: 'a magnifying glass',
  },
  {
    slug: 'filter',
    terms: ['filter', 'filtering', 'select', 'narrow', 'subset', 'prune'],
    prompt: 'a funnel',
  },
  {
    slug: 'key',
    terms: ['key', 'secret', 'credential', 'token', 'password', 'api key'],
    prompt: 'a key',
  },
  {
    slug: 'lock',
    terms: ['lock', 'secure', 'security', 'encrypted', 'private', 'locked'],
    prompt: 'a closed padlock',
  },
  {
    slug: 'shield',
    terms: ['shield', 'protection', 'defence', 'defense', 'safety', 'guard', 'trust'],
    prompt: 'a shield',
  },
  {
    slug: 'eye',
    terms: ['eye', 'vision', 'observe', 'watch', 'visibility', 'monitor', 'see', 'attention'],
    prompt: 'an open eye',
  },
  {
    slug: 'rocket',
    terms: ['rocket', 'launch', 'ship', 'deploy', 'startup', 'liftoff', 'release'],
    prompt: 'a rocket taking off',
  },
  {
    slug: 'target',
    terms: ['target', 'goal', 'objective', 'aim', 'accuracy', 'precision', 'bullseye'],
    prompt: 'a target with concentric rings',
  },
  {
    slug: 'lightbulb',
    terms: ['idea', 'insight', 'lightbulb', 'inspiration', 'concept', 'intuition', 'realisation'],
    prompt: 'a lightbulb',
  },
  {
    slug: 'zap',
    terms: ['fast', 'speed', 'energy', 'power', 'instant', 'electricity', 'lightning', 'quick'],
    prompt: 'a lightning bolt',
  },
  {
    slug: 'clock',
    terms: ['clock', 'time', 'latency', 'duration', 'delay', 'schedule', 'timing', 'hours'],
    prompt: 'a clock face',
  },
  {
    slug: 'calendar',
    terms: ['calendar', 'date', 'month', 'week', 'deadline', 'timeline', 'planning'],
    prompt: 'a calendar page',
  },
  {
    slug: 'mail',
    terms: ['mail', 'email', 'message', 'letter', 'inbox', 'newsletter'],
    prompt: 'a sealed envelope',
  },
  {
    slug: 'send',
    terms: ['send', 'submit', 'dispatch', 'transmit', 'request'],
    prompt: 'a paper plane',
  },
  { slug: 'phone', terms: ['phone', 'call', 'telephone', 'dial'], prompt: 'a telephone handset' },
  {
    slug: 'message-circle',
    terms: ['chat', 'conversation', 'dialogue', 'comment', 'reply', 'prompt', 'talk'],
    prompt: 'a speech bubble',
  },
  {
    slug: 'bell',
    terms: ['bell', 'alert', 'notification', 'reminder', 'warning', 'signal'],
    prompt: 'a notification bell',
  },
  {
    slug: 'map',
    terms: ['map', 'territory', 'geography', 'region', 'area', 'atlas'],
    prompt: 'a folded map',
  },
  {
    slug: 'map-pin',
    terms: ['location', 'place', 'position', 'pin', 'where', 'coordinates', 'point'],
    prompt: 'a map pin',
  },
  {
    slug: 'book-open',
    terms: ['book', 'reading', 'chapter', 'literature', 'textbook', 'story', 'documentation'],
    prompt: 'an open book',
  },
  {
    slug: 'graduation-cap',
    terms: ['education', 'school', 'university', 'course', 'training', 'degree', 'academic'],
    prompt: 'a graduation cap',
  },
  {
    slug: 'briefcase',
    terms: ['business', 'work', 'job', 'company', 'enterprise', 'career', 'portfolio'],
    prompt: 'a briefcase',
  },
  {
    slug: 'building-2',
    terms: [
      'building',
      'office',
      'organisation',
      'organization',
      'institution',
      'firm',
      'headquarters',
    ],
    prompt: 'an office building',
  },
  {
    slug: 'factory',
    terms: ['factory', 'manufacturing', 'industry', 'plant', 'production', 'assembly'],
    prompt: 'a factory with chimneys',
  },
  {
    slug: 'truck',
    terms: ['truck', 'delivery', 'logistics', 'shipping', 'transport', 'freight', 'supply'],
    prompt: 'a delivery truck',
  },
  {
    slug: 'package',
    terms: [
      'package',
      'parcel',
      'bundle',
      'module',
      'library',
      'dependency',
      'artefact',
      'artifact',
    ],
    prompt: 'a cardboard box',
  },
  {
    slug: 'layers',
    terms: ['layer', 'layers', 'stack', 'levels', 'tiers', 'abstraction', 'depth'],
    prompt: 'three stacked sheets',
  },
  { slug: 'box', terms: ['box', 'container', 'unit', 'block', 'cube'], prompt: 'a cube' },
  {
    slug: 'wrench',
    terms: ['tool', 'fix', 'repair', 'maintenance', 'adjust', 'tune', 'tuning'],
    prompt: 'a wrench',
  },
  { slug: 'hammer', terms: ['hammer', 'build', 'construct', 'craft', 'make'], prompt: 'a hammer' },
  {
    slug: 'settings',
    terms: ['settings', 'configuration', 'config', 'options', 'gear', 'mechanism', 'engine'],
    prompt: 'a gear wheel',
  },
  {
    slug: 'sliders-horizontal',
    terms: [
      'parameter',
      'parameters',
      'hyperparameter',
      'control',
      'knob',
      'dial',
      'weights',
      'tuning',
    ],
    prompt: 'three slider controls',
  },
  {
    slug: 'gauge',
    terms: ['gauge', 'performance', 'benchmark', 'meter', 'throughput', 'metric', 'measurement'],
    prompt: 'a dial gauge',
  },
  {
    slug: 'activity',
    terms: ['activity', 'signal', 'pulse', 'heartbeat', 'monitoring', 'traffic', 'load'],
    prompt: 'an EKG activity line',
  },
  {
    slug: 'trending-up',
    terms: [
      'growth',
      'increase',
      'rise',
      'improve',
      'gain',
      'up',
      'upward',
      'better',
      'accelerate',
    ],
    prompt: 'an upward trending arrow',
  },
  {
    slug: 'trending-down',
    terms: [
      'decrease',
      'decline',
      'drop',
      'fall',
      'reduce',
      'loss',
      'down',
      'downward',
      'shrink',
      'descent',
    ],
    prompt: 'a downward trending arrow',
  },
  {
    slug: 'scale',
    terms: [
      'balance',
      'tradeoff',
      'trade-off',
      'compare',
      'comparison',
      'weigh',
      'fairness',
      'justice',
    ],
    prompt: 'a balance scale',
  },
  {
    slug: 'percent',
    terms: ['percent', 'percentage', 'rate', 'ratio', 'proportion', 'share'],
    prompt: 'a percent sign',
  },
  {
    slug: 'dollar-sign',
    terms: [
      'cost',
      'price',
      'money',
      'dollar',
      'revenue',
      'budget',
      'spend',
      'pricing',
      'cheap',
      'expensive',
    ],
    prompt: 'a dollar sign',
  },
  {
    slug: 'coins',
    terms: ['coins', 'cash', 'funds', 'currency', 'payment', 'economics', 'token'],
    prompt: 'a stack of coins',
  },
  {
    slug: 'credit-card',
    terms: ['card', 'credit', 'checkout', 'billing', 'subscription', 'invoice'],
    prompt: 'a credit card',
  },
  {
    slug: 'shopping-cart',
    terms: ['cart', 'shop', 'purchase', 'buy', 'order', 'ecommerce', 'retail'],
    prompt: 'a shopping cart',
  },
  {
    slug: 'calculator',
    terms: ['calculate', 'calculation', 'arithmetic', 'compute', 'maths', 'math', 'sum', 'formula'],
    prompt: 'a pocket calculator',
  },
  {
    slug: 'sigma',
    terms: ['sum', 'summation', 'sigma', 'aggregate', 'total', 'accumulate'],
    prompt: 'a sigma summation symbol',
  },
  {
    slug: 'infinity',
    terms: ['infinite', 'infinity', 'unbounded', 'endless', 'continuous'],
    prompt: 'an infinity symbol',
  },
  {
    slug: 'binary',
    terms: ['binary', 'bits', 'bytes', 'digital', 'encoding', 'ones and zeros'],
    prompt: 'rows of ones and zeros',
  },
  {
    slug: 'hash',
    terms: ['hash', 'checksum', 'fingerprint', 'digest', 'identifier'],
    prompt: 'a hash symbol',
  },
  {
    slug: 'atom',
    terms: ['atom', 'physics', 'particle', 'quantum', 'nucleus', 'element'],
    prompt: 'an atom with orbits',
  },
  {
    slug: 'dna',
    terms: ['dna', 'gene', 'genetic', 'biology', 'genome', 'molecular'],
    prompt: 'a DNA double helix',
  },
  {
    slug: 'microscope',
    terms: ['microscope', 'research', 'experiment', 'science', 'analysis', 'study', 'lab'],
    prompt: 'a microscope',
  },
  {
    slug: 'flask-conical',
    terms: ['flask', 'chemistry', 'reaction', 'mixture', 'trial', 'test'],
    prompt: 'a conical lab flask',
  },
  {
    slug: 'test-tube',
    terms: ['sample', 'specimen', 'tube', 'assay', 'dose'],
    prompt: 'a test tube',
  },
  {
    slug: 'pill',
    terms: ['drug', 'medicine', 'pill', 'treatment', 'dosage', 'pharmaceutical'],
    prompt: 'a capsule pill',
  },
  {
    slug: 'stethoscope',
    terms: ['doctor', 'clinical', 'diagnosis', 'health', 'medical', 'patient'],
    prompt: 'a stethoscope',
  },
  {
    slug: 'heart',
    terms: ['heart', 'love', 'care', 'like', 'favourite', 'favorite', 'wellbeing'],
    prompt: 'a heart',
  },
  {
    slug: 'leaf',
    terms: ['leaf', 'plant', 'green', 'sustainable', 'organic', 'nature', 'carbon'],
    prompt: 'a leaf',
  },
  {
    slug: 'trees',
    terms: ['forest', 'trees', 'woodland', 'ecosystem', 'jungle'],
    prompt: 'two trees',
  },
  {
    slug: 'sun',
    terms: ['sun', 'solar', 'daylight', 'bright', 'summer', 'star'],
    prompt: 'a sun with rays',
  },
  { slug: 'moon', terms: ['moon', 'night', 'lunar', 'dark', 'sleep'], prompt: 'a crescent moon' },
  {
    slug: 'cloud-rain',
    terms: ['rain', 'weather', 'storm', 'precipitation', 'forecast'],
    prompt: 'a rain cloud',
  },
  {
    slug: 'droplet',
    terms: ['water', 'drop', 'liquid', 'fluid', 'moisture', 'ink'],
    prompt: 'a water droplet',
  },
  {
    slug: 'flame',
    terms: ['fire', 'flame', 'burn', 'heat', 'combustion', 'hot'],
    prompt: 'a flame',
  },
  {
    slug: 'wind',
    terms: ['wind', 'air', 'breeze', 'airflow', 'ventilation'],
    prompt: 'flowing wind lines',
  },
  {
    slug: 'mountain',
    terms: ['mountain', 'peak', 'summit', 'climb', 'terrain', 'landscape', 'surface', 'hill'],
    prompt: 'a mountain peak',
  },
  {
    slug: 'waves',
    terms: ['wave', 'waves', 'oscillation', 'frequency', 'signal', 'sound', 'ocean'],
    prompt: 'three wavy lines',
  },
  {
    slug: 'thermometer',
    terms: ['temperature', 'thermometer', 'warm', 'cold', 'degrees', 'climate'],
    prompt: 'a thermometer',
  },
  {
    slug: 'battery',
    terms: ['battery', 'charge', 'capacity', 'energy storage', 'power'],
    prompt: 'a battery',
  },
  {
    slug: 'plug',
    terms: ['plug', 'connect', 'integration', 'adapter', 'interface', 'socket'],
    prompt: 'an electrical plug',
  },
  {
    slug: 'wifi',
    terms: ['wifi', 'wireless', 'signal strength', 'bandwidth', 'connectivity'],
    prompt: 'wifi signal arcs',
  },
  {
    slug: 'smartphone',
    terms: ['phone', 'mobile', 'smartphone', 'app', 'handset', 'device'],
    prompt: 'a smartphone',
  },
  {
    slug: 'laptop',
    terms: ['laptop', 'computer', 'desktop', 'workstation', 'notebook'],
    prompt: 'an open laptop',
  },
  {
    slug: 'monitor',
    terms: ['screen', 'display', 'monitor', 'dashboard', 'ui', 'interface'],
    prompt: 'a computer monitor',
  },
  {
    slug: 'hard-drive',
    terms: ['disk', 'drive', 'memory', 'cache', 'ssd', 'persistence'],
    prompt: 'a hard drive',
  },
  {
    slug: 'camera',
    terms: ['camera', 'photo', 'image', 'picture', 'snapshot', 'capture'],
    prompt: 'a camera',
  },
  {
    slug: 'video',
    terms: ['video', 'film', 'movie', 'footage', 'clip', 'recording'],
    prompt: 'a video camera',
  },
  {
    slug: 'mic',
    terms: ['microphone', 'voice', 'audio', 'speech', 'narration', 'podcast', 'record'],
    prompt: 'a microphone',
  },
  {
    slug: 'music',
    terms: ['music', 'song', 'melody', 'note', 'tune', 'rhythm'],
    prompt: 'a musical note',
  },
  {
    slug: 'palette',
    terms: ['colour', 'color', 'palette', 'design', 'art', 'style', 'aesthetic', 'paint'],
    prompt: 'an artist palette',
  },
  {
    slug: 'pencil',
    terms: ['write', 'writing', 'edit', 'draft', 'author', 'note', 'sketch', 'pencil'],
    prompt: 'a pencil',
  },
  {
    slug: 'puzzle',
    terms: ['puzzle', 'piece', 'fit', 'problem', 'component', 'part'],
    prompt: 'a jigsaw piece',
  },
  {
    slug: 'trophy',
    terms: ['win', 'winner', 'success', 'achievement', 'award', 'best', 'champion', 'prize'],
    prompt: 'a trophy',
  },
  {
    slug: 'flag',
    terms: ['flag', 'milestone', 'checkpoint', 'marker', 'goal post', 'country'],
    prompt: 'a flag on a pole',
  },
  {
    slug: 'link',
    terms: ['link', 'url', 'reference', 'citation', 'hyperlink', 'connection'],
    prompt: 'two chain links',
  },
  {
    slug: 'bookmark',
    terms: ['bookmark', 'save', 'keep', 'shortlist'],
    prompt: 'a bookmark ribbon',
  },
  {
    slug: 'tag',
    terms: ['tag', 'label', 'category', 'class', 'annotation', 'metadata'],
    prompt: 'a price tag',
  },
  {
    slug: 'list',
    terms: ['list', 'items', 'checklist', 'enumeration', 'steps', 'bullets', 'agenda'],
    prompt: 'a bulleted list',
  },
  {
    slug: 'table-2',
    terms: ['spreadsheet', 'matrix', 'rows', 'columns', 'grid'],
    prompt: 'a table grid',
  },
  {
    slug: 'car',
    terms: ['car', 'vehicle', 'driving', 'automobile', 'traffic'],
    prompt: 'a car seen from the side',
  },
  {
    slug: 'plane',
    terms: ['plane', 'flight', 'airline', 'aviation', 'travel', 'aircraft'],
    prompt: 'an aeroplane',
  },
  {
    slug: 'ship',
    terms: ['ship', 'boat', 'vessel', 'port', 'cargo', 'sailing'],
    prompt: 'a cargo ship',
  },
  {
    slug: 'anchor',
    terms: ['anchor', 'stability', 'grounded', 'baseline', 'fixed'],
    prompt: 'an anchor',
  },
  {
    slug: 'compass',
    terms: ['compass', 'direction', 'navigate', 'navigation', 'orientation', 'bearing'],
    prompt: 'a compass',
  },
  {
    slug: 'route',
    terms: ['route', 'path', 'journey', 'trajectory', 'course', 'road'],
    prompt: 'a winding route with waypoints',
  },
  {
    slug: 'door-open',
    terms: ['door', 'entry', 'access', 'gateway', 'entrance', 'exit'],
    prompt: 'an open door',
  },
  { slug: 'home', terms: ['home', 'house', 'household', 'domestic', 'local'], prompt: 'a house' },
  {
    slug: 'utensils',
    terms: ['food', 'meal', 'restaurant', 'cooking', 'recipe', 'kitchen', 'ingredient'],
    prompt: 'a fork and knife',
  },
  { slug: 'coffee', terms: ['coffee', 'cup', 'break', 'morning', 'cafe'], prompt: 'a coffee cup' },
  {
    slug: 'clipboard-list',
    terms: ['plan', 'checklist', 'requirements', 'survey', 'form', 'audit', 'inventory'],
    prompt: 'a clipboard with a list',
  },
  {
    slug: 'scissors',
    terms: ['cut', 'trim', 'split', 'prune', 'crop', 'remove'],
    prompt: 'a pair of scissors',
  },
  {
    slug: 'recycle',
    terms: ['recycle', 'reuse', 'circular', 'renew', 'sustainability'],
    prompt: 'a recycling triangle',
  },
  {
    slug: 'alarm-clock',
    terms: ['alarm', 'wake', 'urgent', 'timer', 'countdown'],
    prompt: 'an alarm clock',
  },
  {
    slug: 'hourglass',
    terms: ['wait', 'waiting', 'patience', 'elapsed', 'hourglass', 'slow'],
    prompt: 'an hourglass',
  },
  {
    slug: 'crown',
    terms: ['king', 'queen', 'royal', 'premium', 'leader', 'dominant', 'best in class'],
    prompt: 'a crown',
  },
  { slug: 'gift', terms: ['gift', 'present', 'bonus', 'reward', 'free'], prompt: 'a wrapped gift' },
];

type Match = { slug: string; term: string; prompt: string; score: number };

const INDEX = (() => {
  const map = new Map<string, { slug: string; prompt: string; term: string }[]>();
  for (const entry of ICONS) {
    for (const term of entry.terms) {
      const key = term.toLowerCase();
      const list = map.get(key) ?? [];
      list.push({ slug: entry.slug, prompt: entry.prompt, term: key });
      map.set(key, list);
    }
  }
  return map;
})();

/** Multi-word keys, longest first, so "neural network" beats "network". */
const PHRASES = [...INDEX.keys()]
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);

export function iconFor(term: string): IconEntry | undefined {
  const key = term.toLowerCase().trim();
  const direct = INDEX.get(key) ?? INDEX.get(singularKey(key));
  const hit = direct?.[0];
  if (!hit) return undefined;
  return { slug: hit.slug, prompt: hit.prompt, terms: [hit.term] };
}

function singularKey(w: string): string {
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/**
 * Find the icons that best represent a passage. Scores by phrase length (a
 * two-word match is much stronger evidence than a one-word match) and by how
 * early the term appears — the first concrete noun is usually the subject.
 */
export function matchIcons(text: string, limit = 2): Match[] {
  const lower = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')} `;
  const found = new Map<string, Match>();

  for (const phrase of PHRASES) {
    const idx = lower.indexOf(` ${phrase} `);
    if (idx < 0) continue;
    const hit = INDEX.get(phrase)?.[0];
    if (!hit) continue;
    const score = 40 + phrase.split(' ').length * 10 - (idx / lower.length) * 8;
    const prev = found.get(hit.slug);
    if (!prev || prev.score < score) {
      found.set(hit.slug, { slug: hit.slug, term: phrase, prompt: hit.prompt, score });
    }
  }

  const tokens = lower.trim().split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    const hit = (INDEX.get(raw) ?? INDEX.get(singularKey(raw)))?.[0];
    if (!hit) continue;
    const score = 10 + Math.max(0, 8 - (i / Math.max(1, tokens.length)) * 8) + raw.length * 0.2;
    const prev = found.get(hit.slug);
    if (!prev || prev.score < score) {
      found.set(hit.slug, { slug: hit.slug, term: raw, prompt: hit.prompt, score });
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}
