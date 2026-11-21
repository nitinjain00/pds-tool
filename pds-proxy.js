/**
 * Netlify Function: pds-proxy
 * Pre-wired for UP SmartPDS (smartpds.up.gov.in) FPS Wise Transactions:
 *   GET  https://smartpds.up.gov.in/Epos_Spring/captcha/captcha-image?t=...
 *   POST https://smartpds.up.gov.in/Epos_Spring/fps/fpstransactionwitoutcatptcha
 */

const DEFAULT_SUBMIT_URL = 'https://smartpds.up.gov.in/Epos_Spring/fps/fpstransactionwitoutcatptcha';
const CAPTCHA_URL_CANDIDATES = [
  'https://smartpds.up.gov.in/Epos_Spring/captcha/captcha-image'
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

function monthToNumber(monthStr) {
  const idx = MONTHS.findIndex((m) => m.toLowerCase() === String(monthStr || '').toLowerCase());
  return idx >= 0 ? String(idx + 1) : String(parseInt(monthStr, 10) || 1);
}

function extractCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  }
  const single = headers.get('set-cookie');
  if (!single) return '';
  return single.split(/,(?=\s*[^;]+=[^;]+)/).map((c) => c.split(';')[0].trim()).join('; ');
}

function encodeToken(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function decodeToken(token) {
  if (!token) return {};
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractRowsFromJson(parsed) {
  let list = [];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const candidates = [
      parsed.data, parsed.rows, parsed.transactions, parsed.result,
      parsed.fpsTransactions, parsed.transactionList, parsed.list
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) {
        list = c;
        break;
      }
    }
    if (!list.length) {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
          list = parsed[key];
          break;
        }
      }
    }
  }

  if (list.length > 0 && typeof list[0] === 'object' && !Array.isArray(list[0])) {
    const headers = Object.keys(list[0]);
    return [headers].concat(list.map((r) => headers.map((h) => (r[h] === null || r[h] === undefined ? '' : r[h]))));
  }
  return Array.isArray(list) ? list : [];
}

exports.handler = async function handler(event) {
  const action = (event.queryStringParameters && event.queryStringParameters.action) || '';
  const submitUrl = process.env.SMARTPDS_SUBMIT_URL || DEFAULT_SUBMIT_URL;

  const baseHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Referer': 'https://smartpds.up.gov.in/FPS_Trans_Int',
    'Origin': 'https://smartpds.up.gov.in'
  };

  if (action === 'captcha') {
    const ts = Date.now();
    const urlsToTry = process.env.SMARTPDS_CAPTCHA_URL
      ? [process.env.SMARTPDS_CAPTCHA_URL]
      : CAPTCHA_URL_CANDIDATES.map((u) => u + '?t=' + ts);

    let lastErr = 'Unable to load SmartPDS Captcha.';
    for (const url of urlsToTry) {
      try {
        const resp = await fetchWithTimeout(url, { method: 'GET', headers: baseHeaders }, 8500);
        if (!resp.ok) {
          lastErr = 'Captcha endpoint returned HTTP ' + resp.status;
          continue;
        }
        const cookies = extractCookies(resp.headers);
        const ct = (resp.headers.get('content-type') || '').toLowerCase();

        if (ct.includes('application/json')) {
          const data = await resp.json();
          const imgRaw = data.image || data.captchaImage || data.captcha || data.img || data.base64 || '';
          const salt = data.salt || data.saltKey || data.captchaSalt || data.uuid || data.key || data.captchaId || data.id || data.token || '';
          const captchaImage = imgRaw.startsWith('data:')
            ? imgRaw
            : (imgRaw ? 'data:image/png;base64,' + imgRaw : '');
          if (!captchaImage) {
            lastErr = 'Captcha JSON did not include image data.';
            continue;
          }
          return jsonResponse(200, {
            captchaImage,
            sessionToken: encodeToken({ cookies, salt })
          });
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        const mime = ct.split(';')[0] || 'image/png';
        const headerSalt =
          resp.headers.get('x-captcha-salt') ||
          resp.headers.get('x-salt') ||
          resp.headers.get('salt') ||
          resp.headers.get('captcha-salt') || '';
        return jsonResponse(200, {
          captchaImage: 'data:' + mime + ';base64,' + buf.toString('base64'),
          sessionToken: encodeToken({ cookies, salt: headerSalt })
        });
      } catch (err) {
        lastErr = err.name === 'AbortError'
          ? 'SmartPDS Captcha timed out (>8.5s).'
          : err.message;
      }
    }

    return jsonResponse(502, { error: lastErr });
  }

  if (action === 'fetch' && event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'Invalid JSON request body.' });
    }

    const session = decodeToken(body.sessionToken);
    const payload = {
      fps_id: String(body.shopId || '').trim(),
      month: monthToNumber(body.month),
      year: String(body.year || '').trim(),
      captcha: String(body.captcha || '').trim(),
      salt: session.salt || ''
    };

    const reqHeaders = {
      ...baseHeaders,
      'Content-Type': 'application/json'
    };
    if (session.cookies) {
      reqHeaders['Cookie'] = session.cookies;
    }

    try {
      const resp = await fetchWithTimeout(submitUrl, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload)
      }, 8500);

      const respText = await resp.text();
      if (!resp.ok) {
        return jsonResponse(502, {
          error: 'SmartPDS returned HTTP ' + resp.status,
          details: respText.slice(0, 300)
        });
      }

      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json') || respText.trim().startsWith('[') || respText.trim().startsWith('{')) {
        const parsed = JSON.parse(respText);
        const rows = extractRowsFromJson(parsed);
        return jsonResponse(200, {
          rows,
          message: (parsed && parsed.message) || (rows.length ? '' : 'No transactions found or invalid Captcha.')
        });
      }

      return jsonResponse(200, { html: respText });
    } catch (err) {
      if (err.name === 'AbortError') {
        return jsonResponse(504, {
          error: 'SmartPDS took longer than 8.5s to respond (Netlify 10s timeout). Please retry or use Paste Table.'
        });
      }
      return jsonResponse(502, { error: 'SmartPDS request failed: ' + err.message });
    }
  }

  return jsonResponse(400, { error: 'Unsupported action. Use ?action=captcha or POST ?action=fetch.' });
};
