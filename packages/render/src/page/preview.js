/*
 * Preview-only clock. Loaded *after* runtime.js and never loaded during capture.
 *
 * It is the only place in the render page allowed to touch a clock. It calls the
 * exact same `window.seek(t)` the capture path drives, so what the studio shows
 * is what the mp4 will contain — there is no second animation implementation to
 * drift out of sync.
 */
/* global window, document, requestAnimationFrame, performance */
(function () {
  'use strict';

  var api = window.inkcast;
  if (!api) return;
  var duration = api.duration;
  var playing = false;
  var t = 0;
  var last = 0;
  var audio = document.getElementById('inkcast-audio');
  var hasAudio = false;

  if (audio) {
    audio.addEventListener('canplay', function () {
      hasAudio = true;
    });
    audio.addEventListener('error', function () {
      hasAudio = false;
    });
  }

  var bar = document.createElement('div');
  bar.className = 'ic-bar';
  bar.innerHTML =
    '<button class="ic-btn" id="ic-play" aria-label="Play"></button>' +
    '<div class="ic-track" id="ic-track"><div class="ic-fill" id="ic-fill"></div>' +
    '<div class="ic-ticks" id="ic-ticks"></div></div>' +
    '<div class="ic-time" id="ic-time">0:00 / 0:00</div>';
  document.body.appendChild(bar);

  var playBtn = document.getElementById('ic-play');
  var track = document.getElementById('ic-track');
  var fill = document.getElementById('ic-fill');
  var timeEl = document.getElementById('ic-time');
  var ticks = document.getElementById('ic-ticks');

  var scenes = api.plan.scenes;
  for (var i = 1; i < scenes.length; i++) {
    var tick = document.createElement('i');
    tick.style.left = (scenes[i].start / duration) * 100 + '%';
    tick.title = scenes[i].id;
    ticks.appendChild(tick);
  }

  function fmt(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function paint() {
    api.seek(t);
    fill.style.width = (t / duration) * 100 + '%';
    timeEl.textContent = fmt(t) + ' / ' + fmt(duration);
    playBtn.className = 'ic-btn' + (playing ? ' is-playing' : '');
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function tick() {
    if (!playing) return;
    var now = performance.now();
    var dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    t += dt;
    if (hasAudio && audio && !audio.paused) {
      // The rAF clock stays authoritative; audio is nudged back when it drifts.
      if (Math.abs(audio.currentTime - t) > 0.25) audio.currentTime = t;
    }
    if (t >= duration) {
      t = duration;
      pause();
    }
    paint();
    requestAnimationFrame(tick);
  }

  function play() {
    if (t >= duration) t = 0;
    playing = true;
    last = performance.now();
    if (hasAudio && audio) {
      audio.currentTime = t;
      var pr = audio.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    paint();
    requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    if (audio && !audio.paused) audio.pause();
    paint();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function seekTo(next) {
    t = Math.max(0, Math.min(duration, next));
    if (hasAudio && audio) audio.currentTime = t;
    paint();
  }

  playBtn.addEventListener('click', toggle);

  function fromEvent(e) {
    var r = track.getBoundingClientRect();
    var x = (e.clientX - r.left) / Math.max(1, r.width);
    seekTo(x * duration);
  }
  var scrubbing = false;
  track.addEventListener('pointerdown', function (e) {
    scrubbing = true;
    track.setPointerCapture(e.pointerId);
    fromEvent(e);
  });
  track.addEventListener('pointermove', function (e) {
    if (scrubbing) fromEvent(e);
  });
  track.addEventListener('pointerup', function (e) {
    scrubbing = false;
    try {
      track.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* capture may already be gone */
    }
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowRight') {
      seekTo(t + 5);
    } else if (e.key === 'ArrowLeft') {
      seekTo(t - 5);
    } else if (e.key === 'Home') {
      seekTo(0);
    } else if (e.key === 'End') {
      seekTo(duration);
    }
  });

  /** Lets the studio drive the preview from outside the iframe. */
  window.inkcastPreview = {
    play: play,
    pause: pause,
    toggle: toggle,
    seek: seekTo,
    time: function () {
      return t;
    },
    playing: function () {
      return playing;
    },
  };

  window.inkcastReady.then(function () {
    paint();
  });
})();
