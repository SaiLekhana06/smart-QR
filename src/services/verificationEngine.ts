import {
  VerificationResult,
  ProductRecord
} from '../types';
import { parseQrPayload } from './qrParser';
import { localDb } from './db';

export const MAX_BATCH_ATTEMPTS = 3;

export type QrCheckStageResult =
  | {
      stage: 'NEEDS_BATCH';
      productId: string;
      rawQrPayload: string;
    }
  | {
      stage: 'INVALID_QR' | 'UNREGISTERED' | 'AMBIGUOUS_RECORD';
      result: VerificationResult;
    };

export interface BatchVerificationAttemptResult {
  matched: boolean;
  result?: VerificationResult;
}

/**
 * Normalization policies:
 * - Trims leading/trailing whitespace on all fields.
 * - Product Name & Manufacturer: Case-insensitive comparison.
 * - Product ID & Batch Number: Exact case-sensitive match after trimming.
 */
export function normalizeForComparison(
  val: string,
  field: 'productName' | 'productId' | 'manufacturer' | 'batchNumber'
): string {
  const trimmed = (val || '').trim();
  if (field === 'productName' || field === 'manufacturer') {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Step 1 of QR verification:
 * Parses the QR payload (which contains ONLY the Product ID) and checks whether
 * the Product ID exists in the local registered product database.
 * Never exposes product details in the returned object.
 */
export async function checkQrProductId(rawQrPayload: string): Promise<QrCheckStageResult> {
  const timestamp = new Date().toISOString();
  const id = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const parseResult = parseQrPayload(rawQrPayload);

  if (!parseResult.success || !parseResult.productId) {
    return {
      stage: 'INVALID_QR',
      result: {
        id,
        timestamp,
        status: 'INVALID_QR',
        title: 'INVALID QR CODE',
        message: parseResult.error || 'The scanned QR code is invalid or does not contain a Product ID.',
        scanned: {
          rawText: rawQrPayload
        },
        registeredRecord: null,
        fieldComparisons: [],
        mismatchedFields: parseResult.missingFields,
        parseErrors: parseResult.missingFields.map((f) => `Missing mandatory field: ${f}`)
      }
    };
  }

  const productId = parseResult.productId.trim();
  const allProducts = await localDb.getAllProducts();
  const matchedRecords = allProducts.filter(
    (p) => p.productId.trim() === productId
  );

  if (matchedRecords.length > 1) {
    return {
      stage: 'AMBIGUOUS_RECORD',
      result: {
        id,
        timestamp,
        status: 'AMBIGUOUS_RECORD',
        title: 'DATABASE CONFLICT / AMBIGUOUS RECORD',
        message: `Database integrity conflict: ${matchedRecords.length} conflicting registered records exist for this Product ID.`,
        scanned: {
          productId,
          rawText: rawQrPayload
        },
        registeredRecord: null,
        fieldComparisons: [],
        mismatchedFields: ['Multiple conflicting records in database'],
        parseErrors: ['Conflicting database records detected for the same Product ID.']
      }
    };
  }

  if (matchedRecords.length === 0) {
    return {
      stage: 'UNREGISTERED',
      result: {
        id,
        timestamp,
        status: 'UNREGISTERED',
        title: 'This product is not developed by us',
        message: 'The scanned Product ID does not match any product in our registered products.',
        scanned: {
          productId,
          rawText: rawQrPayload
        },
        registeredRecord: null,
        fieldComparisons: [],
        mismatchedFields: ['Product ID (Unregistered)']
      }
    };
  }

  return {
    stage: 'NEEDS_BATCH',
    productId,
    rawQrPayload
  };
}

/**
 * Step 2 of QR verification:
 * Verifies the user-entered Batch Number against the registered record for the scanned Product ID.
 * Grants up to MAX_BATCH_ATTEMPTS (3) chances before classifying as FAKE.
 * Never returns complete product details.
 */
export async function verifyBatchNumberForProduct(
  rawQrPayload: string,
  productId: string,
  enteredBatch: string,
  attemptNumber: number
): Promise<BatchVerificationAttemptResult> {
  const timestamp = new Date().toISOString();
  const id = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const registered = await localDb.getProductById(productId.trim());
  if (!registered) {
    return {
      matched: false,
      result: {
        id,
        timestamp,
        status: 'UNREGISTERED',
        title: 'This product is not developed by us',
        message: 'The scanned Product ID does not match any product in our registered products.',
        scanned: {
          productId: productId.trim(),
          rawText: rawQrPayload
        },
        registeredRecord: null,
        fieldComparisons: [],
        mismatchedFields: ['Product ID (Unregistered)']
      }
    };
  }

  const normalizedEntered = normalizeForComparison(enteredBatch, 'batchNumber');
  const normalizedRegistered = normalizeForComparison(registered.batchNumber, 'batchNumber');

  if (normalizedEntered && normalizedEntered === normalizedRegistered) {
    return {
      matched: true,
      result: {
        id,
        timestamp,
        status: 'GENUINE',
        title: 'GENUINE PRODUCT',
        message: 'Product ID and Batch Number match our authorized records.',
        scanned: {
          productId: productId.trim(),
          rawText: rawQrPayload
        },
        registeredRecord: null,
        fieldComparisons: [],
        mismatchedFields: [],
        attemptsUsed: attemptNumber
      }
    };
  }

  if (attemptNumber < MAX_BATCH_ATTEMPTS) {
    return { matched: false };
  }

  return {
    matched: false,
    result: {
      id,
      timestamp,
      status: 'FAKE_MISMATCH',
      title: 'FAKE PRODUCT',
      message: 'Batch number verification failed after 3 attempts. This product is FAKE.',
      scanned: {
        productId: productId.trim(),
        rawText: rawQrPayload
      },
      registeredRecord: null,
      fieldComparisons: [],
      mismatchedFields: ['Batch Number'],
      attemptsUsed: attemptNumber
    }
  };
}

/**
 * Pure verification function for unit tests (does not depend on IndexedDB)
 */
export function verifyAgainstList(
  rawQrPayload: string,
  databaseRecords: ProductRecord[],
  enteredBatch: string = ''
): VerificationResult {
  const timestamp = new Date().toISOString();
  const id = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const parseResult = parseQrPayload(rawQrPayload);

  if (!parseResult.success || !parseResult.productId) {
    return {
      id,
      timestamp,
      status: 'INVALID_QR',
      title: 'INVALID QR CODE',
      message: parseResult.error || 'Malformed payload',
      scanned: { rawText: rawQrPayload },
      registeredRecord: null,
      fieldComparisons: [],
      mismatchedFields: parseResult.missingFields,
      parseErrors: parseResult.missingFields
    };
  }

  const productId = parseResult.productId.trim();
  const matches = databaseRecords.filter((p) => p.productId.trim() === productId);

  if (matches.length > 1) {
    return {
      id,
      timestamp,
      status: 'AMBIGUOUS_RECORD',
      title: 'DATABASE ERROR',
      message: 'Multiple records found for ID',
      scanned: { productId, rawText: rawQrPayload },
      registeredRecord: null,
      fieldComparisons: [],
      mismatchedFields: ['Multiple conflicting records in database']
    };
  }

  if (matches.length === 0) {
    return {
      id,
      timestamp,
      status: 'UNREGISTERED',
      title: 'This product is not developed by us',
      message: 'Product ID not in registered products',
      scanned: { productId, rawText: rawQrPayload },
      registeredRecord: null,
      fieldComparisons: [],
      mismatchedFields: ['Product ID (Unregistered)']
    };
  }

  const registered = matches[0];
  const batchMatched =
    normalizeForComparison(enteredBatch, 'batchNumber') !== '' &&
    normalizeForComparison(enteredBatch, 'batchNumber') ===
      normalizeForComparison(registered.batchNumber, 'batchNumber');

  if (batchMatched) {
    return {
      id,
      timestamp,
      status: 'GENUINE',
      title: 'GENUINE PRODUCT',
      message: 'Product ID and Batch Number match',
      scanned: { productId, rawText: rawQrPayload },
      registeredRecord: null,
      fieldComparisons: [],
      mismatchedFields: []
    };
  }

  return {
    id,
    timestamp,
    status: 'FAKE_MISMATCH',
    title: 'FAKE PRODUCT',
    message: 'Batch Number mismatch',
    scanned: { productId, rawText: rawQrPayload },
    registeredRecord: null,
    fieldComparisons: [],
    mismatchedFields: ['Batch Number']
  };
}
