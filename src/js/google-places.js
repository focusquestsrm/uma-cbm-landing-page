(function () {
  'use strict';

  const input = document.getElementById('lead_address_address_visible');
  if (!input) return;

  function setValue(id, value) {
    const field = document.getElementById(id);
    if (!field || !value) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function componentValue(components, type, shortName) {
    const component = components.find(function (entry) { return entry.types && entry.types.includes(type); });
    return component ? (shortName ? component.short_name : component.long_name) : '';
  }

  function initializePlaces() {
    if (!window.google || !google.maps || !google.maps.places || !google.maps.places.Autocomplete) return;
    const autocomplete = new google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: 'us' },
      fields: ['address_components'],
      types: ['address']
    });
    autocomplete.addListener('place_changed', function () {
      const place = autocomplete.getPlace();
      const components = place && Array.isArray(place.address_components) ? place.address_components : [];
      if (components.length === 0) return;
      const streetNumber = componentValue(components, 'street_number', false);
      const route = componentValue(components, 'route', false);
      const street = [streetNumber, route].filter(Boolean).join(' ');
      const city = componentValue(components, 'locality', false) || componentValue(components, 'sublocality_level_1', false);
      const state = componentValue(components, 'administrative_area_level_1', true);
      const zip = componentValue(components, 'postal_code', false);
      setValue('lead_address_address_visible', street);
      setValue('lead_address_address', street);
      setValue('lead_address_city', city);
      setValue('lead_address_state', state);
      setValue('lead_address_zip', zip);
    });
  }

  window.UMA_GOOGLE_PLACES = { initializePlaces, componentValue };
  const key = String(window.UMA_RUNTIME_CONFIG && window.UMA_RUNTIME_CONFIG.googleMapsBrowserKey || '').trim();
  if (!key) return;
  const callbackName = '__umaGooglePlacesReady';
  window[callbackName] = initializePlaces;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&callback=' + callbackName + '&loading=async&v=weekly';
  script.addEventListener('error', function () {
    delete window[callbackName];
  });
  document.head.appendChild(script);
})();
