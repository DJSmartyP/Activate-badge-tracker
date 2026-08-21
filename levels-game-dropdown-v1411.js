(() => {
  'use strict';

  let internalUpdate = false;

  function option(text, value = '', disabled = false) {
    const el = document.createElement('option');
    el.textContent = text;
    el.value = value;
    el.disabled = disabled;
    return el;
  }

  function uniqueSorted(list) {
    return [...new Set((list || []).map(v => String(v || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }

  function groupedGamesForRoom(room, availableGames) {
    const allow = new Set((availableGames || []).map(v => String(v || '').trim()).filter(Boolean));
    let cooperative = [];
    let competitive = [];

    try {
      if (typeof progressEntries === 'function') {
        const entries = progressEntries().filter(entry => entry && entry.room === room);
        entries.forEach(entry => {
          const game = String(entry.game || '').trim();
          if (!game || !allow.has(game)) return;
          if (entry.mode === 'competitive') competitive.push(game);
          else cooperative.push(game);
        });
      }
    } catch (_) {}

    if (!cooperative.length && !competitive.length) {
      try {
        if (typeof roomGameEntries === 'function') {
          const entries = roomGameEntries(room) || [];
          entries.forEach(entry => {
            const game = String(entry.game || '').trim();
            if (!game || !allow.has(game)) return;
            if (entry.mode === 'competitive') competitive.push(game);
            else cooperative.push(game);
          });
        }
      } catch (_) {}
    }

    cooperative = uniqueSorted(cooperative);
    competitive = uniqueSorted(competitive);

    const assigned = new Set([...cooperative, ...competitive]);
    const leftovers = uniqueSorted([...allow].filter(game => !assigned.has(game)));

    if (!cooperative.length && !competitive.length) {
      cooperative = leftovers;
    } else if (leftovers.length) {
      cooperative = uniqueSorted([...cooperative, ...leftovers]);
    }

    return { cooperative, competitive };
  }

  function regroupGameDropdown() {
    if (internalUpdate) return;

    const roomSel = document.getElementById('levelsRoom');
    const gameSel = document.getElementById('levelsGame');
    if (!roomSel || !gameSel) return;

    const selectedRoom = roomSel.value || '';
    if (!selectedRoom || gameSel.disabled) return;

    const currentValue = gameSel.value || '';
    const currentGames = [...gameSel.options]
      .filter(opt => !opt.disabled && opt.value)
      .map(opt => opt.value);

    if (!currentGames.length) return;

    const { cooperative, competitive } = groupedGamesForRoom(selectedRoom, currentGames);
    if (!cooperative.length && !competitive.length) return;

    internalUpdate = true;
    try {
      gameSel.innerHTML = '';
      gameSel.appendChild(option('All games', ''));

      if (cooperative.length) {
        gameSel.appendChild(option('-- CO-OP --', '__sep_coop__', true));
        cooperative.forEach(game => gameSel.appendChild(option(game, game)));
      }

      if (competitive.length) {
        gameSel.appendChild(option('-- COMPETITIVE --', '__sep_comp__', true));
        competitive.forEach(game => gameSel.appendChild(option(game, game)));
      }

      if ([...gameSel.options].some(opt => opt.value === currentValue && !opt.disabled)) {
        gameSel.value = currentValue;
      } else {
        gameSel.value = '';
      }
    } finally {
      internalUpdate = false;
    }
  }

  function start() {
    const roomSel = document.getElementById('levelsRoom');
    const gameSel = document.getElementById('levelsGame');
    if (!roomSel || !gameSel) return;

    const observer = new MutationObserver(() => {
      if (!internalUpdate) queueMicrotask(regroupGameDropdown);
    });
    observer.observe(gameSel, { childList: true, subtree: true });

    roomSel.addEventListener('change', () => setTimeout(regroupGameDropdown, 0));
    gameSel.addEventListener('change', () => setTimeout(regroupGameDropdown, 0));
    document.getElementById('levelsView')?.addEventListener('change', () => setTimeout(regroupGameDropdown, 0));
    document.getElementById('gamesView')?.addEventListener('change', () => setTimeout(regroupGameDropdown, 0));
    document.querySelectorAll('[data-levels-mode]').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(regroupGameDropdown, 0));
    });

    setTimeout(regroupGameDropdown, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
