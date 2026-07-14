const DEFAULT_ENDPOINT = 'http://localhost:5050/api/orders/ingest';
const endpointInput = document.getElementById('endpoint');
const msgEl = document.getElementById('msg');

chrome.storage.sync.get({ astroledgerEndpoint: DEFAULT_ENDPOINT }, ({ astroledgerEndpoint }) => {
  endpointInput.value = astroledgerEndpoint;
});

document.getElementById('save').addEventListener('click', () => {
  const v = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  chrome.storage.sync.set({ astroledgerEndpoint: v }, () => {
    msgEl.textContent = 'Saved.'; msgEl.className = 'msg ok';
    setTimeout(() => { msgEl.textContent = ''; }, 1500);
  });
});
