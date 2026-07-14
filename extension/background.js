// Astroledger extension service worker. Receives captured orders from content scripts,
// posts them to the user's local Astroledger instance.

const DEFAULT_ENDPOINT = 'http://localhost:5050/api/orders/ingest';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'astroledger:capture') {
    (async () => {
      const { astroledgerEndpoint } = await chrome.storage.sync.get({ astroledgerEndpoint: DEFAULT_ENDPOINT });
      try {
        const res = await fetch(astroledgerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(msg.order),
        });
        const ok = res.ok;
        const body = await res.text();
        sendResponse({ ok, status: res.status, body: body.slice(0, 200) });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async response
  }
});
