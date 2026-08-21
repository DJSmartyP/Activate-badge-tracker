(() => {
  'use strict';

  const LEVELS_LIST_ID = 'levelsList';
  const openRooms = new Set();
  const openGames = new Set();
  let enhancing = false;
  let controls = null;

  function text(el) {
    return (el?.textContent || '').trim();
  }

  function roomMeta(roomGames) {
    const cards = [...roomGames.querySelectorAll(':scope > .room-game-card')];
    const chips = [...roomGames.querySelectorAll('.level-chip')];
    const completed = chips.filter(chip => chip.classList.contains('level-chip-done')).length;
    const played = cards.filter(card => card.classList.contains('played-card')).length;

    if (chips.length) return `${completed}/${chips.length} visible levels complete · ${cards.length} games`;
    return `${played}/${cards.length} games played`;
  }


  function fullAllLevelsAccordionMode() {
    const view = document.getElementById('levelsView');
    const room = document.getElementById('levelsRoom');
    const game = document.getElementById('levelsGame');
    const levelsTab = document.querySelector('[data-levels-mode="levels"].active');
    return !!levelsTab && view?.value === 'all' && !room?.value && !game?.value;
  }

  function flatHighScoreMode() {
    const view = document.getElementById('levelsView');
    const levelsTab = document.querySelector('[data-levels-mode="levels"].active');
    return !!levelsTab && view?.value === 'highscore';
  }

  function ensureAccordionControls() {
    const list = document.getElementById(LEVELS_LIST_ID);
    if (!list) return null;

    if (!controls || !controls.isConnected) {
      controls = document.createElement('div');
      controls.className = 'levels-accordion-controls';
      controls.setAttribute('aria-label', 'Accordion controls');
      controls.innerHTML = `
        <button type="button" class="btn ghost levels-accordion-control" data-levels-expand-all>Expand all</button>
        <button type="button" class="btn ghost levels-accordion-control" data-levels-collapse-all>Collapse all</button>`;
      list.before(controls);

      controls.querySelector('[data-levels-expand-all]')?.addEventListener('click', () => {
        const rooms = [...list.querySelectorAll('details[data-levels-accordion="room"]')];
        const games = [...list.querySelectorAll('details[data-levels-accordion="game"]')];
        rooms.forEach(details => {
          const room = details.dataset.room || '';
          if (room) openRooms.add(room);
          details.open = true;
        });
        games.forEach(details => {
          const room = details.dataset.room || '';
          const game = details.dataset.game || '';
          if (room && game) openGames.add(gameKey(room, game));
          details.open = true;
        });
      });

      controls.querySelector('[data-levels-collapse-all]')?.addEventListener('click', () => {
        openRooms.clear();
        openGames.clear();
        list.querySelectorAll('details[data-levels-accordion]').forEach(details => {
          details.open = false;
        });
      });
    }

    // Bulk controls are useful in every accordion-based Levels view.
    // Venue High Scores is deliberately flat, so it is the sole exception.
    controls.hidden = flatHighScoreMode();
    return controls;
  }

  function highScoreValue(chip) {
    const textValue = text(chip.querySelector('.level-chip-main > span'));
    const scoreMatch = textValue.match(/Score\s+([0-9,]+)/i);
    const venueMatch = textValue.match(/Venue high\s+([0-9,]+)/i);
    return venueMatch?.[1] || scoreMatch?.[1] || '—';
  }

  function renderFlatHighScores(list) {
    const sections = [...list.querySelectorAll(':scope > .room-section')];
    if (!sections.length) return false;

    const rows = [];
    sections.forEach(section => {
      const room = text(section.querySelector(':scope > .room-title-row h3')) || 'Room';
      section.querySelectorAll(':scope > .room-games > .room-game-card.coop-game').forEach(card => {
        const game = text(card.querySelector(':scope > .room-game-head strong')) || 'Game';
        card.querySelectorAll('.level-chip.high-score-level').forEach(chip => {
          const level = text(chip.querySelector('.level-chip-title-row strong')) || 'Level';
          rows.push({ room, game, level, score: highScoreValue(chip) });
        });
      });
    });

    if (!rows.length) return false;

    list.innerHTML = `<div class="levels-highscore-flat" aria-label="Venue high scores">${rows.map(row => `
      <article class="levels-highscore-row level-chip high-score-level">
        <div class="levels-highscore-copy">
          <strong class="levels-highscore-game">${escapeHtml(row.game)}</strong>
          <span class="levels-highscore-meta">${escapeHtml(row.room)} · ${escapeHtml(row.level)}</span>
        </div>
        <div class="levels-highscore-score">
          <strong>${escapeHtml(row.score)}</strong>
          <span>Venue high</span>
        </div>
      </article>`).join('')}</div>`;
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[ch]));
  }

  function gameKey(room, game) {
    return `${room}||${game}`;
  }

  function enhanceGameCard(card, room, selectedGame) {
    const levelGrid = card.querySelector(':scope > .level-grid');
    const head = card.querySelector(':scope > .room-game-head');
    if (!levelGrid || !head || card.matches('details')) return card;

    const game = text(head.querySelector('strong')) || 'Game';
    const details = document.createElement('details');
    details.className = `${card.className} levels-game-accordion`;
    details.dataset.levelsAccordion = 'game';
    details.dataset.room = room;
    details.dataset.game = game;

    const summary = document.createElement('summary');
    summary.className = 'levels-game-summary';
    summary.appendChild(head);
    details.append(summary, levelGrid);

    if (openGames.has(gameKey(room, game)) || (selectedGame && selectedGame === game)) {
      details.open = true;
    }

    card.replaceWith(details);
    return details;
  }

  function enhanceRoomSection(section, selectedRoom, selectedGame) {
    const title = section.querySelector(':scope > .room-title-row h3');
    const roomGames = section.querySelector(':scope > .room-games');
    if (!title || !roomGames) return;

    const room = text(title) || 'Room';
    const details = document.createElement('details');
    details.className = `${section.className} levels-room-accordion`;
    details.dataset.levelsAccordion = 'room';
    details.dataset.room = room;

    const summary = document.createElement('summary');
    summary.className = 'levels-room-summary';

    const copy = document.createElement('span');
    copy.className = 'levels-room-copy';

    const kicker = document.createElement('span');
    kicker.className = 'levels-room-kicker';
    kicker.textContent = 'Room';

    const name = document.createElement('strong');
    name.className = 'levels-room-name';
    name.textContent = room;

    const meta = document.createElement('span');
    meta.className = 'levels-room-meta';
    meta.textContent = roomMeta(roomGames);

    copy.append(kicker, name);
    summary.append(copy, meta);
    details.append(summary, roomGames);

    if (openRooms.has(room) || (selectedRoom && selectedRoom === room)) {
      details.open = true;
    }

    section.replaceWith(details);

    [...roomGames.querySelectorAll(':scope > .room-game-card.coop-game')]
      .forEach(card => enhanceGameCard(card, room, selectedGame));
  }

  function enhanceLevels() {
    const list = document.getElementById(LEVELS_LIST_ID);
    if (!list || enhancing) return;

    ensureAccordionControls();

    // Venue-high-score mode is the one deliberate flat-list exception.
    if (flatHighScoreMode() && renderFlatHighScores(list)) return;

    // The default All rooms + All levels screen must always use the full
    // Room > Game > Level accordion hierarchy. This explicit check prevents
    // later filter/list styling from accidentally flattening the default view.
    const forceFullAccordion = fullAllLevelsAccordionMode();

    const sections = [...list.querySelectorAll(':scope > .room-section:not([data-levels-accordion])')];
    if (!sections.length) return;

    enhancing = true;
    try {
      list.classList.toggle('levels-full-accordion-view', forceFullAccordion);
      const selectedRoom = document.getElementById('levelsRoom')?.value || '';
      const selectedGame = document.getElementById('levelsGame')?.value || '';
      sections.forEach(section => enhanceRoomSection(section, selectedRoom, selectedGame));
    } finally {
      enhancing = false;
    }
  }

  function rememberToggle(event) {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (details.dataset.levelsAccordion === 'room') {
      const room = details.dataset.room || '';
      if (!room) return;
      if (details.open) openRooms.add(room);
      else openRooms.delete(room);
      return;
    }
    if (details.dataset.levelsAccordion === 'game') {
      const room = details.dataset.room || '';
      const game = details.dataset.game || '';
      const key = gameKey(room, game);
      if (!room || !game) return;
      if (details.open) openGames.add(key);
      else openGames.delete(key);
    }
  }

  function start() {
    const list = document.getElementById(LEVELS_LIST_ID);
    if (!list) return;

    document.addEventListener('toggle', rememberToggle, true);

    const observer = new MutationObserver(() => {
      if (!enhancing) queueMicrotask(enhanceLevels);
    });
    observer.observe(list, { childList: true, subtree: false });

    enhanceLevels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
