// Same handoff as the first prototype, plus a sponsored frame on the way in.
// The frame is a 2 second still. It arms 1 second before the video
// reaches the top of the article, so that second of scrolling is the frame.
// The story film starts when the two seconds are up and the player is in view.
// The ad is the portrait Louis Vuitton film.

const cfg = {
  lightsOut: 700,
  holdBlack: 80,
  lightsIn: 650,
  breakAt: 8,
  cueLead: 5,
  adDuration: 15,
  skipAfter: 5,
  frameDuration: 2,
  frameLead: 1,
};

const $ = (id) => document.getElementById(id);

const player = $("player");
const scroller = $("scroller");
const editorial = $("editorial");
const ad = $("ad");
const blackout = $("blackout");
const ui = {
  cueCount: $("cueCount"),
  adTimer: $("adTimer"),
  skip: $("skipBtn"),
  progressFill: $("progressFill"),
  progressKnob: $("progressKnob"),
  readout: $("readout"),
  playBtn: $("playBtn"),
};

let segment = "editorial";
let playing = true;
let transitioning = false;
let adPlayed = false;
let resumeAt = 0;
let generation = 0;

const frame = {
  status: "waiting", // waiting | showing | done
  accum: 0,
  tick: 0,
};

const scrollWatch = {
  top: 0,
  ts: 0,
  velocity: 0, // px per ms, positive while scrolling down
};

function setState(next) {
  player.dataset.state = next;
}

function setSegment(next) {
  segment = next;
  player.dataset.segment = next;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fadeBlack(opacity, ms) {
  return new Promise((resolve) => {
    if (ms <= 0) {
      blackout.style.transition = "none";
      blackout.style.opacity = String(opacity);
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      blackout.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.propertyName === "opacity") finish();
    };
    blackout.addEventListener("transitionend", onEnd);
    blackout.style.transition = `opacity ${ms}ms ${opacity === 1 ? "ease-in" : "ease-out"}`;
    requestAnimationFrame(() => {
      blackout.style.opacity = String(opacity);
    });
    setTimeout(finish, ms + 80);
  });
}

function fmt(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `0:${String(s).padStart(2, "0")}`;
}

function adElapsed() {
  return Math.max(0, ad.currentTime || 0);
}

function adLimit() {
  const available = Number.isFinite(ad.duration) ? ad.duration : cfg.adDuration;
  return Math.min(cfg.adDuration, available || cfg.adDuration);
}

function videoMetrics() {
  const view = scroller.getBoundingClientRect();
  const rect = player.getBoundingClientRect();
  const visible = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
  return {
    // Positive while the player is still below the screen.
    gap: rect.top - view.bottom,
    visible: Math.max(0, visible),
    height: rect.height,
  };
}

function liveVelocity(now) {
  if (!scrollWatch.ts || now - scrollWatch.ts > 90) return 0;
  return scrollWatch.velocity;
}

function frameElapsed(now) {
  if (frame.status !== "showing" || !playing) return frame.accum;
  return frame.accum + (now - frame.tick);
}

function armFrame(now) {
  if (frame.status !== "waiting") return;
  frame.status = "showing";
  frame.accum = 0;
  frame.tick = now;
  setState("frame");
  editorial.pause();
  try { editorial.currentTime = 0; } catch (err) { /* not seekable yet */ }
}

function finishFrame() {
  if (frame.status === "done") return;
  frame.status = "done";
  setSegment("editorial");
  setState("editorial");
  if (playing) editorial.play().catch(() => {});
}

function releaseFrame() {
  if (frame.status === "done") return;
  frame.status = "done";
  setSegment("editorial");
  setState("editorial");
}

function updateFrame(now) {
  if (frame.status === "done" || transitioning) return;

  const { gap, visible, height } = videoMetrics();

  if (frame.status === "waiting") {
    const velocity = liveVelocity(now);
    const leadMs = cfg.frameLead * 1000;
    const approaching = velocity > 0.08 && gap > 0 && (leadMs === 0 || gap / velocity <= leadMs);
    const arrived = gap <= 12 && visible > 0;
    if (approaching || arrived) armFrame(now);
    return;
  }

  const elapsed = frameElapsed(now);
  const inView = visible > height * 0.35;
  if (playing && elapsed >= cfg.frameDuration * 1000 && inView) finishFrame();
}

