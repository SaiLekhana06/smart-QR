import { ParseResult } from '../types';

/**
 * Parses QR text payload containing only the Product ID.
 * Supports:
 * 1. Plain Product ID string: "SB001"
 * 2. Key-Value format: "ID: SB001" or "Product ID: SB001"
 * 3. JSON format: '{"productId": "SB001"}' or '{"id": "SB001"}'
 */
export function parseQrPayload(rawInput: string): ParseResult {
  const rawText = (rawInput || '').trim();

  if (!rawText) {
    return {
      success: false,
      missingFields: ['Product ID'],
      rawText,
      error: 'Empty QR code payload.'
    };
  }

  // 1. Try parsing JSON format if payload begins with '{'
  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawText);
      const productId = String(parsed.productId || parsed.id || '').trim();

      if (productId) {
        return {
          success: true,
          productId,
          missingFields: [],
          rawText
        };
      }
      return {
        success: false,
        missingFields: ['Product ID'],
        rawText,
        error: 'Missing required field: Product ID'
      };
    } catch {
      return {
        success: false,
        missingFields: ['Product ID'],
        rawText,
        error: 'Malformed JSON QR payload.'
      };
    }
  }

  // 2. Key-Value format (e.g. "ID: SB001" or "Product ID: SB001")
  if (rawText.includes(':')) {
    const delimiter = rawText.includes(';') ? ';' : rawText.includes('\n') ? '\n' : ',';
    const tokens = rawText.split(delimiter);

    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (!key || !value) continue;

      if (key === 'id' || key === 'product id' || key === 'productid') {
        return {
          success: true,
          productId: value,
          missingFields: [],
          rawText
        };
      }
    }

    return {
      success: false,
      missingFields: ['Product ID'],
      rawText,
      error: 'Missing required field: Product ID'
    };
  }

  // 3. Plain single-token Product ID string (e.g. "SB001", "PRD-102")
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(rawText)) {
    return {
      success: true,
      productId: rawText,
      missingFields: [],
      rawText
    };
  }

  return {
    success: false,
    missingFields: ['Product ID'],
    rawText,
    error: 'Invalid QR code format. Expected a valid Product ID.'
  };
}

/**
 * Formats a ProductRecord into the Product-ID-only QR payload
 */
export function formatEsp32Payload(product: { productId: string } | string): string {
  if (typeof product === 'string') {
    return product.trim();
  }
  return product.productId.trim();
}
