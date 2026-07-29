/**
 * The icon lane — the default, offline, free illustration path.
 *
 * `lucide-static` ships ~2000 stroke-only 24×24 SVGs on disk with a `tags.json`
 * for search. We read the raw file, convert every child element to path data,
 * scale it into the target box **first**, and only then roughen it — roughening
 * in 24-unit space and scaling up afterwards would multiply the wobble by 20 and
 * look like a mistake rather than a hand.
 *
 * Resolution order for a noun: explicit keyword table → per-token table → exact
 * slug → lucide tags → bigram similarity over slugs and tags. Broad enough that
 * a planner's nouns usually land on something sensible; when nothing does, the
 * caller gets `undefined` and falls back to a lettered card.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@inkcast/core';
import type { DrawContext, InkPath } from './geometry.js';
import { roughenPathData } from './geometry.js';
import type { Box } from './svg.js';
import {
  fitMatrix,
  parsePath,
  pathToString,
  samplePath,
  pointsBBox,
  transformSegs,
} from './svg.js';

const log = logger('visuals:icons');

/**
 * Keyword → candidate lucide slugs, best first.
 *
 * Candidates are lists because lucide renames icons between majors (the
 * `alert-*` family became `triangle-alert`/`circle-alert`, the chart family
 * became `chart-*`). We probe the real directory listing, so a rename degrades
 * to the next candidate instead of a missing icon.
 */