async function goTo(next) {
  if (transitioning || next === segment) return;
  const gen = ++generation;
  transitioning = true;
  setState("lights-out");

  await fadeBlack(1, cfg.lightsOut);
  if (gen !== generation) return;
  if (cfg.holdBlack > 0) await wait(cfg.holdBlack);
  if (gen !== generation) return;

  if (next === "ad") {
    resumeAt = editorial.currentTime || cfg.breakAt;
    editorial.pause();
    ad.currentTime = 0;
    setSegment("ad");
    if (playing) ad.play().catch(() => {});
  } else {
    ad.pause();
    adPlayed = true;
    setSegment("editorial");
    const resume = Math.min(resumeAt, (editorial.duration || resumeAt) - 0.05);
    editorial.currentTime = Math.max(0, resume);
    if (playing) editorial.play().catch(() => {});
  }

  setState("lights-in");
  await fadeBlack(0, cfg.lightsIn);
  if (gen !== generation) return;

  setState(segment === "ad" ? "ad" : "editorial");
  transitioning = false;
}

function onEditorialTime() {
  if (transitioning || !playing || segment !== "editorial" || frame.status !== "done") return;
  const t = editorial.currentTime || 0;
  if (!adPlayed && t >= cfg.breakAt) {
    goTo("ad");
    return;
  }
  const cueAt = cfg.breakAt - cfg.cueLead;
  if (!adPlayed && t >= cueAt) setState("cue");
  else if (player.dataset.state === "cue") setState("editorial");
}

function onAdTime() {
  if (transitioning || !playing || segment !== "ad") return;
  if (adElapsed() >= adLimit()) goTo("editorial");
}

function render() {
  const now = performance.now();
  updateFrame(now);

  const cueLeft = Math.max(1, Math.ceil(cfg.breakAt - (editorial.currentTime || 0)));
  ui.cueCount.textContent = cueLeft;
  ui.adTimer.textContent = fmt(adLimit() - adElapsed());

  const skipReady = segment === "ad" && adElapsed() >= cfg.skipAfter;
  ui.skip.classList.toggle("ready", skipReady);
  ui.skip.textContent = skipReady
    ? "Skip ad"
    : `Skip ad in ${Math.max(1, Math.ceil(cfg.skipAfter - adElapsed()))}`;

  let progress = 0;
  if (segment === "ad") {
    progress = adElapsed() / adLimit();
  } else if (frame.status === "showing") {
    progress = Math.min(1, frameElapsed(now) / (cfg.frameDuration * 1000));
  } else if (editorial.duration && frame.status === "done") {
    progress = editorial.currentTime / editorial.duration;
  }
  const progressPct = Math.min(100, progress * 100);
  ui.progressFill.style.width = `${progressPct}%`;
  ui.progressKnob.style.left = `clamp(0px, calc(${progressPct}% - 8px), calc(100% - 16px))`;

  const phase = transitioning ? player.dataset.state : player.dataset.state;
  const velocity = liveVelocity(now);
  const { gap } = videoMetrics();
  const frameLabel = frame.status === "showing"
    ? `showing ${(frameElapsed(now) / 1000).toFixed(1)} / ${cfg.frameDuration.toFixed(1)}s`
    : frame.status;
  ui.readout.textContent =
    `phase        ${phase}\n` +
    `segment      ${segment}\n` +
    `frame        ${frameLabel}\n` +
    `below fold   ${Math.round(gap)}px\n` +
    `scroll       ${Math.round(velocity * 1000)} px/s\n` +
    `editorial t  ${(editorial.currentTime || 0).toFixed(1)}s\n` +
    `ad t         ${adElapsed().toFixed(1)}s / ${adLimit().toFixed(0)}s\n` +
    `break at     ${cfg.breakAt}s (cue at ${(cfg.breakAt - cfg.cueLead).toFixed(0)}s)\n` +
    `lights out   ${cfg.lightsOut}ms\n` +
    `hold black   ${cfg.holdBlack}ms\n` +
    `lights in    ${cfg.lightsIn}ms`;

  requestAnimationFrame(render);
}

