// Content script — runs on order-detail pages of supported sites.
// Detects which site + extracts order info, sends to background → Astroledger.
//
// Strategy: per-site selectors. Selectors break when sites redesign; the
// extension fails gracefully (no captured order) rather than uploading garbage.

(function () {
  const host = location.hostname;
  let order = null;

  try {
    if (/amazon\.com$/.test(host) || /amazon\.com$/.test(host.split('.').slice(-2).join('.'))) {
      order = extractAmazon();
    } else if (/doordash\.com$/.test(host)) {
      order = extractDoorDash();
    } else if (/ubereats\.com$/.test(host)) {
      order = extractUberEats();
    } else if (/instacart\.com$/.test(host)) {
      order = extractInstacart();
    } else if (/etsy\.com$/.test(host)) {
      order = extractEtsy();
    }
  } catch (e) {
    console.warn('[Astroledger] extraction error:', e);
  }

  if (!order) return;
  order.url = location.href;
  chrome.runtime.sendMessage({ type: 'astroledger:capture', order }, (reply) => {
    if (reply?.ok) console.info('[Astroledger] captured order', order);
    else console.warn('[Astroledger] capture failed:', reply);
  });
})();

function parseMoney(s) {
  if (!s) return null;
  const m = String(s).match(/\$\s?([0-9]+(?:[,][0-9]{3})*(?:\.[0-9]{2}))/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, ''));
}

function extractAmazon() {
  const orderIdMatch = location.search.match(/orderID=([0-9-]+)/) ||
                       document.body.innerText.match(/Order #\s*([0-9-]{10,})/);
  const orderId = orderIdMatch ? orderIdMatch[1] : null;
  // Order total: look for the order summary section
  const totalEl = [...document.querySelectorAll('*')].find(el =>
    /Grand Total|Order Total/i.test(el.textContent || '') && el.querySelector('.a-color-price'));
  const total = totalEl ? parseMoney(totalEl.querySelector('.a-color-price')?.textContent || '') : null;
  // Date
  const dateMatch = document.body.innerText.match(/Order placed\s*([A-Z][a-z]+ \d{1,2},? \d{4})/);
  const orderDate = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
  // Items
  const itemEls = document.querySelectorAll('.yohtmlc-item, .a-fixed-left-grid-inner');
  const items = [...itemEls].slice(0, 20).map(el => {
    const name = el.querySelector('a, .a-link-normal')?.textContent?.trim();
    return name ? { name: name.slice(0, 200) } : null;
  }).filter(Boolean);

  if (!total || !orderId) return null;
  return { source: 'extension:amazon', externalId: orderId, merchant: 'Amazon', amount: total, orderDate, items };
}

function extractDoorDash() {
  const total = parseMoney(document.body.innerText.match(/Total[\s\S]{0,40}?\$\d/)?.[0]);
  const merchantEl = document.querySelector('h1');
  const merchant = merchantEl ? `DoorDash: ${merchantEl.textContent?.trim()}` : 'DoorDash';
  if (!total) return null;
  return { source: 'extension:doordash', merchant, amount: total, orderDate: new Date().toISOString() };
}

function extractUberEats() {
  const total = parseMoney(document.body.innerText.match(/Total[\s\S]{0,40}?\$\d/)?.[0]);
  if (!total) return null;
  return { source: 'extension:ubereats', merchant: 'Uber Eats', amount: total, orderDate: new Date().toISOString() };
}

function extractInstacart() {
  const total = parseMoney(document.body.innerText.match(/Total[\s\S]{0,40}?\$\d/)?.[0]);
  if (!total) return null;
  return { source: 'extension:instacart', merchant: 'Instacart', amount: total, orderDate: new Date().toISOString() };
}

function extractEtsy() {
  const total = parseMoney(document.body.innerText.match(/Total[\s\S]{0,40}?\$\d/)?.[0]);
  if (!total) return null;
  return { source: 'extension:etsy', merchant: 'Etsy', amount: total, orderDate: new Date().toISOString() };
}
