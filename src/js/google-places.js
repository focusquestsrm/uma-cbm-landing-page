(function () {
  'use strict';

  const input = document.getElementById('lead_address_address_visible');
  if (!input) return;

  const stateKey = '__umaGooglePlacesState';
  const state = window[stateKey] || {
    autocomplete: null,
    input: null,
    listener: null,
    scriptRequested: false
  };
  window[stateKey] = state;

  function dispatch(name, detail) {
    if (typeof document.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function publishValue(field, value) {
    if (!field) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setValue(id, value) {
    const field = document.getElementById(id);
    if (!field || !value) return false;
    publishValue(field, value);
    return true;
  }

  function componentValue(components, type, shortName) {
    const component = components.find(function (entry) { return entry.types && entry.types.includes(type); });
    return component ? (shortName ? component.short_name : component.long_name) : '';
  }

  function cityValue(components) {
    return componentValue(components, 'locality', false) ||
      componentValue(components, 'postal_town', false) ||
      componentValue(components, 'sublocality_level_1', false) ||
      componentValue(components, 'administrative_area_level_2', false);
  }

  function closeSuggestions() {
    if (document.body && document.body.classList) document.body.classList.add('uma-places-selection-complete');
    if (typeof input.blur === 'function') input.blur();
  }

  function focusMissing(id) {
    const field = document.getElementById(id);
    if (field && typeof field.focus === 'function') field.focus();
  }

  function handlePlaceChanged(autocomplete) {
    try {
      const place = autocomplete.getPlace();
      const components = place && Array.isArray(place.address_components) ? place.address_components : [];
      if (components.length === 0) {
        closeSuggestions();
        publishValue(input, input.value);
        dispatch('uma:address-incomplete', { missing: ['lead_address_address_visible'] });
        focusMissing('lead_address_address_visible');
        return;
      }

      const streetNumber = componentValue(components, 'street_number', false);
      const route = componentValue(components, 'route', false);
      const street = streetNumber && route ? streetNumber + ' ' + route : '';
      const city = cityValue(components);
      const region = componentValue(components, 'administrative_area_level_1', true);
      const zip = componentValue(components, 'postal_code', false);
      const missing = [];

      if (street) {
        setValue('lead_address_address_visible', street);
        setValue('lead_address_address', street);
      } else {
        publishValue(input, input.value);
        setValue('lead_address_address', String(input.value || '').trim());
        missing.push('lead_address_address_visible');
      }
      if (!setValue('lead_address_city', city)) missing.push('lead_address_city');
      if (!setValue('lead_address_state', region)) missing.push('lead_address_state');
      if (!setValue('lead_address_zip', zip)) missing.push('lead_address_zip');

      closeSuggestions();
      dispatch('uma:address-populated', { missing: missing.slice() });
      if (missing.length) focusMissing(missing[0]);
    } catch (error) {
      closeSuggestions();
      publishValue(input, input.value);
      dispatch('uma:address-unavailable');
      focusMissing('lead_address_address_visible');
    }
  }

  function initializePlaces() {
    if (!window.google || !google.maps || !google.maps.places || !google.maps.places.Autocomplete) return null;
    if (state.autocomplete && state.input === input) return state.autocomplete;

    if (state.listener && typeof state.listener.remove === 'function') state.listener.remove();
    state.listener = null;
    state.autocomplete = null;
    state.input = input;

    try {
      state.autocomplete = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'us' },
        fields: ['address_components'],
        types: ['address']
      });
      state.listener = state.autocomplete.addListener('place_changed', function () {
        handlePlaceChanged(state.autocomplete);
      });
      return state.autocomplete;
    } catch (error) {
      state.autocomplete = null;
      dispatch('uma:address-unavailable');
      return null;
    }
  }

  input.addEventListener('input', function () {
    if (document.body && document.body.classList) document.body.classList.remove('uma-places-selection-complete');
  });
  window.UMA_GOOGLE_PLACES = { initializePlaces, componentValue, cityValue, handlePlaceChanged };
  const key = String(window.UMA_RUNTIME_CONFIG && window.UMA_RUNTIME_CONFIG.googleMapsBrowserKey || '').trim();
  if (!key) return;

  if (window.google && google.maps && google.maps.places && google.maps.places.Autocomplete) {
    initializePlaces();
    return;
  }
  if (state.scriptRequested) return;
  state.scriptRequested = true;

  const callbackName = '__umaGooglePlacesReady';
  window[callbackName] = initializePlaces;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.dataset.umaGooglePlaces = 'true';
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&callback=' + callbackName + '&loading=async&v=weekly';
  script.addEventListener('error', function () {
    state.scriptRequested = false;
    dispatch('uma:address-unavailable');
    delete window[callbackName];
  });
  document.head.appendChild(script);
})();