function setPlaying(next) {
  const now = performance.now();
  if (frame.status === "showing") {
    if (playing && !next) frame.accum += now - frame.tick;
    if (!playing && next) frame.tick = now;
  }
  playing = next;
  ui.playBtn.textContent = playing ? "Pause" : "Play";
  player.classList.toggle("is-paused", !playing && frame.status === "done");

  if (frame.status !== "done") {
    editorial.pause();
    ad.pause();
    return;
  }

  const current = segment === "ad" ? ad : editorial;
  if (playing) current.play().catch(() => {});
  else {
    editorial.pause();
    ad.pause();
  }
}

ui.playBtn.addEventListener("click", () => setPlaying(!playing));

player.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && button.id !== "playToggle") return;
  setPlaying(!playing);
});

scroller.addEventListener("scroll", () => {
  const now = performance.now();
  const top = scroller.scrollTop;
  const dt = now - scrollWatch.ts;
  if (scrollWatch.ts && dt > 0 && dt < 120) {
    const instant = (top - scrollWatch.top) / dt;
    scrollWatch.velocity = scrollWatch.velocity * 0.35 + instant * 0.65;
  } else {
    scrollWatch.velocity = 0;
  }
  scrollWatch.top = top;
  scrollWatch.ts = now;
}, { passive: true });

$("replayBtn").addEventListener("click", () => {
  generation += 1;
  transitioning = false;
  adPlayed = false;
  resumeAt = 0;
  frame.status = "waiting";
  frame.accum = 0;
  editorial.pause();
  ad.pause();
  editorial.currentTime = 0;
  ad.currentTime = 0;
  blackout.style.transition = "none";
  blackout.style.opacity = "0";
  scroller.scrollTop = 0;
  scrollWatch.top = 0;
  scrollWatch.ts = 0;
  scrollWatch.velocity = 0;
  setSegment("editorial");
  setState("waiting");
  setPlaying(true);
});

$("jumpBtn").addEventListener("click", () => {
  if (transitioning || segment === "ad") return;
  releaseFrame();
  const cueAt = Math.max(0, cfg.breakAt - cfg.cueLead);
  editorial.currentTime = cueAt;
  setState("cue");
  if (playing) editorial.play().catch(() => {});
});

$("triggerBtn").addEventListener("click", () => {
  if (segment === "ad" || transitioning) return;
  releaseFrame();
  goTo("ad");
});

ui.skip.addEventListener("click", () => {
  if (segment === "ad" && adElapsed() >= cfg.skipAfter) goTo("editorial");
});

const muteBtn = $("muteBtn");
muteBtn.addEventListener("click", () => {
  const muted = !editorial.muted;
  editorial.muted = muted;
  ad.muted = muted;
  muteBtn.classList.toggle("is-muted", muted);
  muteBtn.setAttribute("aria-pressed", String(muted));
  muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
});

$("expandBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else player.requestFullscreen().catch(() => {});
});

editorial.addEventListener("timeupdate", onEditorialTime);
ad.addEventListener("timeupdate", onAdTime);
ad.addEventListener("ended", () => {
  if (segment === "ad" && !transitioning) goTo("editorial");
});

const TUNABLES = [
  { id: "lightsOut", label: (v) => `${v} ms` },
  { id: "holdBlack", label: (v) => `${v} ms` },
  { id: "lightsIn", label: (v) => `${v} ms` },
  { id: "breakAt", label: (v) => `${v} s` },
  { id: "cueLead", label: (v) => `${v} s` },
  { id: "adDuration", label: (v) => `${v} s` },
  { id: "skipAfter", label: (v) => `${v} s` },
  { id: "frameDuration", label: (v) => `${v} s` },
  { id: "frameLead", label: (v) => `${v} s` },
];

for (const tunable of TUNABLES) {
  const input = $(`s-${tunable.id}`);
  const output = $(`o-${tunable.id}`);
  const apply = () => {
    cfg[tunable.id] = Number(input.value);
    output.textContent = tunable.label(cfg[tunable.id]);
  };
  input.addEventListener("input", apply);
  apply();
}

setSegment("editorial");
setState("waiting");
requestAnimationFrame(render);
