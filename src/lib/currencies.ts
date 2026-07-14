// Client-safe currency constants. Kept in its own module so client
// components can import the list without pulling in the server-side fx
// helpers (and prisma along with them).

export const BASE_CURRENCY = 'USD';

export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR', 'BRL', 'KRW',
];