export const ICON_KEYWORDS: Record<string, string[]> = {
  /* data + storage */
  data: ['database'],
  dataset: ['database'],
  database: ['database'],
  db: ['database'],
  sql: ['database'],
  table: ['table', 'grid-3x3'],
  record: ['database'],
  storage: ['database', 'hard-drive'],
  disk: ['hard-drive'],
  drive: ['hard-drive'],
  save: ['save'],
  store: ['store', 'save'],
  cache: ['archive', 'zap'],
  archive: ['archive'],
  backup: ['archive', 'save'],
  memory: ['memory-stick', 'cpu'],
  ram: ['memory-stick', 'cpu'],
  binary: ['binary', 'file-digit'],
  bits: ['binary'],
  bytes: ['binary'],
  json: ['braces', 'file-json'],
  schema: ['braces', 'table'],
  array: ['brackets', 'list'],
  index: ['hash', 'list-ordered'],
  hash: ['hash'],
  queue: ['inbox', 'layers'],
  buffer: ['inbox', 'layers'],
  backlog: ['inbox', 'list'],

  /* people */
  user: ['user'],
  person: ['user'],
  customer: ['user', 'users'],
  client: ['user', 'monitor'],
  human: ['user'],
  actor: ['user'],
  developer: ['user', 'code'],
  users: ['users'],
  team: ['users'],
  people: ['users'],
  group: ['users'],
  audience: ['users'],
  community: ['users'],
  crowd: ['users'],
  identity: ['fingerprint', 'user'],
  account: ['user', 'circle-user'],
  profile: ['user', 'circle-user'],

  /* infrastructure */
  server: ['server'],
  backend: ['server'],
  host: ['server'],
  vm: ['server', 'box'],
  machine: ['server', 'cpu'],
  cluster: ['boxes', 'server'],
  cloud: ['cloud'],
  saas: ['cloud'],
  remote: ['cloud'],
  cpu: ['cpu'],
  processor: ['cpu'],
  chip: ['cpu'],
  gpu: ['cpu'],
  compute: ['cpu'],
  hardware: ['cpu', 'server'],
  container: ['package', 'box'],
  docker: ['container', 'package'],
  kubernetes: ['boxes', 'container'],
  microservices: ['boxes'],
  service: ['boxes', 'server'],
  services: ['boxes'],
  network: ['network', 'share-2'],
  mesh: ['network'],
  topology: ['network'],
  distributed: ['network'],
  router: ['router', 'network'],
  gateway: ['door-open', 'network'],
  wifi: ['wifi'],
  wireless: ['wifi'],
  signal: ['wifi', 'antenna'],
  antenna: ['antenna'],
  cable: ['cable'],
  satellite: ['satellite', 'satellite-dish'],
  internet: ['globe'],
  web: ['globe'],
  world: ['globe'],
  global: ['globe'],
  earth: ['globe'],
  country: ['globe', 'map'],
  language: ['globe', 'languages'],
  browser: ['globe', 'monitor'],

  /* intelligence */
  brain: ['brain'],
  mind: ['brain'],
  think: ['brain'],
  thought: ['brain', 'message-circle'],
  learn: ['brain', 'graduation-cap'],
  learning: ['brain', 'graduation-cap'],
  training: ['graduation-cap', 'dumbbell'],
  model: ['brain', 'box'],
  ai: ['brain', 'sparkles'],
  llm: ['sparkles', 'brain'],
  neural: ['brain', 'network'],
  neuron: ['brain', 'circle-dot'],
  intelligence: ['brain'],
  agent: ['bot'],
  bot: ['bot'],
  robot: ['bot'],
  assistant: ['bot'],
  automation: ['bot', 'workflow'],
  prompt: ['message-square', 'terminal'],
  inference: ['sparkles', 'brain'],
  embedding: ['grid-3x3', 'network'],
  vector: ['move-up-right', 'arrow-up-right'],

  /* maths */
  gradient: ['trending-down', 'function-square'],
  derivative: ['function-square', 'sigma'],
  calculus: ['function-square', 'sigma'],
  function: ['function-square', 'code'],
  formula: ['function-square', 'calculator'],
  equation: ['equal', 'function-square'],
  math: ['calculator', 'sigma'],
  calculator: ['calculator'],
  sum: ['sigma', 'plus'],
  aggregate: ['sigma', 'layers'],
  average: ['sigma', 'chart-line'],
  probability: ['percent', 'dices'],
  random: ['shuffle', 'dices'],
  loss: ['trending-down'],
  error: ['triangle-alert', 'circle-x'],
  weights: ['sliders-horizontal', 'weight'],
  parameters: ['sliders-horizontal'],
  parameter: ['sliders-horizontal'],
  hyperparameter: ['sliders-horizontal'],
  variable: ['variable', 'sliders-horizontal'],
  matrix: ['grid-3x3', 'table'],
  grid: ['grid-3x3', 'layout-grid'],

  /* money */
  money: ['dollar-sign', 'banknote'],
  cost: ['dollar-sign', 'receipt'],
  price: ['tag', 'dollar-sign'],
  pricing: ['tag', 'dollar-sign'],
  revenue: ['dollar-sign', 'chart-line'],
  budget: ['wallet', 'dollar-sign'],
  cash: ['banknote', 'dollar-sign'],
  dollar: ['dollar-sign'],
  coin: ['coins', 'circle-dollar-sign'],
  wallet: ['wallet'],
  payment: ['credit-card', 'wallet'],
  billing: ['receipt', 'credit-card'],
  invoice: ['receipt', 'file-text'],
  bank: ['landmark', 'building-2'],
  investment: ['trending-up', 'coins'],
  profit: ['trending-up', 'dollar-sign'],

  /* time */
  clock: ['clock'],
  time: ['clock'],
  latency: ['clock', 'hourglass'],
  duration: ['clock', 'timer'],
  delay: ['hourglass', 'clock'],
  timer: ['timer', 'clock'],
  countdown: ['timer', 'hourglass'],
  stopwatch: ['timer'],
  schedule: ['calendar-clock', 'calendar'],
  calendar: ['calendar'],
  date: ['calendar'],
  deadline: ['calendar-clock', 'calendar'],
  history: ['history', 'clock'],
  wait: ['hourglass', 'pause'],
  waiting: ['hourglass'],
  slow: ['hourglass', 'turtle'],
  fast: ['zap', 'rocket'],
  instant: ['zap'],
  realtime: ['zap', 'activity'],

  /* signals */
  warning: ['triangle-alert', 'alert-triangle'],
  risk: ['triangle-alert', 'shield-alert'],
  danger: ['triangle-alert', 'alert-triangle'],
  alert: ['triangle-alert', 'bell'],
  caution: ['triangle-alert'],
  problem: ['triangle-alert', 'circle-x'],
  issue: ['circle-alert', 'alert-circle'],
  bug: ['bug'],
  defect: ['bug'],
  crash: ['bug', 'triangle-alert'],
  failure: ['circle-x', 'x-circle'],
  vulnerability: ['shield-alert', 'shield-x'],
  threat: ['shield-alert'],
  attack: ['shield-alert', 'swords'],
  info: ['info'],
  question: ['circle-help', 'help-circle'],
  help: ['circle-help', 'help-circle'],
  notification: ['bell'],
  bell: ['bell'],
  reminder: ['bell', 'calendar-clock'],
  announce: ['megaphone'],
  marketing: ['megaphone'],

  /* trends */
  growth: ['trending-up', 'chart-line'],
  increase: ['trending-up', 'arrow-up'],
  improve: ['trending-up'],
  trend: ['trending-up', 'chart-line'],
  rising: ['trending-up'],
  scale: ['scaling', 'trending-up'],
  scaling: ['scaling', 'maximize'],
  decline: ['trending-down'],
  decrease: ['trending-down', 'arrow-down'],
  drop: ['trending-down', 'arrow-down'],
  chart: ['chart-column', 'bar-chart-3', 'bar-chart'],
  bar: ['chart-column', 'bar-chart-3'],
  analytics: ['chart-column', 'chart-line'],
  metrics: ['chart-line', 'gauge'],
  stats: ['chart-column', 'chart-line'],
  statistics: ['chart-column', 'chart-line'],
  graph: ['chart-line', 'network'],
  timeseries: ['chart-line'],
  pie: ['chart-pie', 'pie-chart'],
  proportion: ['chart-pie', 'percent'],
  distribution: ['chart-pie', 'chart-column'],
  percentage: ['percent'],
  percent: ['percent'],
  dashboard: ['layout-dashboard', 'gauge'],
  gauge: ['gauge'],
  speed: ['gauge', 'zap'],
  performance: ['gauge', 'activity'],
  benchmark: ['gauge', 'timer'],
  throughput: ['gauge', 'activity'],
  monitoring: ['activity', 'radar'],
  observability: ['radar', 'activity'],
  activity: ['activity'],
  health: ['activity', 'heart-pulse'],
  pulse: ['activity', 'heart-pulse'],

  /* files */
  file: ['file-text', 'file'],
  document: ['file-text'],
  doc: ['file-text'],
  page: ['file-text', 'file'],
  paper: ['file-text', 'scroll-text'],
  report: ['file-text', 'clipboard-list'],
  pdf: ['file-text', 'file'],
  spreadsheet: ['sheet', 'table'],
  folder: ['folder'],
  directory: ['folder'],
  files: ['files', 'folder'],
  attachment: ['paperclip'],
  copy: ['copy'],
  duplicate: ['copy'],
  clipboard: ['clipboard', 'clipboard-list'],
  note: ['sticky-note', 'notebook-pen'],
  notes: ['notebook-pen', 'sticky-note'],
  book: ['book-open', 'book'],
  docs: ['book-open', 'file-text'],
  documentation: ['book-open', 'file-text'],
  read: ['book-open', 'eye'],
  manual: ['book-open'],
  knowledge: ['book-open', 'brain'],

  /* security */
  lock: ['lock'],
  security: ['shield', 'lock'],
  secure: ['shield-check', 'lock'],
  private: ['lock', 'eye-off'],
  privacy: ['eye-off', 'lock'],
  encrypt: ['lock', 'key'],
  encryption: ['lock', 'key-round'],
  auth: ['key-round', 'lock'],
  authentication: ['key-round', 'fingerprint'],
  password: ['key-round', 'lock'],
  protect: ['shield', 'shield-check'],
  unlock: ['lock-open', 'unlock'],
  key: ['key', 'key-round'],
  token: ['key-round', 'key'],
  credential: ['key-round', 'badge-check'],
  secret: ['key-round', 'eye-off'],
  shield: ['shield'],
  compliance: ['shield-check', 'clipboard-check'],
  trust: ['shield-check', 'handshake'],
  firewall: ['brick-wall', 'shield'],
  fingerprint: ['fingerprint'],
  login: ['log-in'],
  logout: ['log-out'],
  permission: ['shield-check', 'user-check'],

  /* actions */
  search: ['search'],
  find: ['search'],
  query: ['search', 'terminal'],
  lookup: ['search'],
  discover: ['search', 'compass'],
  explore: ['compass', 'search'],
  inspect: ['search', 'microscope'],
  filter: ['filter', 'funnel'],
  sort: ['arrow-up-down', 'list-ordered'],
  rank: ['list-ordered', 'trophy'],
  settings: ['settings'],
  gear: ['settings', 'cog'],
  config: ['settings', 'sliders-horizontal'],
  configure: ['settings'],
  setup: ['settings', 'wrench'],
  options: ['settings', 'list'],
  tune: ['sliders-horizontal', 'settings'],
  sliders: ['sliders-horizontal', 'sliders'],
  toggle: ['toggle-left', 'toggle-right'],
  switch: ['toggle-left', 'shuffle'],
  wrench: ['wrench'],
  fix: ['wrench', 'hammer'],
  repair: ['wrench'],
  tool: ['wrench', 'hammer'],
  tools: ['wrench', 'hammer'],
  build: ['hammer', 'package'],
  hammer: ['hammer'],
  edit: ['pencil', 'pen-line'],
  write: ['pencil', 'pen-line'],
  pencil: ['pencil'],
  pen: ['pen-tool', 'pen'],
  draft: ['pencil', 'file-pen'],
  annotate: ['highlighter', 'pencil'],
  highlight: ['highlighter', 'star'],
  erase: ['eraser'],
  delete: ['trash-2', 'trash'],
  trash: ['trash-2', 'trash'],
  discard: ['trash-2'],
  cut: ['scissors'],
  trim: ['scissors', 'crop'],
  crop: ['crop'],
  move: ['move'],
  drag: ['move', 'grip-vertical'],
  refresh: ['refresh-cw', 'rotate-cw'],
  reload: ['refresh-cw'],
  retry: ['refresh-cw', 'rotate-cw'],
  loop: ['refresh-cw', 'repeat'],
  repeat: ['repeat', 'refresh-cw'],
  iterate: ['refresh-cw', 'repeat'],
  iteration: ['repeat', 'refresh-cw'],
  cycle: ['refresh-cw', 'recycle'],
  epoch: ['repeat', 'refresh-cw'],
  undo: ['undo-2', 'undo'],
  rollback: ['undo-2', 'history'],
  revert: ['undo-2'],
  redo: ['redo-2', 'redo'],
  shuffle: ['shuffle'],
  sync: ['refresh-cw', 'arrow-left-right'],
  swap: ['arrow-left-right', 'repeat'],
  exchange: ['arrow-left-right'],
  upload: ['upload', 'cloud-upload'],
  publish: ['upload', 'radio'],
  push: ['upload', 'arrow-up'],
  download: ['download', 'cloud-download'],
  pull: ['download', 'arrow-down'],
  fetch: ['download', 'globe'],
  import: ['download', 'log-in'],
  export: ['upload', 'log-out'],
  send: ['send', 'mail'],
  receive: ['inbox', 'antenna'],
  play: ['play', 'circle-play'],
  run: ['play', 'terminal'],
  execute: ['play', 'terminal'],
  pause: ['pause', 'circle-pause'],
  stop: ['square', 'circle-stop'],
  halt: ['octagon-x', 'octagon'],
  power: ['power'],
  print: ['printer'],
  scan: ['scan', 'scan-line'],
  qr: ['qr-code', 'scan'],
  track: ['radar', 'map-pin'],
  measure: ['ruler', 'gauge'],

  /* code */
  code: ['code', 'code-xml'],
  program: ['code', 'terminal'],
  script: ['code', 'file-code'],
  software: ['code', 'package'],
  syntax: ['code-xml', 'braces'],
  algorithm: ['workflow', 'code'],
  terminal: ['terminal', 'square-terminal'],
  cli: ['terminal', 'square-terminal'],
  command: ['terminal'],
  shell: ['terminal'],
  console: ['terminal'],
  api: ['plug', 'plug-zap'],
  integration: ['plug', 'puzzle'],
  webhook: ['webhook', 'plug'],
  plugin: ['plug', 'puzzle'],
  library: ['package', 'library'],
  package: ['package'],
  module: ['package', 'box'],
  bundle: ['package', 'boxes'],
  artifact: ['package', 'box'],
  dependency: ['package', 'link'],
  version: ['git-branch', 'tag'],
  git: ['git-branch'],
  branch: ['git-branch'],
  fork: ['git-fork', 'git-branch'],
  merge: ['git-merge', 'merge'],
  commit: ['git-commit-horizontal', 'git-commit'],
  pr: ['git-pull-request'],
  review: ['git-pull-request', 'eye'],
  deploy: ['rocket', 'upload'],
  release: ['rocket', 'tag'],
  ship: ['rocket', 'truck'],
  test: ['flask-conical', 'test-tube'],
  testing: ['flask-conical', 'check-check'],
  debug: ['bug', 'search'],
  log: ['scroll-text', 'file-text'],
  logs: ['scroll-text', 'file-text'],
  trace: ['footprints', 'activity'],
  pipeline: ['workflow', 'git-branch'],
  workflow: ['workflow'],
  process: ['workflow', 'refresh-cw'],
  flow: ['workflow', 'arrow-right'],
  stage: ['layers', 'workflow'],
  step: ['footprints', 'list-ordered'],
  steps: ['list-ordered', 'footprints'],

  /* structure */
  layers: ['layers'],
  stack: ['layers'],
  tier: ['layers'],
  abstraction: ['layers', 'boxes'],
  architecture: ['layers', 'network'],
  component: ['puzzle', 'box'],
  components: ['boxes', 'puzzle'],
  puzzle: ['puzzle'],
  tree: ['folder-tree', 'git-fork'],
  hierarchy: ['folder-tree', 'network'],
  taxonomy: ['folder-tree', 'list-tree'],
  structure: ['layers', 'folder-tree'],
  nested: ['folder-tree', 'layers'],
  split: ['split', 'divide'],
  divide: ['divide', 'split'],
  partition: ['split', 'columns-3'],
  shard: ['split', 'boxes'],
  chunk: ['boxes', 'split'],
  batch: ['boxes', 'layers'],
  join: ['git-merge', 'combine'],
  combine: ['combine', 'git-merge'],
  converge: ['git-merge', 'target'],
  box: ['box'],
  boxes: ['boxes'],
  block: ['square', 'box'],
  node: ['circle', 'circle-dot'],
  nodes: ['network', 'circle-dot'],
  point: ['circle-dot', 'circle'],
  dot: ['circle-dot'],
  state: ['circle', 'toggle-left'],
  entity: ['box', 'circle'],
  cell: ['square', 'grid-3x3'],
  unit: ['square', 'box'],
  circle: ['circle'],
  square: ['square'],
  triangle: ['triangle'],
  diamond: ['diamond', 'gem'],
  hexagon: ['hexagon'],
  list: ['list', 'list-checks'],
  checklist: ['list-checks', 'clipboard-check'],
  todo: ['list-checks', 'square-check'],
  tasks: ['list-checks', 'clipboard-list'],
  agenda: ['list', 'calendar'],

  /* verdicts */
  check: ['circle-check', 'check-circle', 'check'],
  done: ['circle-check', 'check'],
  complete: ['circle-check', 'check-check'],
  correct: ['circle-check', 'check'],
  valid: ['circle-check', 'badge-check'],
  approve: ['circle-check', 'thumbs-up'],
  yes: ['check', 'circle-check'],
  success: ['circle-check', 'trophy'],
  cross: ['circle-x', 'x'],
  wrong: ['circle-x', 'x'],
  invalid: ['circle-x', 'x-circle'],
  reject: ['circle-x', 'thumbs-down'],
  no: ['x', 'circle-x'],
  cancel: ['circle-x', 'x'],
  remove: ['circle-minus', 'trash-2'],
  add: ['circle-plus', 'plus'],
  plus: ['plus', 'circle-plus'],
  create: ['circle-plus', 'sparkles'],
  new: ['sparkles', 'circle-plus'],
  minus: ['minus', 'circle-minus'],
  equal: ['equal'],
  balance: ['scale', 'equal'],
  tradeoff: ['scale'],
  compare: ['scale', 'columns-3'],
  decision: ['git-branch', 'scale'],
  choice: ['git-branch', 'list'],

  /* nature + misc metaphors */
  idea: ['lightbulb'],
  lightbulb: ['lightbulb'],
  insight: ['lightbulb', 'sparkles'],
  hypothesis: ['lightbulb', 'flask-conical'],
  innovation: ['lightbulb', 'rocket'],
  creative: ['palette', 'lightbulb'],
  inspiration: ['sparkles', 'lightbulb'],
  magic: ['wand-sparkles', 'wand-2'],
  generate: ['wand-sparkles', 'sparkles'],
  transform: ['wand-sparkles', 'shuffle'],
  enhance: ['sparkles'],
  smart: ['sparkles', 'brain'],
  sparkles: ['sparkles'],
  rocket: ['rocket'],
  launch: ['rocket'],
  startup: ['rocket'],
  target: ['target'],
  goal: ['target', 'flag'],
  objective: ['target'],
  aim: ['target', 'crosshair'],
  accuracy: ['target', 'crosshair'],
  precision: ['crosshair', 'target'],
  focus: ['crosshair', 'target'],
  trophy: ['trophy'],
  win: ['trophy', 'medal'],
  achievement: ['trophy', 'award'],
  reward: ['gift', 'trophy'],
  award: ['award', 'medal'],
  crown: ['crown'],
  premium: ['crown', 'sparkles'],
  star: ['star'],
  rating: ['star'],
  quality: ['badge-check', 'star'],
  heart: ['heart'],
  love: ['heart'],
  like: ['thumbs-up', 'heart'],
  eye: ['eye'],
  see: ['eye'],
  view: ['eye'],
  watch: ['eye'],
  observe: ['eye', 'binoculars'],
  visible: ['eye'],
  vision: ['eye', 'telescope'],
  hide: ['eye-off'],
  hidden: ['eye-off'],
  flag: ['flag'],
  milestone: ['flag', 'map-pin'],
  checkpoint: ['flag', 'circle-check'],
  map: ['map'],
  route: ['route', 'map'],
  journey: ['route', 'footprints'],
  path: ['route', 'footprints'],
  navigate: ['compass', 'route'],
  roadmap: ['route', 'map'],
  compass: ['compass'],
  direction: ['compass', 'arrow-right'],
  location: ['map-pin'],
  place: ['map-pin'],
  pin: ['map-pin', 'pin'],
  geo: ['map-pin', 'globe'],
  anchor: ['anchor'],
  bridge: ['git-merge', 'link'],
  wall: ['brick-wall'],
  barrier: ['brick-wall', 'construction'],
  blocker: ['brick-wall', 'octagon-x'],
  obstacle: ['brick-wall', 'construction'],
  limit: ['brick-wall', 'gauge'],
  constraint: ['brick-wall', 'lock'],
  fire: ['flame'],
  hot: ['flame'],
  urgent: ['flame', 'triangle-alert'],
  cold: ['snowflake'],
  freeze: ['snowflake'],
  sun: ['sun'],
  light: ['sun', 'lightbulb'],
  moon: ['moon'],
  dark: ['moon'],
  sleep: ['moon', 'pause'],
  water: ['droplet'],
  liquid: ['droplet'],
  leaf: ['leaf'],
  green: ['leaf'],
  sustainable: ['leaf', 'recycle'],
  eco: ['leaf'],
  nature: ['leaf', 'trees'],
  seed: ['sprout'],
  plant: ['sprout', 'leaf'],
  grow: ['sprout', 'trending-up'],
  origin: ['sprout', 'circle-dot'],
  infinity: ['infinity'],
  endless: ['infinity'],
  unlimited: ['infinity'],
  dna: ['dna'],
  biology: ['dna', 'microscope'],
  gene: ['dna'],
  molecule: ['atom', 'dna'],
  atom: ['atom'],
  physics: ['atom'],
  science: ['atom', 'flask-conical'],
  particle: ['atom', 'circle-dot'],
  quantum: ['atom', 'waves'],
  experiment: ['flask-conical', 'test-tube'],
  lab: ['flask-conical', 'microscope'],
  research: ['microscope', 'flask-conical'],
  microscope: ['microscope'],
  analyse: ['microscope', 'chart-line'],
  analyze: ['microscope', 'chart-line'],
  telescope: ['telescope'],
  future: ['telescope', 'trending-up'],
  forecast: ['telescope', 'cloud-sun'],
  predict: ['telescope', 'sparkles'],
  wave: ['waves', 'activity'],
  waves: ['waves'],
  energy: ['zap', 'battery-charging'],
  zap: ['zap'],
  electric: ['zap'],
  battery: ['battery'],
  broadcast: ['radio-tower', 'radio'],
  radio: ['radio', 'radio-tower'],
  stream: ['radio', 'waves'],
  event: ['zap', 'radio'],
  emit: ['radio', 'send'],
  radar: ['radar'],
  loader: ['loader', 'loader-circle'],
  loading: ['loader-circle', 'loader'],
  progress: ['loader-circle', 'trending-up'],
  spinner: ['loader-circle', 'loader'],

  /* communication */
  mail: ['mail'],
  email: ['mail'],
  message: ['message-square', 'mail'],
  inbox: ['inbox'],
  letter: ['mail'],
  chat: ['message-circle', 'message-square'],
  conversation: ['messages-square', 'message-circle'],
  discuss: ['messages-square'],
  comment: ['message-square'],
  talk: ['message-circle', 'mic'],
  reply: ['reply', 'message-square'],
  phone: ['phone', 'smartphone'],
  call: ['phone'],
  mobile: ['smartphone'],
  smartphone: ['smartphone'],
  device: ['smartphone', 'monitor'],
  laptop: ['laptop', 'monitor'],
  computer: ['monitor', 'laptop'],
  desktop: ['monitor'],
  monitor: ['monitor'],
  screen: ['monitor'],
  display: ['monitor'],
  microphone: ['mic'],
  voice: ['mic', 'audio-lines'],
  audio: ['audio-lines', 'volume-2'],
  speak: ['mic', 'megaphone'],
  narration: ['mic', 'audio-lines'],
  sound: ['volume-2', 'audio-lines'],
  listen: ['headphones', 'ear'],
  hear: ['ear', 'headphones'],
  volume: ['volume-2'],
  megaphone: ['megaphone'],
  video: ['video', 'film'],
  film: ['film', 'video'],
  movie: ['film'],
  animation: ['film', 'play'],
  image: ['image'],
  picture: ['image'],
  photo: ['image', 'camera'],
  camera: ['camera'],
  visual: ['image', 'eye'],
  render: ['image', 'monitor'],
  frame: ['frame', 'image'],
  link: ['link', 'link-2'],
  url: ['link', 'globe'],
  reference: ['link', 'book-open'],
  connect: ['link', 'plug'],
  share: ['share-2', 'share'],
  thumbsup: ['thumbs-up'],
  thumbsdown: ['thumbs-down'],
  happy: ['smile'],
  sad: ['frown'],
  frustration: ['frown', 'triangle-alert'],
  pain: ['frown', 'triangle-alert'],

  /* directions */
  right: ['arrow-right', 'move-right'],
  next: ['arrow-right', 'chevron-right'],
  forward: ['arrow-right', 'redo-2'],
  then: ['arrow-right', 'corner-down-right'],
  left: ['arrow-left', 'move-left'],
  back: ['arrow-left', 'undo-2'],
  previous: ['arrow-left', 'chevron-left'],
  up: ['arrow-up', 'move-up'],
  down: ['arrow-down', 'move-down'],
  upright: ['arrow-up-right', 'move-up-right'],
  northeast: ['arrow-up-right'],
  downright: ['arrow-down-right', 'move-down-right'],
  southeast: ['arrow-down-right'],
  upleft: ['arrow-up-left'],
  downleft: ['arrow-down-left'],
  bidirectional: ['arrow-left-right'],
  vertical: ['arrow-up-down'],
  expand: ['maximize', 'maximize-2'],
  fullscreen: ['maximize'],
  collapse: ['minimize', 'minimize-2'],
  shrink: ['minimize', 'minimize-2'],
  zoomin: ['zoom-in'],
  zoomout: ['zoom-out'],
  crosshair: ['crosshair'],
  chevron: ['chevron-right'],
  more: ['ellipsis', 'more-horizontal'],

  /* places + things */
  building: ['building-2', 'building'],
  company: ['building-2'],
  office: ['building-2', 'building'],
  enterprise: ['building-2', 'landmark'],
  organisation: ['building-2', 'users'],
  organization: ['building-2', 'users'],
  factory: ['factory'],
  industry: ['factory'],
  manufacturing: ['factory'],
  production: ['factory', 'rocket'],
  shop: ['store', 'shopping-bag'],
  retail: ['store'],
  market: ['store', 'chart-line'],
  commerce: ['shopping-cart', 'store'],
  cart: ['shopping-cart'],
  purchase: ['shopping-cart', 'credit-card'],
  checkout: ['shopping-cart', 'credit-card'],
  order: ['clipboard-list', 'shopping-cart'],
  gift: ['gift'],
  ticket: ['ticket'],
  badge: ['badge-check', 'award'],
  certificate: ['award', 'badge-check'],
  handshake: ['handshake', 'heart-handshake'],
  deal: ['handshake'],
  partnership: ['handshake'],
  agreement: ['handshake', 'file-check'],
  contract: ['file-text', 'handshake'],
  law: ['gavel', 'scale'],
  legal: ['gavel', 'scale'],
  regulation: ['gavel', 'shield-check'],
  policy: ['file-text', 'gavel'],
  medical: ['stethoscope', 'heart-pulse'],
  doctor: ['stethoscope'],
  patient: ['user', 'stethoscope'],
  diagnosis: ['stethoscope', 'search'],
  medicine: ['pill'],
  pill: ['pill'],
  vaccine: ['syringe'],
  food: ['utensils'],
  restaurant: ['utensils'],
  recipe: ['utensils', 'clipboard-list'],
  coffee: ['coffee'],
  home: ['house', 'home'],
  house: ['house', 'home'],
  local: ['house', 'monitor'],
  door: ['door-open'],
  entry: ['door-open', 'log-in'],
  exit: ['door-open', 'log-out'],
  portal: ['door-open', 'globe'],
  car: ['car'],
  vehicle: ['car', 'truck'],
  transport: ['truck', 'car'],
  truck: ['truck'],
  delivery: ['truck', 'package'],
  logistics: ['truck', 'boxes'],
  shipping: ['truck', 'ship'],
  supply: ['truck', 'boxes'],
  plane: ['plane'],
  flight: ['plane'],
  travel: ['plane', 'luggage'],
  boat: ['ship'],
  train: ['train-front', 'train-track'],
  weight: ['weight', 'dumbbell'],
  dumbbell: ['dumbbell'],
  exercise: ['dumbbell'],
  practice: ['dumbbell', 'repeat'],
  effort: ['dumbbell', 'trending-up'],
  brush: ['paintbrush', 'brush'],
  paint: ['paintbrush'],
  design: ['palette', 'pen-tool'],
  art: ['palette', 'paintbrush'],
  palette: ['palette'],
  colour: ['palette'],
  color: ['palette'],
  theme: ['palette', 'sun-moon'],
  ruler: ['ruler'],
  size: ['ruler', 'maximize'],
  dimension: ['ruler', 'box'],
  school: ['school', 'graduation-cap'],
  education: ['graduation-cap', 'school'],
  student: ['graduation-cap', 'user'],
  course: ['graduation-cap', 'book-open'],
  teach: ['graduation-cap', 'presentation'],
  presentation: ['presentation', 'monitor'],
  slide: ['presentation', 'monitor'],
  whiteboard: ['presentation', 'pencil'],

  /* ------------------------------------------------------------------------
   * Everything below was added for *explainer* vocabulary rather than product
   * vocabulary. The MVP mismatched four of nine assets in a maths film because
   * the table only knew software nouns: "loss" fell through every tier and
   * landed on a briefcase. A curve, a hill, a tangent, a minimum, a market and
   * a cell are the words teaching actually uses, so they are named explicitly
   * instead of being left to fuzzy matching, which is confidently wrong far
   * more often than it is right.
   * ---------------------------------------------------------------------- */

  /* maths, as an explainer means it */
  slope: ['trending-up', 'chart-spline'],
  steep: ['trending-up', 'mountain'],
  steepness: ['trending-up', 'mountain'],
  tangent: ['chart-spline', 'trending-up'],
  curve: ['chart-spline', 'spline'],
  curves: ['chart-spline', 'spline'],
  spline: ['spline', 'chart-spline'],
  bowl: ['chart-spline', 'chart-area'],
  valley: ['mountain', 'chart-spline'],
  hill: ['mountain'],
  hills: ['mountain'],
  hillside: ['mountain'],
  mountain: ['mountain', 'mountain-snow'],
  peak: ['mountain-snow', 'trending-up'],
  summit: ['mountain-snow', 'flag'],
  downhill: ['trending-down'],
  uphill: ['trending-up'],
  descent: ['trending-down', 'arrow-down'],
  minimum: ['trending-down', 'arrow-down-to-line'],
  minima: ['trending-down', 'arrow-down-to-line'],
  maximum: ['trending-up', 'arrow-up-from-line'],
  optimum: ['target', 'crosshair'],
  optimal: ['target'],
  optimise: ['target', 'sliders-horizontal'],
  optimize: ['target', 'sliders-horizontal'],
  optimiser: ['sliders-horizontal', 'settings'],
  optimizer: ['sliders-horizontal', 'settings'],
  convergence: ['git-merge', 'target'],
  diverge: ['git-fork', 'trending-up'],
  divergence: ['git-fork', 'trending-up'],
  plateau: ['minus', 'chart-area'],
  saddle: ['move-diagonal', 'chart-spline'],
  integral: ['sigma', 'chart-area'],
  area: ['chart-area', 'square'],
  axis: ['chart-line', 'move-vertical'],
  axes: ['chart-line', 'move-vertical'],
  plot: ['chart-line', 'chart-scatter'],
  scatter: ['chart-scatter'],
  histogram: ['chart-column'],
  regression: ['chart-scatter', 'chart-line'],
  correlation: ['chart-scatter', 'trending-up'],
  variance: ['chart-column', 'activity'],
  deviation: ['activity', 'chart-column'],
  mean: ['sigma', 'divide'],
  median: ['divide', 'sigma'],
  sample: ['dices', 'flask-conical'],
  population: ['users'],
  outlier: ['circle-dot', 'triangle-alert'],
  noise: ['audio-waveform', 'activity'],
  overfitting: ['chart-spline', 'triangle-alert'],
  underfitting: ['minus', 'chart-line'],
  generalise: ['expand', 'globe'],
  generalize: ['expand', 'globe'],
  ratio: ['ratio', 'divide'],
  fraction: ['divide', 'ratio'],
  exponent: ['superscript', 'chart-spline'],
  root: ['radical', 'square-radical'],
  squareroot: ['radical', 'square-radical'],
  prime: ['hash', 'asterisk'],
  geometry: ['shapes', 'triangle'],
  angle: ['triangle-right', 'move-diagonal'],
  shape: ['shapes'],
  shapes: ['shapes'],
  radius: ['circle-dot', 'ruler'],
  rotation: ['rotate-cw', 'rotate-3d'],
  reflection: ['flip-horizontal', 'flip-vertical'],
  symmetry: ['flip-horizontal', 'shapes'],
  coordinate: ['crosshair', 'locate-fixed'],
  cube: ['cuboid', 'box'],
  sphere: ['circle', 'globe'],
  cone: ['cone'],
  cylinder: ['cylinder'],
  pyramid: ['pyramid'],
  torus: ['torus'],
  learningrate: ['sliders-horizontal', 'gauge'],

  /* physics */
  force: ['arrow-right', 'zap'],
  mass: ['weight', 'dumbbell'],
  gravity: ['arrow-down', 'weight'],
  acceleration: ['fast-forward', 'gauge'],
  velocity: ['gauge', 'arrow-right'],
  momentum: ['gauge', 'arrow-right'],
  friction: ['brick-wall', 'flame'],
  work: ['dumbbell', 'hammer'],
  heat: ['flame', 'thermometer-sun'],
  temperature: ['thermometer'],
  thermometer: ['thermometer'],
  pressure: ['gauge', 'arrow-down-to-line'],
  density: ['boxes', 'weight'],
  frequency: ['audio-waveform', 'waves'],
  wavelength: ['waves', 'audio-waveform'],
  amplitude: ['audio-lines', 'waves'],
  oscillation: ['audio-waveform', 'waves'],
  vibration: ['audio-waveform', 'waves'],
  resonance: ['audio-lines', 'waves'],
  lens: ['glasses', 'aperture'],
  electricity: ['zap', 'plug'],
  current: ['zap', 'cable'],
  voltage: ['zap', 'battery-charging'],
  resistance: ['brick-wall', 'zap'],
  circuit: ['circuit-board', 'cpu'],
  magnet: ['magnet'],
  magnetic: ['magnet'],
  field: ['grid-3x3', 'magnet'],
  charge: ['zap', 'battery-charging'],
  electron: ['atom', 'circle-dot'],
  nucleus: ['atom', 'circle-dot'],
  radiation: ['radiation'],
  orbit: ['orbit'],
  planet: ['globe', 'orbit'],
  galaxy: ['orbit', 'sparkles'],
  universe: ['orbit', 'globe'],
  lever: ['scale', 'ruler'],
  pulley: ['circle-dot', 'cable'],
  ramp: ['trending-up', 'move-diagonal'],
  incline: ['trending-up', 'move-diagonal'],
  ball: ['circle', 'volleyball'],
  rolling: ['circle', 'rotate-cw'],

  /* chemistry and biology */
  bond: ['link', 'atom'],
  reaction: ['flask-conical', 'zap'],
  catalyst: ['zap', 'flask-conical'],
  acid: ['flask-round', 'droplet'],
  solution: ['flask-round', 'droplet'],
  mixture: ['blend', 'flask-round'],
  oxygen: ['wind', 'droplet'],
  carbon: ['atom', 'hexagon'],
  photosynthesis: ['leaf', 'sun'],
  respiration: ['wind', 'heart-pulse'],
  evolution: ['dna', 'trending-up'],
  species: ['bird', 'dna'],
  ecosystem: ['trees', 'leaf'],
  bacteria: ['bug', 'microscope'],
  virus: ['bug', 'biohazard'],
  immune: ['shield', 'heart-pulse'],
  protein: ['dna', 'hexagon'],
  enzyme: ['dna', 'flask-conical'],
  blood: ['droplet', 'heart-pulse'],
  lung: ['wind', 'heart-pulse'],
  nerve: ['brain-circuit', 'zap'],
  synapse: ['brain-circuit', 'zap'],
  muscle: ['dumbbell', 'bone'],
  bone: ['bone'],
  skeleton: ['bone'],
  digestion: ['utensils', 'soup'],
  hormone: ['droplet', 'flask-conical'],
  animal: ['dog', 'bird'],
  insect: ['bug'],
  forest: ['trees'],
  woods: ['trees'],
  pine: ['tree-pine'],
  palm: ['tree-palm'],
  flower: ['flower', 'flower-2'],

  /* economics and finance */
  demand: ['trending-up', 'shopping-cart'],
  equilibrium: ['scale', 'equal'],
  inflation: ['trending-up', 'banknote'],
  deflation: ['trending-down', 'banknote'],
  interest: ['percent', 'piggy-bank'],
  compound: ['trending-up', 'percent'],
  loan: ['handshake', 'banknote'],
  debt: ['credit-card', 'trending-down'],
  savings: ['piggy-bank', 'wallet'],
  tax: ['receipt', 'landmark'],
  trade: ['arrow-left-right', 'handshake'],
  gdp: ['chart-column', 'landmark'],
  unemployment: ['user-x', 'trending-down'],
  recession: ['trending-down', 'chart-column'],
  monopoly: ['crown', 'building-2'],
  competition: ['swords', 'trophy'],
  incentive: ['gift', 'target'],
  scarcity: ['hourglass', 'package'],
  surplus: ['boxes', 'trending-up'],
  subsidy: ['hand-coins', 'banknote'],
  elasticity: ['move-horizontal', 'chart-line'],
  currency: ['banknote', 'coins'],
  stocks: ['chart-candlestick', 'trending-up'],
  bonds: ['file-badge', 'receipt'],
  portfolio: ['briefcase', 'chart-pie'],
  briefcase: ['briefcase'],
  insurance: ['shield-check', 'umbrella'],
  mortgage: ['house', 'banknote'],
  rent: ['house', 'banknote'],
  salary: ['banknote', 'wallet'],
  wage: ['banknote', 'wallet'],
  income: ['banknote', 'trending-up'],
  expense: ['receipt', 'trending-down'],

  /* how a lesson is built */
  answer: ['circle-check', 'message-square'],
  example: ['lightbulb', 'list'],
  practise: ['dumbbell', 'repeat'],
  summary: ['list', 'file-text'],
  recap: ['history', 'list'],
  definition: ['book-open', 'type'],
  proof: ['circle-check', 'scroll'],
  theorem: ['scroll', 'sigma'],
  rule: ['ruler', 'scroll'],
  principle: ['scroll', 'lightbulb'],
  mistake: ['circle-x', 'eraser'],
  misconception: ['circle-x', 'triangle-alert'],
  tip: ['lightbulb', 'info'],
  important: ['star', 'triangle-alert'],
  remember: ['brain', 'bookmark'],
  quiz: ['circle-help', 'list-checks'],
  exam: ['file-text', 'graduation-cap'],
  homework: ['notebook-pen', 'backpack'],
  lesson: ['book-open', 'presentation'],
  chapter: ['book', 'bookmark'],
  topic: ['bookmark', 'hash'],
  intuition: ['lightbulb', 'brain'],
  analogy: ['arrow-left-right', 'lightbulb'],
  metaphor: ['arrow-left-right', 'lightbulb'],
  hook: ['circle-help', 'sparkles'],
  therefore: ['arrow-right', 'corner-down-right'],
  why: ['circle-help'],
  how: ['circle-help', 'workflow'],
  contrast: ['contrast', 'columns-3'],
  concrete: ['brick-wall', 'box'],
  abstract: ['layers', 'sparkles'],

  /* everyday anchors — the concrete half of every explanation */
  fog: ['cloudy', 'cloud'],
  mist: ['cloudy', 'droplets'],
  rain: ['cloud-rain', 'droplets'],
  snow: ['cloud-snow', 'snowflake'],
  storm: ['cloud-lightning', 'tornado'],
  thunder: ['cloud-lightning', 'zap'],
  lightning: ['zap', 'cloud-lightning'],
  wind: ['wind'],
  rainbow: ['rainbow'],
  weather: ['cloud-sun', 'cloudy'],
  walking: ['footprints', 'person-standing'],
  walk: ['footprints', 'person-standing'],
  stride: ['footprints', 'person-standing'],
  hike: ['mountain', 'footprints'],
  hiking: ['mountain', 'footprints'],
  hiker: ['person-standing', 'mountain'],
  blindfold: ['eye-off', 'venetian-mask'],
  torch: ['flashlight'],
  flashlight: ['flashlight'],
  lantern: ['lamp', 'flame-kindling'],
  campfire: ['flame-kindling', 'flame'],
  tent: ['tent'],
  camp: ['tent', 'flame-kindling'],
  thermostat: ['thermometer', 'gauge'],
  dial: ['gauge', 'circle-gauge'],
  knob: ['gauge', 'sliders-horizontal'],
  jar: ['cup-soda', 'flask-round'],
  bottle: ['wine', 'milk'],
  cup: ['coffee', 'cup-soda'],
  kettle: ['coffee', 'thermometer-sun'],
  oven: ['flame', 'utensils'],
  fridge: ['snowflake', 'box'],
  kitchen: ['utensils', 'soup'],
  tap: ['droplet'],
  faucet: ['droplet'],
  garden: ['sprout', 'flower'],
  stairs: ['arrow-up-narrow-wide', 'trending-up'],
  ladder: ['waves-ladder', 'trending-up'],
  elevator: ['arrow-up-down', 'move-vertical'],
  maze: ['route', 'puzzle'],
  treasure: ['gem', 'package'],
  lighthouse: ['lightbulb', 'ship'],
  harbour: ['anchor', 'ship'],
  sail: ['sailboat', 'ship'],
  sailboat: ['sailboat'],
  rope: ['cable', 'link'],
  knot: ['link', 'cable'],
  chain: ['link', 'cable'],
  brick: ['brick-wall'],
  foundation: ['brick-wall', 'layers'],
  blueprint: ['pencil-ruler', 'ruler'],
  scaffolding: ['construction', 'brick-wall'],
  toolbox: ['wrench', 'briefcase'],
  workshop: ['hammer', 'wrench'],
  race: ['flag', 'timer'],
  finish: ['flag', 'circle-check'],
  marathon: ['footprints', 'timer'],
  hurdle: ['brick-wall', 'construction'],
  game: ['gamepad-2', 'dices'],
  dice: ['dices', 'dice-5'],
  blocks: ['blocks', 'boxes'],
  seesaw: ['scale', 'weight'],
  weighing: ['scale', 'weight'],

  /* the rest of computing */
  recursion: ['repeat', 'folder-tree'],
  sorting: ['arrow-down-wide-narrow', 'list-ordered'],
  searching: ['search'],
  complexity: ['trending-up', 'network'],
  pointer: ['mouse-pointer-2', 'arrow-right'],
  heap: ['layers', 'boxes'],
  thread: ['git-branch', 'workflow'],
  concurrency: ['git-branch', 'layers'],
  parallel: ['columns-3', 'git-branch'],
  deadlock: ['lock', 'octagon-x'],
  compiler: ['cog', 'code'],
  interpreter: ['terminal', 'code'],
  bytecode: ['binary', 'code'],
  register: ['cpu', 'binary'],
  instruction: ['terminal', 'list-ordered'],
  protocol: ['file-text', 'network'],
  packet: ['package', 'network'],
  socket: ['plug', 'cable'],
  dns: ['globe', 'network'],
  tls: ['lock', 'shield-check'],
  http: ['globe', 'arrow-left-right'],
  rest: ['plug', 'globe'],
  graphql: ['network', 'braces'],
  frontend: ['monitor', 'layout-dashboard'],
  fullstack: ['layers', 'server'],
  devops: ['infinity', 'workflow'],
  kernel: ['cpu', 'cog'],
  filesystem: ['folder-tree', 'hard-drive'],
  bit: ['binary', 'toggle-left'],
  byte: ['binary'],
  encoding: ['binary', 'type'],
  compression: ['minimize-2', 'archive'],
  checksum: ['hash', 'shield-check'],
};

