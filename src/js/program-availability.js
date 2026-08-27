(function () {
  'use strict';

  const dataUrl = '/.netlify/functions/get-program-availability';
  const iconById = {
    '227753': '🖥️',
    '227755': '🗃️',
    '227756': '👥',
    '227754': '📄'
  };
  let cachedPrograms = null;

  function validatePrograms(value) {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Program configuration is unavailable.');
    const ids = new Set();
    const orders = new Set();
    value.forEach(function (program) {
      if (!program || !/^\d+$/.test(String(program.program_id || ''))) throw new Error('Program configuration contains an invalid ID.');
      if (!String(program.program_name || '').trim()) throw new Error('Program configuration contains a blank name.');
      if (typeof program.active !== 'boolean') throw new Error('Program configuration contains an invalid active value.');
      if (!Number.isInteger(program.display_order) || program.display_order < 1) throw new Error('Program configuration contains an invalid display order.');
      if (ids.has(String(program.program_id))) throw new Error('Program configuration contains a duplicate ID.');
      if (orders.has(program.display_order)) throw new Error('Program configuration contains a duplicate display order.');
      ids.add(String(program.program_id));
      orders.add(program.display_order);
    });
    const active = value.filter(function (program) { return program.active; }).sort(function (left, right) {
      return left.display_order - right.display_order;
    });
    if (active.length === 0) throw new Error('No program options are available.');
    return active;
  }

  async function loadPrograms() {
    if (cachedPrograms) return cachedPrograms.slice();
    const response = await fetch(dataUrl, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Program configuration could not be loaded.');
    const result = await response.json();
    cachedPrograms = validatePrograms(result && result.programs);
    return cachedPrograms.slice();
  }

  function populateSelect(select, programs) {
    if (!select) return;
    select.replaceChildren(new Option('Please Select', '', true, false));
    select.options[0].disabled = true;
    programs.forEach(function (program) {
      select.add(new Option(program.program_name, program.program_id));
    });
    select.disabled = false;
  }

  function renderCards(container, programs) {
    if (!container) return;
    container.replaceChildren();
    programs.forEach(function (program) {
      const column = document.createElement('div');
      column.className = 'col-md-6 col-lg-4';
      const card = document.createElement('div');
      card.className = 'program-card';
      const icon = document.createElement('div');
      icon.className = 'program-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconById[program.program_id] || '🎓';
      const heading = document.createElement('h3');
      heading.className = 'program-title';
      heading.textContent = program.program_name;
      const link = document.createElement('a');
      link.href = '#leadform';
      link.dataset.programId = program.program_id;
      link.className = 'btn btn-primary';
      link.textContent = 'Get More Info';
      card.append(icon, heading, link);
      column.appendChild(card);
      container.appendChild(column);
    });
  }

  window.UMA_PROGRAM_AVAILABILITY = { loadPrograms, populateSelect, renderCards, validatePrograms };
})();
