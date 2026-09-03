(function () {
  'use strict';

  const form = document.getElementById('leadform');
  if (!form) return;

  const endpoint = '/.netlify/functions/submit-lead';
  let submissionInProgress = false;
  let submissionHandled = false;
  let submissionId = '';
  const pendingStorageKey = 'umaLeadSubmissionState';
  const pendingRetentionMs = 24 * 60 * 60 * 1000;
  const genericError = 'We’re unable to process your request at this time. Please try again shortly.';
  const ambiguousError = 'Your request is being processed. Please do not submit it again.';

  if (!form.dataset) form.dataset = {};
  if (form.dataset.submissionHandlerBound === 'true') return;
  form.dataset.submissionHandlerBound = 'true';

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      return 'uma-' + Array.from(values, function (value) { return value.toString(16).padStart(8, '0'); }).join('');
    }
    return 'uma-' + Date.now() + '-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }

  function persistSubmissionState(state) {
    try {
      sessionStorage.setItem(pendingStorageKey, JSON.stringify({
        submissionId,
        state,
        expiresAt: Date.now() + pendingRetentionMs
      }));
    } catch (error) {}
  }

  function clearSubmissionState() {
    try { sessionStorage.removeItem(pendingStorageKey); } catch (error) {}
  }

  function restoreSubmissionState() {
    let stored;
    try { stored = JSON.parse(sessionStorage.getItem(pendingStorageKey) || 'null'); } catch (error) { stored = null; }
    if (!stored || !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(String(stored.submissionId || '')) ||
        !Number.isFinite(stored.expiresAt) || stored.expiresAt <= Date.now()) {
      clearSubmissionState();
      return;
    }
    submissionId = stored.submissionId;
    const submissionField = document.getElementById('submission_id');
    if (submissionField) submissionField.value = submissionId;
    if (stored.state !== 'pending') return;
    submissionInProgress = true;
    submissionHandled = true;
    const button = document.getElementById('submitButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'Processing...';
    }
    displayStatus(ambiguousError, 'error');
  }

  function setError(elementId, message) {
    const target = document.getElementById(elementId);
    if (!target) return;
    target.textContent = message || '';
    target.classList.toggle('is-error', Boolean(message));
  }

  function displayStatus(message, type) {
    const status = document.getElementById('status-message');
    if (!status) return;
    status.textContent = message;
    status.className = 'status-message' + (type === 'error' ? ' is-error' : '');
  }

  function captureAttribution() {
    const params = new URLSearchParams(window.location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'campaign_id'].forEach(function (key) {
      const field = document.getElementById(key);
      const value = params.get(key);
      if (field && value) field.value = value.slice(0, 250);
    });
    const clickId = params.get('fbclid');
    const clickField = document.getElementById('subid4');
    let storedClickId = clickId;
    try {
      storedClickId = clickId || sessionStorage.getItem('fbclid') || localStorage.getItem('fbclid');
      if (clickId) {
        sessionStorage.setItem('fbclid', clickId.slice(0, 250));
        localStorage.setItem('fbclid', clickId.slice(0, 250));
      }
    } catch (error) {
      storedClickId = clickId;
    }
    const cookieValue = function (name) {
      const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : '';
    };
    let fbc = cookieValue('_fbc');
    let fbp = cookieValue('_fbp');
    try {
      fbc = fbc || sessionStorage.getItem('fbc') || localStorage.getItem('fbc');
      fbp = fbp || sessionStorage.getItem('fbp') || localStorage.getItem('fbp');
    } catch (error) {
      fbc = fbc || '';
      fbp = fbp || '';
    }
    if (!fbc && storedClickId) {
      fbc = 'fb.1.' + Date.now() + '.' + storedClickId;
      document.cookie = '_fbc=' + encodeURIComponent(fbc) + '; path=/; max-age=7776000; SameSite=Lax';
    }
    const fbcField = document.getElementById('subid2');
    const fbpField = document.getElementById('subid3');
    if (fbcField && fbc) fbcField.value = fbc.slice(0, 500);
    if (fbpField && fbp) fbpField.value = fbp.slice(0, 500);
    if (clickField && storedClickId) clickField.value = storedClickId.slice(0, 500);
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
  }

  async function hydrateProgramSelection() {
    const select = document.getElementById('lead_education_program_id');
    if (!select) return false;
    select.disabled = true;
    try {
      const programs = await window.UMA_PROGRAM_AVAILABILITY.loadPrograms();
      window.UMA_PROGRAM_AVAILABILITY.populateSelect(select, programs);
      const cardList = document.getElementById('program-card-list');
      if (cardList) {
        window.UMA_PROGRAM_AVAILABILITY.renderCards(cardList, programs);
        cardList.querySelectorAll('[data-program-id]').forEach(function (link) {
          link.addEventListener('click', function (event) {
            event.preventDefault();
            const programId = String(link.dataset.programId || '');
            if (!programs.some(function (program) { return program.program_id === programId; })) return;
            select.value = programId;
            sessionStorage.setItem('umaProgramId', programId);
            updateStep(1);
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            select.focus({ preventScroll: true });
          });
        });
      }
      const storedProgram = sessionStorage.getItem('umaProgramId');
      if (storedProgram && programs.some(function (program) { return program.program_id === storedProgram; })) {
        select.value = storedProgram;
      } else {
        sessionStorage.removeItem('umaProgramId');
      }
      select.addEventListener('change', function () {
        if (select.value) sessionStorage.setItem('umaProgramId', select.value);
      });
      return true;
    } catch (error) {
      setError('step1-error', 'We’re unable to load program options at this time. Please try again shortly.');
      const nextButton = form.querySelector('[data-next-step="2"]');
      const loadError = document.getElementById('program-load-error');
      if (loadError) loadError.textContent = 'Program options are currently unavailable. Please try again shortly.';
      if (nextButton) nextButton.disabled = true;
      return false;
    }
  }

  function validateStepOne() {
    const field = document.getElementById('lead_education_program_id');
    if (field && field.value) {
      setError('step1-error', '');
      return true;
    }
    setError('step1-error', 'Please select a program before continuing.');
    if (field) field.focus();
    return false;
  }

  function validateStepTwo() {
    const checks = [
      ['lead_education_grad_year', 'Please select your graduation year.', 'grad-year-error'],
      ['lead_education_education_level_id', 'Please select your highest level of education.', 'education-error'],
      ['lead_address_address_visible', 'Please enter your street address.', 'addressValidationMessage'],
      ['lead_address_city', 'Please enter your city.', null],
      ['lead_address_state', 'Please select your state.', null],
      ['lead_address_zip', 'Please enter a valid 5-digit ZIP code.', null]
    ];
    for (const check of checks) {
      const field = document.getElementById(check[0]);
      const value = field ? String(field.value || '').trim() : '';
      const valid = check[0] === 'lead_education_grad_year' ?
        Boolean(window.UMA_GRADUATION_YEARS && window.UMA_GRADUATION_YEARS.isValid(value)) :
        value && (check[0] !== 'lead_address_zip' || /^\d{5}$/.test(value));
      if (!valid) {
        if (check[2]) setError(check[2], check[1]);
        if (field) field.focus();
        return false;
      }
      if (check[2]) setError(check[2], '');
    }
    return true;
  }

  function validateStepThree() {
    const checks = [
      ['lead_firstname', 'Please enter your first name.', 'first-name-error', function (value) { return value.length >= 2; }],
      ['lead_lastname', 'Please enter your last name.', 'last-name-error', function (value) { return value.length >= 2; }],
      ['lead_email', 'Please enter a valid email address.', 'email-error', function (value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }],
      ['lead_phone1', 'Please enter a valid 10-digit phone number.', 'phone-error', function (value) { return /^\d{10}$/.test(value.replace(/\D/g, '')); }]
    ];
    for (const check of checks) {
      const field = document.getElementById(check[0]);
      const value = field ? String(field.value || '').trim() : '';
      if (!check[3](value)) {
        setError(check[2], check[1]);
        if (field) field.focus();
        return false;
      }
      setError(check[2], '');
    }
    return true;
  }

  function updateStep(stepNumber) {
    Array.from(form.querySelectorAll('.form-step[data-step]')).forEach(function (step) {
      const visible = Number(step.dataset.step) === Number(stepNumber);
      step.classList.toggle('is-visible', visible);
      step.classList.toggle('hidden', !visible);
    });
    displayStatus('', '');
  }

  function setAddressValue() {
    const visible = document.getElementById('lead_address_address_visible');
    const hidden = document.getElementById('lead_address_address');
    if (!visible || !hidden) return;
    visible.addEventListener('input', function () { hidden.value = visible.value; });
  }

  function wireNavigation() {
    form.querySelectorAll('[data-next-step]').forEach(function (button) {
      button.addEventListener('click', function () {
        const current = Number(form.querySelector('.form-step.is-visible').dataset.step);
        const valid = current === 1 ? validateStepOne() : validateStepTwo();
        if (!valid) return;
        updateStep(Number(button.dataset.nextStep));
        const nextField = form.querySelector('.form-step.is-visible input, .form-step.is-visible select');
        if (nextField) nextField.focus();
      });
    });
    form.querySelectorAll('[data-back-step]').forEach(function (button) {
      button.addEventListener('click', function () { updateStep(Number(button.dataset.backStep)); });
    });
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    const visibleStep = form.querySelector('.form-step.is-visible');
    const addressInput = document.getElementById('lead_address_address_visible');
    if (visibleStep && visibleStep.dataset.step === '2' && document.activeElement === addressInput) return;
    if (submissionInProgress || submissionHandled) return;
    if (!validateStepTwo()) {
      updateStep(2);
      return;
    }
    if (!validateStepThree()) return;
    submissionInProgress = true;
    const button = document.getElementById('submitButton');
    const submissionField = document.getElementById('submission_id');
    if (!submissionId) submissionId = createSubmissionId();
    if (submissionField) submissionField.value = submissionId;
    persistSubmissionState('pending');
    button.disabled = true;
    button.textContent = 'Submitting...';
    displayStatus('', '');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(new FormData(form)).toString(),
        credentials: 'same-origin',
        redirect: 'error'
      });
      const result = await response.json();
      if (response.ok && (result.outcome === 'accepted' || result.outcome === 'failed') && result.location) {
        submissionHandled = true;
        clearSubmissionState();
        const eventId = String(document.getElementById('meta_event_id').value || '');
        form.reset();
        sessionStorage.removeItem('umaProgramId');
        updateStep(4);
        if (result.outcome === 'accepted') {
          window.dispatchEvent(new CustomEvent('uma:lead-accepted', { detail: { eventId } }));
          if (window.UMA_META) window.UMA_META.fireLead(eventId);
        }
        window.setTimeout(function () { window.location.assign(result.location); }, 3000);
        return;
      }
      if (result.retryable === true) {
        submissionInProgress = false;
        persistSubmissionState('retryable');
        displayStatus(genericError, 'error');
        button.disabled = false;
        button.textContent = 'Request Info';
        return;
      }
      submissionHandled = true;
      button.disabled = true;
      button.textContent = 'Processing...';
      displayStatus(ambiguousError, 'error');
      persistSubmissionState('pending');
    } catch (error) {
      submissionHandled = true;
      button.disabled = true;
      button.textContent = 'Processing...';
      displayStatus(ambiguousError, 'error');
      persistSubmissionState('pending');
    }
  });

  async function initialize() {
    const phone = document.getElementById('lead_phone1');
    if (phone) phone.addEventListener('input', function () { phone.value = phone.value.replace(/\D/g, '').slice(0, 10); });
    const eventField = document.getElementById('meta_event_id');
    if (eventField && !eventField.value) {
      eventField.value = window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() :
        'uma-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }
    captureAttribution();
    setAddressValue();
    wireNavigation();
    updateStep(1);
    restoreSubmissionState();
    await hydrateProgramSelection();
  }

  initialize();
})();