/** Last-resort icon when nothing matches but we still want a mark. */
export const FALLBACK_ICON = 'lightbulb';

/* --------------------------------------------------------- lucide on disk */

type IconIndex = {
  dir: string;
  slugs: Set<string>;
  slugList: string[];
  /** tag → slugs, from lucide's own `tags.json`. */
  byTag: Map<string, string[]>;
};

let indexCache: IconIndex | null | undefined;

/**
 * Absolute path of the installed `lucide-static` package.
 *
 * `require.resolve` is tried first and is the right answer under plain Node.
 * It is not sufficient on its own: inside a bundle (the studio's Next server
 * bundles this package) `require.resolve` is rewritten to the bundler's own
 * resolver and hands back a *module id* rather than a filesystem path, which is
 * why the icon lane used to report `no icons directory at ../node_modules/...`
 * and silently degrade to lettered cards in the web app while working fine in
 * the CLI.
 *
 * So the result is only accepted when it is absolute and really on disk; failing
 * that, we walk up from this module and from the cwd looking for the package in a
 * `node_modules` directory, which covers both pnpm layouts and a bundled caller.
 */
function findLucideDir(): string | null {
  try {
    const resolved = createRequire(import.meta.url).resolve('lucide-static/package.json');
    if (path.isAbsolute(resolved) && existsSync(resolved)) return path.dirname(resolved);
  } catch {
    /* not resolvable from here — try the directory walk below */
  }

  const starts: string[] = [process.cwd()];
  try {
    starts.unshift(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* `import.meta.url` is not a file URL under some bundlers */
  }

  for (const start of starts) {
    let cur = path.resolve(start);
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(cur, 'node_modules', 'lucide-static');
      if (existsSync(path.join(candidate, 'icons'))) return candidate;
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
  }
  return null;
}

function loadIndex(): IconIndex | null {
  if (indexCache !== undefined) return indexCache;
  try {
    const pkgDir = findLucideDir();
    if (!pkgDir) throw new Error('lucide-static is not installed or not reachable from here');
    const dir = path.join(pkgDir, 'icons');
    if (!existsSync(dir)) throw new Error(`no icons directory at ${dir}`);
    const slugList = readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice(0, -4));
    const byTag = new Map<string, string[]>();
    const tagsPath = path.join(pkgDir, 'tags.json');
    if (existsSync(tagsPath)) {
      const tags = JSON.parse(readFileSync(tagsPath, 'utf8')) as Record<string, string[]>;
      for (const [slug, list] of Object.entries(tags)) {
        for (const raw of list ?? []) {
          const t = normalise(raw);
          if (!t) continue;
          const arr = byTag.get(t);
          if (arr) arr.push(slug);
          else byTag.set(t, [slug]);
        }
      }
      // Shorter slugs are the more canonical answer for a shared tag.
      for (const arr of byTag.values())
        arr.sort((a, b) => a.length - b.length || a.localeCompare(b));
    }
    indexCache = { dir, slugs: new Set(slugList), slugList, byTag };
    log.debug(`lucide index: ${slugList.length} icons`, dir);
  } catch (err) {
    log.warn('lucide-static unavailable — icon lane will fall back to lettered cards', err);
    indexCache = null;
  }
  return indexCache;
}

