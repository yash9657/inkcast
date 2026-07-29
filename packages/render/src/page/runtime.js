/*
 * Inkcast animation runtime — the whole visual state of the film, as a pure
 * function of time.
 *
 * THE RULE: nothing in this file may read a clock, call requestAnimationFrame,
 * use Math.random, or depend on any state left behind by a previous call. The
 * DOM is built exactly once from `window.__INKCAST_PLAN__`; after that, every
 * animated attribute is rewritten on *every* seek from `t` alone. Frame N is
 * therefore byte-identical however many times, in whatever order, and in
 * whichever of the four capture workers it is rendered.
 *
 * The only DOM measurement happens once, after the handwriting font has loaded:
 * text wrapping and path lengths. Both are deterministic for a given font.
 *
 * This exact file is used for capture and for the studio preview. Preview adds a
 * clock on top (see preview.js) and never modifies anything below.
 */
/* global window, document, DOMParser, getComputedStyle */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var plan = window.__INKCAST_PLAN__;
  if (!plan) throw new Error('inkcast: window.__INKCAST_PLAN__ is missing');

  var LINE_H = 1.3;
  /** Fraction of a word's time slice spent actually drawing it (rest is a beat). */
  var WORD_DUTY = 0.82;
  /** Writing covers ground more slowly than drawing, per unit of length. */
  var WRITE_COST = 1.55;
  var FADE_COST = 70 * plan.scale;
  var PEN_FADE = 0.1;

  /* ----------------------------------------------------------------- maths */

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function c01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function easeInOutCubic(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }
  function easeOutCubic(p) {
    return 1 - Math.pow(1 - p, 3);
  }
  function easeInOutSine(p) {
    return -(Math.cos(Math.PI * p) - 1) / 2;
  }
  function easeOutBack(p) {
    var c1 = 1.5;
    var c3 = c1 + 1;
    var q = p - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
  }
  /** Fixed precision keeps attribute strings — and therefore frames — stable. */
  function f(v) {
    if (!isFinite(v)) return '0';
    var r = Math.round(v * 1000) / 1000;
    return r === 0 ? '0' : String(r);
  }

  /* ------------------------------------------------------------------- dom */

  var baseScale = Math.min(plan.frame.w / plan.canvas.w, plan.frame.h / plan.canvas.h);
  var stage = document.getElementById('stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);
  }

  var board = document.createElementNS(SVGNS, 'svg');
  board.setAttribute('id', 'inkcast-board');
  board.setAttribute('xmlns', SVGNS);
  board.setAttribute('width', '100%');
  board.setAttribute('height', '100%');
  board.setAttribute('viewBox', '0 0 ' + plan.canvas.w + ' ' + plan.canvas.h);
  board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  board.setAttribute('shape-rendering', 'geometricPrecision');
  board.setAttribute('text-rendering', 'geometricPrecision');
  board.setAttribute('font-family', plan.fontFamily);
  stage.appendChild(board);

  var defs = document.createElementNS(SVGNS, 'defs');
  board.appendChild(defs);

  // The paper extends well past the canvas so a camera nudge never shows a void.
  var paperBox = {
    x: plan.canvas.x - plan.canvas.w,
    y: plan.canvas.y - plan.canvas.h,
    w: plan.canvas.w * 3,
    h: plan.canvas.h * 3,
  };
  var paper = document.createElementNS(SVGNS, 'rect');
  paper.setAttribute('x', f(paperBox.x));
  paper.setAttribute('y', f(paperBox.y));
  paper.setAttribute('width', f(paperBox.w));
  paper.setAttribute('height', f(paperBox.h));
  paper.setAttribute('fill', plan.paper);
  board.appendChild(paper);

  if (plan.grid) {
    var pat = document.createElementNS(SVGNS, 'pattern');
    pat.setAttribute('id', 'inkcast-grid');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('width', f(plan.gridStep));
    pat.setAttribute('height', f(plan.gridStep));
    var dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', f(plan.gridStep / 2));
    dot.setAttribute('cy', f(plan.gridStep / 2));
    dot.setAttribute('r', f(Math.max(1, plan.gridStep / 30)));
    dot.setAttribute('fill', plan.grid);
    pat.appendChild(dot);
    defs.appendChild(pat);
    var gridRect = document.createElementNS(SVGNS, 'rect');
    gridRect.setAttribute('x', f(paperBox.x));
    gridRect.setAttribute('y', f(paperBox.y));
    gridRect.setAttribute('width', f(paperBox.w));
    gridRect.setAttribute('height', f(paperBox.h));
    gridRect.setAttribute('fill', 'url(#inkcast-grid)');
    board.appendChild(gridRect);
  }

  var content = document.createElementNS(SVGNS, 'g');
  content.setAttribute('id', 'inkcast-content');
  board.appendChild(content);

  // Off-board text measurer. Opacity 0 rather than display:none, because a
  // non-rendered SVG text node reports no metrics.
  var meas = document.createElementNS(SVGNS, 'text');
  meas.setAttribute('id', 'inkcast-meas');
  meas.setAttribute('x', f(paperBox.x - 100000));
  meas.setAttribute('y', '0');
  meas.setAttribute('opacity', '0');
  board.appendChild(meas);

  var penG = document.createElementNS(SVGNS, 'g');
  penG.setAttribute('id', 'inkcast-pen');
  penG.setAttribute('opacity', '0');
  penG.setAttribute('transform', 'translate(0,0)');
  var penInner = document.createElementNS(SVGNS, 'g');
  penG.appendChild(penInner);
  for (var pi = 0; pi < plan.pen.parts.length; pi++) {
    var pp = plan.pen.parts[pi];
    var pel = document.createElementNS(SVGNS, 'path');
    pel.setAttribute('d', pp.d);
    pel.setAttribute('fill', pp.fill);
    pel.setAttribute('stroke', pp.stroke);
    pel.setAttribute('stroke-width', String(pp.strokeWidth));
    pel.setAttribute('stroke-linejoin', 'round');
    penInner.appendChild(pel);
  }
  board.appendChild(penG);

  /* ------------------------------------------------------- build the items */

  var records = [];
  var clipSeq = 0;

  function makeGeom(prim) {
    var el = document.createElementNS(SVGNS, 'path');
    el.setAttribute('d', prim.d);
    el.setAttribute('fill', prim.fill);
    el.setAttribute('stroke', prim.stroke);
    el.setAttribute('stroke-width', f(prim.strokeWidth));
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    if (prim.opacity !== undefined && prim.opacity !== null) {
      el.setAttribute('opacity', f(prim.opacity));
    }
    return el;
  }

  /** Presentation attributes that a child of the imported <svg> inherits. */
  var INHERITED = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'opacity',
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'paint-order',
    'clip-rule',
    'style',
  ];

  /** Tags that hold other paintable nodes. */
  var CONTAINERS = { g: 1, a: 1, switch: 1 };
  /** Tags that actually put ink on the board. */
  var PAINTABLE = {
    path: 1,
    line: 1,
    polyline: 1,
    polygon: 1,
    circle: 1,
    ellipse: 1,
    rect: 1,
    text: 1,
    image: 1,
    use: 1,
  };

  /** Strip anything that could paint on its own schedule or run code. */
  function sanitize(node) {
    var kill = node.querySelectorAll(
      'script,animate,animateTransform,animateMotion,set,foreignObject,style',
    );
    for (var i = 0; i < kill.length; i++) {
      var k = kill[i];
      if (k.parentNode) k.parentNode.removeChild(k);
    }
    var all = node.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var attrs = all[j].attributes;
      for (var a = attrs.length - 1; a >= 0; a--) {
        var name = attrs[a].name;
        if (name.slice(0, 2).toLowerCase() === 'on') all[j].removeAttribute(name);
      }
    }
  }

  function makeSvg(prim) {
    var g = document.createElementNS(SVGNS, 'g');
    var doc;
    try {
      doc = new DOMParser().parseFromString(prim.svg, 'image/svg+xml');
    } catch (e) {
      return g;
    }
    var root = doc.documentElement;
    if (
      !root ||
      root.nodeName === 'parsererror' ||
      root.getElementsByTagName('parsererror').length
    ) {
      return g;
    }
    var vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
    var vx = 0;
    var vy = 0;
    var vw = parseFloat(root.getAttribute('width') || '') || prim.box.w;
    var vh = parseFloat(root.getAttribute('height') || '') || prim.box.h;
    if (vb.length === 4) {
      vx = parseFloat(vb[0]) || 0;
      vy = parseFloat(vb[1]) || 0;
      vw = parseFloat(vb[2]) || vw;
      vh = parseFloat(vb[3]) || vh;
    }
    var imported = document.importNode(root, true);
    while (imported.firstChild) g.appendChild(imported.firstChild);
    sanitize(g);
    // Presentation attributes on the source <svg> are inherited by its children,
    // so they have to move onto the wrapper. Without this, a `fill="none"
    // stroke="currentColor"` icon (every lucide icon) renders as a black blob.
    for (var pa = 0; pa < INHERITED.length; pa++) {
      var an = INHERITED[pa];
      var av = root.getAttribute(an);
      if (av !== null) g.setAttribute(an, av);
    }

    var k = Math.min(prim.box.w / (vw || 1), prim.box.h / (vh || 1));
    var ox = prim.box.x + (prim.box.w - vw * k) / 2;
    var oy = prim.box.y + (prim.box.h - vh * k) / 2;
    var tr = 'translate(' + f(ox) + ',' + f(oy) + ') scale(' + f(k) + ')';
    if (prim.flipX) tr += ' translate(' + f(vw) + ',0) scale(-1,1)';
    tr += ' translate(' + f(-vx) + ',' + f(-vy) + ')';
    g.setAttribute('transform', tr);
    // Lets `stroke="currentColor"` assets (e.g. lucide icons) take the board ink.
    g.setAttribute('color', prim.stroke);
    return g;
  }

  for (var ii = 0; ii < plan.items.length; ii++) {
    var item = plan.items[ii];
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('data-id', item.id);
    g.setAttribute('opacity', '0');
    g.setAttribute('transform', 'translate(0,0)');
    var built = [];
    for (var qi = 0; qi < item.prims.length; qi++) {
      var prim = item.prims[qi];
      if (prim.kind === 'geom') {
        var gel = makeGeom(prim);
        g.appendChild(gel);
        built.push({ prim: prim, el: gel });
      } else if (prim.kind === 'svg') {
        var sel = makeSvg(prim);
        g.appendChild(sel);
        built.push({ prim: prim, el: sel });
      } else {
        var tg = document.createElementNS(SVGNS, 'g');
        g.appendChild(tg);
        built.push({ prim: prim, el: tg });
      }
    }
    content.appendChild(g);
    records.push({ item: item, g: g, built: built, parts: [] });
  }

  /* --------------------------------------------------- measure (once, late) */

  function textWidth(str, size) {
    meas.setAttribute('font-size', f(size));
    meas.textContent = str;
    return meas.getComputedTextLength();
  }

  function wrapText(text, maxW, size) {
    var lines = [];
    var paras = String(text).split('\n');
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        continue;
      }
      var line = '';
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        var next = line ? line + ' ' + word : word;
        if (line && textWidth(next, size) > maxW) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
        // A single word wider than the box: break it by characters.
        while (textWidth(line, size) > maxW && line.length > 1) {
          var cut = line.length;
          while (cut > 1 && textWidth(line.slice(0, cut), size) > maxW) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function fitsBox(lines, size, box) {
    return lines.length * size * LINE_H <= box.h * 1.06;
  }

  /**
   * Wrap to the box by real measurement, shrinking until it fits.
   *
   * Never truncates. The MVP shipped ellipsised captions, which is the one failure
   * a teaching video cannot absorb — the learner is reading the sentence that
   * explains the picture. Stepping the size down by a fixed ratio a fixed number of
   * times overflowed instead; a binary search finds the largest size that actually
   * fits, and every word survives.
   */
  function layoutText(prim, host) {
    var size = prim.size;
    var lines = wrapText(prim.text, prim.box.w, size);
    if (prim.shrink && !fitsBox(lines, size, prim.box)) {
      var lo = Math.max(9, prim.size * 0.42);
      var hi = prim.size;
      var bestSize = lo;
      var bestLines = wrapText(prim.text, prim.box.w, lo);
      for (var attempt = 0; attempt < 6; attempt++) {
        var mid = (lo + hi) / 2;
        var cand = wrapText(prim.text, prim.box.w, mid);
        if (fitsBox(cand, mid, prim.box)) {
          lo = mid;
          bestSize = mid;
          bestLines = cand;
        } else {
          hi = mid;
        }
      }
      size = bestSize;
      lines = bestLines;
    }
    var anchor = prim.align === 'center' ? 'middle' : prim.align === 'right' ? 'end' : 'start';
    var ax =
      prim.align === 'center'
        ? prim.box.x + prim.box.w / 2
        : prim.align === 'right'
          ? prim.box.x + prim.box.w
          : prim.box.x;
    var blockH = lines.length * size * LINE_H;
    var top = prim.vAlign === 'middle' ? prim.box.y + (prim.box.h - blockH) / 2 : prim.box.y;
    var padX = size * 0.14;
    var out = [];

    for (var i = 0; i < lines.length; i++) {
      var str = lines[i];
      if (!str) continue;
      var baseline = top + size * 0.99 + i * size * LINE_H;
      var textEl = document.createElementNS(SVGNS, 'text');
      textEl.setAttribute('x', f(ax));
      textEl.setAttribute('y', f(baseline));
      textEl.setAttribute('font-size', f(size));
      textEl.setAttribute('fill', prim.color);
      textEl.setAttribute('text-anchor', anchor);
      textEl.textContent = str;
      host.appendChild(textEl);

      var width = textEl.getComputedTextLength();
      var left = anchor === 'middle' ? ax - width / 2 : anchor === 'end' ? ax - width : ax;

      var clip = document.createElementNS(SVGNS, 'clipPath');
      clipSeq += 1;
      var cid = 'inkcast-clip-' + clipSeq;
      clip.setAttribute('id', cid);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      var rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('x', f(left - padX));
      rect.setAttribute('y', f(baseline - size * 1.02));
      rect.setAttribute('height', f(size * 1.45));
      rect.setAttribute('width', '0');
      clip.appendChild(rect);
      defs.appendChild(clip);
      textEl.setAttribute('clip-path', 'url(#' + cid + ')');

      // Per-word advances, straight from the rendered line — exact, not estimated.
      var words = [];
      var toks = str.split(' ');
      var pos = 0;
      for (var tk = 0; tk < toks.length; tk++) {
        var tok = toks[tk];
        if (tok.length) {
          words.push({
            x0: pos === 0 ? 0 : textEl.getSubStringLength(0, pos),
            x1: textEl.getSubStringLength(0, pos + tok.length),
          });
        }
        pos += tok.length + 1;
      }
      if (!words.length) words.push({ x0: 0, x1: width });

      out.push({
        t: 'line',
        rect: rect,
        textEl: textEl,
        left: left,
        width: width,
        padX: padX,
        baseline: baseline,
        size: size,
        words: words,
        cost: Math.max(1, width * WRITE_COST),
      });
    }
    return out;
  }

  /** Document-order walk of an imported asset, classifying every paintable node. */
  function collectSvgParts(root, out) {
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      var tag = el.tagName.toLowerCase();
      if (CONTAINERS[tag]) {
        collectSvgParts(el, out);
        continue;
      }
      // defs/masks/gradients/titles paint nothing on their own.
      if (!PAINTABLE[tag]) continue;
      var cs = getComputedStyle(el);
      var base = parseFloat(cs.opacity);
      if (!isFinite(base)) base = 1;
      var strokeOn = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeOpacity || '1') > 0;
      var fillOn = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity || '1') > 0;
      var len = 0;
      if (typeof el.getTotalLength === 'function') {
        try {
          len = el.getTotalLength();
        } catch (e) {
          len = 0;
        }
      }
      // An intentionally dashed stroke cannot also be dash-revealed.
      var dashed = cs.strokeDasharray && cs.strokeDasharray !== 'none';
      if (strokeOn && !dashed && len > 0.5) {
        el.setAttribute('stroke-dasharray', f(len));
        out.push({
          t: 'stroke',
          el: el,
          len: len,
          cost: len,
          baseOpacity: base,
          fillOn: fillOn,
          baseFill: parseFloat(cs.fillOpacity || '1') || 1,
        });
      } else {
        out.push({ t: 'fade', el: el, cost: FADE_COST, baseOpacity: base });
      }
    }
  }

  function localMatrix(el) {
    if (typeof el.getCTM !== 'function' || typeof content.getCTM !== 'function') return null;
    var m = el.getCTM();
    var base = content.getCTM();
    if (!m || !base) return null;
    try {
      return base.inverse().multiply(m);
    } catch (e) {
      return null;
    }
  }

  function layoutAll() {
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      var parts = [];
      for (var b = 0; b < rec.built.length; b++) {
        var entry = rec.built[b];
        var prim = entry.prim;
        if (prim.kind === 'geom') {
          var len = 0;
          try {
            len = entry.el.getTotalLength();
          } catch (e) {
            len = 0;
          }
          if (len > 0.5 && !prim.noDash) {
            entry.el.setAttribute('stroke-dasharray', f(len));
            parts.push({
              t: 'stroke',
              el: entry.el,
              len: len,
              cost: len,
              baseOpacity: prim.opacity === undefined ? 1 : prim.opacity,
              fillOn: prim.fill && prim.fill !== 'none',
              baseFill: 1,
            });
          } else {
            parts.push({
              t: 'fade',
              el: entry.el,
              cost: prim.noDash ? Math.max(20, len * 0.35) : FADE_COST,
              baseOpacity: prim.opacity === undefined ? 1 : prim.opacity,
            });
          }
        } else if (prim.kind === 'svg') {
          var before = parts.length;
          collectSvgParts(entry.el, parts);
          for (var s = before; s < parts.length; s++) {
            var m = localMatrix(parts[s].el);
            if (m) parts[s].m = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
          }
        } else {
          var lineParts = layoutText(prim, entry.el);
          for (var lp = 0; lp < lineParts.length; lp++) parts.push(lineParts[lp]);
        }
      }
      // Normalise the item's timeline: every part gets a slice of [0,1]
      // proportional to how much ink it represents, in drawing order.
      var total = 0;
      for (var c = 0; c < parts.length; c++) total += parts[c].cost;
      if (total <= 0) total = 1;
      var acc = 0;
      for (var d2 = 0; d2 < parts.length; d2++) {
        parts[d2].c0 = acc / total;
        acc += parts[d2].cost;
        parts[d2].c1 = acc / total;
      }
      if (parts.length) parts[parts.length - 1].c1 = 1;
      // A trail bead becomes visible when the moving element passes it, so each
      // part carries the progress at which it lights up rather than a time slice.
      if (rec.item.trailAt && parts.length) {
        var exact = rec.item.trailAt.length === parts.length;
        for (var tk = 0; tk < parts.length; tk++) {
          parts[tk].uAt = exact ? rec.item.trailAt[tk] : (tk + 1) / (parts.length + 1);
        }
        rec.uStep = 1 / (parts.length + 1);
      }
      rec.parts = parts;
    }
    meas.textContent = '';
  }

  /* ------------------------------------------------------------------ motion */

  /**
   * Where a moving element is at time `t`, from the baked arc-length table.
   *
   * The table is sampled once per output frame in Node, so at capture time this is
   * a lookup with a linear blend between neighbours — no path maths, no easing
   * curve evaluated twice, nothing that can disagree with the plan.
   */
  function motionAt(m, t) {
    var n = m.samples.length;
    if (n === 0) return [0, 0, 0];
    if (t <= m.start) return m.samples[0];
    if (t >= m.end || n === 1) return m.samples[n - 1];
    var span = m.end - m.start;
    var pos = span > 0 ? ((t - m.start) / span) * (n - 1) : 0;
    var i = Math.floor(pos);
    if (i >= n - 1) return m.samples[n - 1];
    var f = pos - i;
    var a = m.samples[i];
    var b = m.samples[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  /* ------------------------------------------------------------ the camera */

  function sceneIndexAt(t) {
    for (var i = plan.scenes.length - 1; i >= 0; i--) {
      if (t >= plan.scenes[i].start) return i;
    }
    return 0;
  }

  function cameraAt(t) {
    var i = sceneIndexAt(t);
    var sc = plan.scenes[i];
    var cam = sc.camera;
    if (i === 0) return cam;
    var prev = plan.scenes[i - 1].camera;
    var tr = Math.min(cam.transition, sc.dur * 0.7);
    var lt = t - sc.start;
    if (!(tr > 0) || lt >= tr) return cam;
    var p = easeInOutCubic(lt / tr);
    var z0 = prev.zoom > 0 ? prev.zoom : 1;
    var z1 = cam.zoom > 0 ? cam.zoom : 1;
    return {
      x: prev.x + (cam.x - prev.x) * p,
      // Zoom interpolates geometrically, which is what "natural" means for a
      // camera: equal ratios per unit time, not equal differences.
      y: prev.y + (cam.y - prev.y) * p,
      zoom: z0 * Math.pow(z1 / z0, p),
      transition: 0,
    };
  }

  /* -------------------------------------------------------------- the seek */

  function itemProgress(item, t) {
    if (item.dur <= 0) return t >= item.start ? 1 : 0;
    return c01((t - item.start) / item.dur);
  }

  /**
   * How much of a stroke is laid down at local progress `lp`. Linear on purpose:
   * the pen crosses a multi-stroke item at a constant speed instead of stuttering
   * at every stroke boundary. `penPoint` must use the same curve or the nib
   * drifts off the ink.
   */
  function strokeReveal(lp) {
    return lp;
  }

  function applyPart(part, lp, reveal) {
    if (part.t === 'stroke') {
      var sp = reveal ? strokeReveal(lp) : 1;
      part.el.setAttribute('stroke-dashoffset', f(part.len * (1 - sp)));
      if (part.fillOn) part.el.setAttribute('fill-opacity', f(part.baseFill * (reveal ? sp : 1)));
      if (part.baseOpacity !== 1) part.el.setAttribute('opacity', f(part.baseOpacity));
      return;
    }
    if (part.t === 'fade') {
      var fp = reveal ? easeInOutSine(lp) : 1;
      part.el.setAttribute('opacity', f(part.baseOpacity * fp));
      return;
    }
    // line
    var edge;
    if (!reveal || lp >= 1) {
      edge = part.width;
    } else if (lp <= 0) {
      edge = -part.padX;
    } else {
      edge = wordEdge(part, lp);
    }
    part.rect.setAttribute('width', f(Math.max(0, edge + part.padX)));
  }

  function wordEdge(part, lp) {
    var words = part.words;
    var w = part.width || 1;
    var prevEnd = 0;
    for (var i = 0; i < words.length; i++) {
      var s0 = prevEnd / w;
      var s1 = words[i].x1 / w;
      prevEnd = words[i].x1;
      if (lp >= s1 && i < words.length - 1) continue;
      var span = s1 - s0;
      var local = span > 0 ? (lp - s0) / span : 1;
      var inner = c01(local / WORD_DUTY);
      return words[i].x0 + (words[i].x1 - words[i].x0) * inner;
    }
    return part.width;
  }

  function penPoint(part, lp) {
    if (part.t === 'stroke') {
      var at = part.len * strokeReveal(lp);
      var eps = Math.min(part.len, Math.max(0.5, part.len * 0.01));
      var p1;
      var p2;
      try {
        p1 = part.el.getPointAtLength(Math.max(0, at - eps * 0.5));
        p2 = part.el.getPointAtLength(Math.min(part.len, at + eps * 0.5));
      } catch (e) {
        return null;
      }
      var x1 = p1.x;
      var y1 = p1.y;
      var x2 = p2.x;
      var y2 = p2.y;
      if (part.m) {
        var m = part.m;
        var tx1 = m.a * x1 + m.c * y1 + m.e;
        var ty1 = m.b * x1 + m.d * y1 + m.f;
        var tx2 = m.a * x2 + m.c * y2 + m.e;
        var ty2 = m.b * x2 + m.d * y2 + m.f;
        x1 = tx1;
        y1 = ty1;
        x2 = tx2;
        y2 = ty2;
      }
      return {
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2,
        angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
      };
    }
    if (part.t === 'line') {
      var edge = wordEdge(part, lp);
      return { x: part.left + edge, y: part.baseline - part.size * 0.06, angle: 0 };
    }
    return null;
  }

  function seek(time) {
    var t = clamp(Number(time) || 0, 0, plan.duration);
    var cam = cameraAt(t);
    var pxPerUnit = baseScale * (cam.zoom > 0 ? cam.zoom : 1);
    var vw = plan.frame.w / pxPerUnit;
    var vh = plan.frame.h / pxPerUnit;
    board.setAttribute(
      'viewBox',
      f(cam.x - vw / 2) + ' ' + f(cam.y - vh / 2) + ' ' + f(vw) + ' ' + f(vh),
    );

    // Pass 1: behaviours that act on *other* items.
    var dimAmount = 0;
    var dimKeep = null;
    var pulse = null;
    for (var i = 0; i < records.length; i++) {
      var it = records[i].item;
      if (it.dimOthers) {
        var span = Math.max(0.001, it.sceneEnd - it.start);
        var into = c01((t - it.start) / Math.min(0.45, span));
        var out = 1 - c01((t - (it.sceneEnd - 0.35)) / 0.35);
        var amount = Math.min(into, Math.max(0, out));
        if (amount > dimAmount) {
          dimAmount = amount;
          dimKeep = it.dimOthers;
        }
      }
      if (it.pulseTarget && t >= it.start) {
        var age = t - it.start;
        var decay = Math.exp(-age * 1.25);
        var s = 1 + 0.075 * Math.sin(age * Math.PI * 2 * 1.35) * decay;
        if (decay > 0.02) {
          if (!pulse) pulse = {};
          pulse[it.pulseTarget] = s;
        }
      }
    }

    // Pass 2: every item's own state, written unconditionally.
    var penItem = null;
    var penPart = null;
    var penLocal = 0;
    var penShift = null;
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      var item = rec.item;
      var p = itemProgress(item, t);
      var alpha = t < item.start ? 0 : 1;
      var reveal = item.style === 'draw' || item.style === 'write';
      var scale = 1;

      if (!reveal) {
        if (item.style === 'fade') {
          alpha *= easeInOutSine(p);
        } else if (item.style === 'pop') {
          scale = 0.74 + 0.26 * easeOutBack(p);
          alpha *= c01(p * 3.2);
        } else if (item.style === 'grow') {
          scale = 0.1 + 0.9 * easeOutCubic(p);
          alpha *= c01(p * 4);
        }
      }

      if (!item.persist) {
        var fadeDur = Math.min(0.55, Math.max(0.2, item.dur * 0.6));
        var fadeStart = item.sceneEnd - fadeDur;
        if (t > fadeStart) alpha *= 1 - easeInOutSine(c01((t - fadeStart) / fadeDur));
      }

      if (dimAmount > 0 && item.id !== dimKeep && !item.dimOthers) {
        alpha *= 1 - 0.62 * dimAmount;
      }

      // Motion: the element's centre follows its path, and it is already sitting on
      // the path's first point before the move starts, so nothing ever jumps.
      var travel = item.motion ? motionAt(item.motion, t) : null;
      var moving = travel && !item.trailAt;

      var extra = pulse && pulse[item.id] ? pulse[item.id] : 1;
      var total = scale * extra;
      var tr = '';
      if (moving && (travel[0] !== 0 || travel[1] !== 0)) {
        tr += 'translate(' + f(travel[0]) + ',' + f(travel[1]) + ') ';
      }
      if (item.sweep && p < 1) {
        // Swings into place: full offset at the start of the entry, none by the end.
        var swing = item.sweep.deg * (1 - easeOutCubic(p));
        tr += 'rotate(' + f(swing) + ',' + f(item.sweep.cx) + ',' + f(item.sweep.cy) + ') ';
      }
      if (total !== 1) {
        tr +=
          'translate(' +
          f(item.center[0]) +
          ',' +
          f(item.center[1]) +
          ') scale(' +
          f(total) +
          ') translate(' +
          f(-item.center[0]) +
          ',' +
          f(-item.center[1]) +
          ')';
      }
      rec.g.setAttribute('opacity', f(alpha));
      rec.g.setAttribute('transform', tr === '' ? 'translate(0,0)' : tr.trim());

      var parts = rec.parts;
      var active = null;
      var activeLocal = 0;
      if (item.trailAt) {
        // A trail is not drawn on the item's own clock: each bead appears as the
        // moving element reaches it, so the route always matches where the thing is.
        var u = travel ? travel[2] : 0;
        var win = rec.uStep || 0.05;
        for (var tq = 0; tq < parts.length; tq++) {
          var bead = parts[tq];
          applyPart(bead, 1, false);
          bead.el.setAttribute('opacity', f((bead.baseOpacity || 1) * c01((u - bead.uAt) / win)));
        }
      } else {
        for (var q = 0; q < parts.length; q++) {
          var part = parts[q];
          var lp =
            part.c1 > part.c0 ? c01((p - part.c0) / (part.c1 - part.c0)) : p >= part.c1 ? 1 : 0;
          applyPart(part, lp, reveal);
          if (reveal && p >= part.c0 && p < part.c1 && p > 0) {
            active = part;
            activeLocal = lp;
          }
        }
      }
      if (active && !item.noPen && alpha > 0.05 && (!penItem || item.start >= penItem.start)) {
        penItem = item;
        penPart = active;
        penLocal = activeLocal;
        penShift = moving ? travel : null;
      }
    }

    // Pass 3: the pen rides whatever is being drawn right now, and lifts when
    // nothing is.
    var placed = false;
    if (penPart && penItem) {
      var pt = penPoint(penPart, penLocal);
      if (pt) {
        var a = pt.angle;
        while (a > 90) a -= 180;
        while (a < -90) a += 180;
        var deg = plan.pen.baseAngle + a * plan.pen.follow;
        var k = (Math.min(plan.frame.w, plan.frame.h) * 0.16) / (plan.pen.unit * pxPerUnit);
        // `penPoint` reads the ink in the item's own coordinates; if the item is
        // being carried along a motion path, the nib has to travel with it.
        var px0 = pt.x + (penShift ? penShift[0] : 0);
        var py0 = pt.y + (penShift ? penShift[1] : 0);
        penG.setAttribute(
          'transform',
          'translate(' + f(px0) + ',' + f(py0) + ') rotate(' + f(deg) + ') scale(' + f(k) + ')',
        );
        var edgeFade = Math.min(t - penItem.start, penItem.start + penItem.dur - t) / PEN_FADE;
        penG.setAttribute('opacity', f(c01(edgeFade)));
        placed = true;
      }
    }
    if (!placed) {
      penG.setAttribute('opacity', '0');
      penG.setAttribute('transform', 'translate(0,0)');
    }
    return t;
  }

  /* ---------------------------------------------------------------- exports */

  window.seek = seek;
  window.inkcast = {
    plan: plan,
    duration: plan.duration,
    fps: plan.fps,
    seek: seek,
    /** Serialised visual state — the determinism test compares two of these. */
    snapshot: function () {
      return board.outerHTML;
    },
  };
  window.__INKCAST_READY__ = false;

  window.inkcastReady = (function () {
    var fontProbe =
      document.fonts && document.fonts.load
        ? document.fonts.load('64px InkcastHand').catch(function () {
            return null;
          })
        : Promise.resolve(null);
    return fontProbe
      .then(function () {
        return document.fonts && document.fonts.ready ? document.fonts.ready : null;
      })
      .then(function () {
        layoutAll();
        seek(0);
        window.__INKCAST_READY__ = true;
        return true;
      });
  })();
})();