/** True when the icon set is present and usable. */
export function iconsAvailable(): boolean {
  return loadIndex() !== null;
}

/* ------------------------------------------------------------------ matching */

function normalise(term: string): string {
  return term
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(ches|shes|xes|ses|zes)$/.test(word)) return word.slice(0, -2);
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/ss$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/-/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (out.size === 0 && t.length > 0) out.add(t);
  return out;
}

/** Sørensen–Dice coefficient — cheap, and forgiving of plurals and typos. */
function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const g of A) if (B.has(g)) hits++;
  return (2 * hits) / (A.size + B.size);
}

export type IconMatch = {
  slug: string;
  how: 'keyword' | 'token' | 'slug' | 'tag' | 'fuzzy' | 'fallback';
  score: number;
};

const matchCache = new Map<string, IconMatch | undefined>();

function firstAvailable(candidates: string[], index: IconIndex): string | undefined {
  return candidates.find((c) => index.slugs.has(c));
}

function keywordHit(word: string, index: IconIndex): string | undefined {
  const direct = ICON_KEYWORDS[word];
  if (direct) {
    const hit = firstAvailable(direct, index);
    if (hit) return hit;
  }
  const sing = singular(word);
  if (sing !== word) {
    const s = ICON_KEYWORDS[sing];
    if (s) {
      const hit = firstAvailable(s, index);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Resolve a noun (or a short phrase) to a lucide slug.
 *
 * Returns `undefined` only when the icon set is missing entirely — otherwise
 * there is always at least the fuzzy or fallback answer, because "no icon" is a
 * worse outcome for a whiteboard than "a slightly loose icon".
 */
export function matchIcon(
  term: string,
  opts: { allowFallback?: boolean } = {},
): IconMatch | undefined {
  const index = loadIndex();
  if (!index) return undefined;
  const cacheKey = `${term}::${opts.allowFallback === false ? 0 : 1}`;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

  const result = resolveUncached(term, index, opts.allowFallback !== false);
  matchCache.set(cacheKey, result);
  return result;
}

function resolveUncached(
  term: string,
  index: IconIndex,
  allowFallback: boolean,
): IconMatch | undefined {
  const norm = normalise(term);
  if (!norm) return allowFallback ? fallbackMatch(index) : undefined;

  // 1. whole phrase in the keyword table
  const whole = keywordHit(norm.replace(/-/g, ''), index) ?? keywordHit(norm, index);
  if (whole) return { slug: whole, how: 'keyword', score: 1 };

  // 2. the phrase is already an icon name
  if (index.slugs.has(norm)) return { slug: norm, how: 'slug', score: 1 };
  const singNorm = singular(norm);
  if (index.slugs.has(singNorm)) return { slug: singNorm, how: 'slug', score: 0.98 };

  const tokens = norm.split('-').filter(Boolean);

  // 3. any token in the keyword table — last token first, since English puts the
  //    head noun at the end ("request queue" → queue).
  for (const tok of [...tokens].reverse()) {
    const hit = keywordHit(tok, index);
    if (hit) return { slug: hit, how: 'token', score: 0.9 };
  }

  // 4. lucide's own tags
  for (const tok of [...tokens].reverse()) {
    const tagged = index.byTag.get(tok) ?? index.byTag.get(singular(tok));
    const hit = tagged ? firstAvailable(tagged, index) : undefined;
    if (hit) return { slug: hit, how: 'tag', score: 0.8 };
  }
  const phraseTag = index.byTag.get(norm.replace(/-/g, ' ')) ?? index.byTag.get(norm);
  if (phraseTag) {
    const hit = firstAvailable(phraseTag, index);
    if (hit) return { slug: hit, how: 'tag', score: 0.78 };
  }

  // 5. similarity over icon names and keyword table entries
  let best: IconMatch | undefined;
  const probe = tokens.length > 0 ? (tokens[tokens.length - 1] as string) : norm;
  for (const cand of [probe, norm]) {
    for (const slug of index.slugList) {
      const score = dice(cand, slug);
      if (score > (best?.score ?? 0.58)) best = { slug, how: 'fuzzy', score };
    }
    for (const [word, slugs] of Object.entries(ICON_KEYWORDS)) {
      const score = dice(cand, word) * 0.97;
      if (score > (best?.score ?? 0.58)) {
        const hit = firstAvailable(slugs, index);
        if (hit) best = { slug: hit, how: 'fuzzy', score };
      }
    }
  }
  if (best) return best;
  return allowFallback ? fallbackMatch(index) : undefined;
}

function fallbackMatch(index: IconIndex): IconMatch | undefined {
  const slug = firstAvailable([FALLBACK_ICON, 'circle', 'square'], index) ?? index.slugList[0];
  return slug ? { slug, how: 'fallback', score: 0 } : undefined;
}

/**
 * The confident tiers. An exact slug, a keyword-table hit, or a keyword on one
 * of the term's tokens are the answers we trust; `tag` and `fuzzy` are guesses.
 */
const CONFIDENT: ReadonlySet<IconMatch['how']> = new Set(['slug', 'keyword', 'token']);

/**
 * Resolve an asset to a slug: **the id first, then the prompt.**
 *
 * This ordering is not a stylistic preference, it is a bug fix. The id is the
 * noun the author chose and the planner's vocabulary is real lucide slugs; the
 * prompt is prose written for the image adapters ("a downward trending arrow",
 * "a mountain peak"). Feeding prose to the matcher pushes it into the tag and
 * fuzzy tiers, which is how `trending-down` became `log-in`, `mountain` became
 * `zodiac-capricorn`, `briefcase` became `spell-check` and `cpu` became
 * `map-pin` — silently, in half the icons of both sample films.
 *
 * Only a *confident* id match wins outright. When the id is unhelpful (`asset-3`,
 * `thing`) the prompt carries more words to go on and is the better bet, so it
 * gets a full attempt including the fallback tiers.
 */
export function matchAsset(
  asset: { id: string; prompt?: string },
  opts: { allowFallback?: boolean } = {},
): IconMatch | undefined {
  const byId = matchIcon(asset.id, { allowFallback: false });
  if (byId && CONFIDENT.has(byId.how)) return byId;

  const prompt = asset.prompt?.trim();
  if (prompt) {
    const byPrompt = matchIcon(prompt, { allowFallback: false });
    if (byPrompt && CONFIDENT.has(byPrompt.how)) return byPrompt;
    // Neither is confident: prefer whichever scored better, id breaking ties.
    const best = !byId
      ? byPrompt
      : !byPrompt
        ? byId
        : byPrompt.score > byId.score
          ? byPrompt
          : byId;
    if (best) return best;
  }
  if (byId) return byId;
  const index = loadIndex();
  if (!index) return undefined;
  return opts.allowFallback === false ? undefined : fallbackMatch(index);
}

/* ---------------------------------------------------------------- geometry */

export function readIconSvg(slug: string): string | undefined {
  const index = loadIndex();
  if (!index) return undefined;
  const file = path.join(index.dir, `${slug}.svg`);
  if (!existsSync(file)) return undefined;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

const CHILD_RE = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)>/g;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"/g;

function attrs(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(chunk)) !== null) out[m[1] as string] = m[2] as string;
  return out;
}

function num(a: Record<string, string>, k: string, dflt = 0): number {
  const v = Number(a[k]);
  return Number.isFinite(v) ? v : dflt;
}

function pointsToPath(raw: string, close: boolean): string {
  const nums = (raw.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const parts: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'}${nums[i]} ${nums[i + 1]}`);
  }
  if (parts.length === 0) return '';
  return close ? `${parts.join(' ')} Z` : parts.join(' ');
}

/**
 * Every drawable child of a lucide SVG as path data, in document order.
 *
 * `<circle>`/`<rect>`/`<line>`/`<polyline>` are converted rather than skipped —
 * a good third of the set uses them, and dropping them would silently lose
 * pupils, dots and frames.
 */
export function iconPathData(svgText: string): string[] {
  const out: string[] = [];
  CHILD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHILD_RE.exec(svgText)) !== null) {
    const tag = m[1] as string;
    const a = attrs(m[2] as string);
    switch (tag) {
      case 'path': {
        const d = a.d;
        if (d) out.push(d);
        break;
      }
      case 'circle': {
        const cx = num(a, 'cx');
        const cy = num(a, 'cy');
        const r = num(a, 'r');
        if (r > 0)
          out.push(
            `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`,
          );
        break;
      }
      case 'ellipse': {
        const cx = num(a, 'cx');
        const cy = num(a, 'cy');
        const rx = num(a, 'rx');
        const ry = num(a, 'ry');
        if (rx > 0 && ry > 0)
          out.push(
            `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`,
          );
        break;
      }
      case 'rect': {
        const x = num(a, 'x');
        const y = num(a, 'y');
        const w = num(a, 'width');
        const h = num(a, 'height');
        const rx = Math.min(num(a, 'rx', num(a, 'ry')), Math.min(w, h) / 2);
        if (w <= 0 || h <= 0) break;
        if (rx > 0) {
          out.push(
            `M${x + rx} ${y}H${x + w - rx}A${rx} ${rx} 0 0 1 ${x + w} ${y + rx}` +
              `V${y + h - rx}A${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h}` +
              `H${x + rx}A${rx} ${rx} 0 0 1 ${x} ${y + h - rx}` +
              `V${y + rx}A${rx} ${rx} 0 0 1 ${x + rx} ${y}Z`,
          );
        } else {
          out.push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
        }
        break;
      }
      case 'line': {
        out.push(`M${num(a, 'x1')} ${num(a, 'y1')}L${num(a, 'x2')} ${num(a, 'y2')}`);
        break;
      }
      case 'polyline': {
        const d = pointsToPath(a.points ?? '', false);
        if (d) out.push(d);
        break;
      }
      case 'polygon': {
        const d = pointsToPath(a.points ?? '', true);
        if (d) out.push(d);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export type IconResult = {
  slug: string;
  how: IconMatch['how'];
  paths: InkPath[];
};

/**
 * Resolve a noun to hand-drawn strokes inside `box`.
 *
 * Geometry is scaled into the box *before* roughening, and the shapes are drawn
 * largest-first so the reveal builds the silhouette before the details — the
 * order a person would actually draw in.
 */
export function iconPaths(
  term: string,
  box: Box,
  ctx: DrawContext,
  opts: { inset?: number; slug?: string } = {},
): IconResult | undefined {
  const match = opts.slug ? { slug: opts.slug, how: 'slug' as const, score: 1 } : matchIcon(term);
  if (!match) return undefined;
  const svgText = readIconSvg(match.slug);
  if (!svgText) return undefined;

  const raws = iconPathData(svgText);
  if (raws.length === 0) return undefined;

  const inset = opts.inset ?? Math.min(box.w, box.h) * 0.06;
  // lucide is authored on a 24×24 grid with a 2-unit stroke, so the visual
  // bounds are inset from the viewBox; fitting the viewBox keeps icons a
  // consistent size relative to each other.
  const m = fitMatrix({ x: 0, y: 0, w: 24, h: 24 }, box, inset);

  const scaled = raws
    .map((d) => {
      const segs = transformSegs(parsePath(d), m);
      const bbox = pointsBBox(samplePath(segs));
      return { d: pathToString(segs), area: Math.max(1, bbox.w) * Math.max(1, bbox.h) };
    })
    .filter((s) => s.d.length > 0)
    .sort((a, b) => b.area - a.area);

  const paths: InkPath[] = [];
  scaled.forEach((s, i) => {
    paths.push(
      ...roughenPathData({ ...ctx, group: `icon:${match.slug}` }, s.d, 30 + i, {
        // Icons carry fine detail; full marker roughness turns them to mush.
        roughness: ctx.style.roughness * 0.78,
        bowing: ctx.style.bowing * 0.85,
      }),
    );
  });
  if (paths.length === 0) return undefined;
  return { slug: match.slug, how: match.how, paths };
}
