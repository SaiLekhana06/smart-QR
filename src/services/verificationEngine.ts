import {
  VerificationResult,
  FieldComparison,
  ProductRecord
} from '../types';
import { parseQrPayload } from './qrParser';
import { localDb } from './db';

/**
 * Normalization policies:
 * - Trims leading/trailing whitespace on all fields.
 * - Product Name: Case-insensitive comparison (e.g. "Smart Battery" == "smart battery").
 * - Product ID: Exact case-sensitive match (e.g. "SB001" !== "sb001" to preserve alphanumeric serial fidelity).
 * - Manufacturer: Case-insensitive comparison (e.g. "ABC Electronics" == "abc electronics").
 * - Batch Number: Exact case-sensitive match (e.g. "B001" !== "b001" for strict lot tracking).
 */
export function normalizeForComparison(val: string, field: 'productName' | 'productId' | 'manufacturer' | 'batchNumber'): string {
  const trimmed = (val || '').trim();
  if (field === 'productName' || field === 'manufacturer') {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Deterministic verification engine implementing Section 8:
 * Takes raw QR string payload (or parsed object) and validates against the local registered database.
 */
export async function verifyProductPayload(rawQrPayload: string): Promise<VerificationResult> {
  const timestamp = new Date().toISOString();
  const id = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Step 1: Parse the QR payload
  const parseResult = parseQrPayload(rawQrPayload);

  // CASE D: Malformed, missing, or unparseable QR
  if (!parseResult.success || !parseResult.product) {
    return {
      id,
      timestamp,
      status: 'INVALID_QR',
      title: 'INVALID QR CODE',
      message: parseResult.error || 'The scanned QR code is malformed or missing mandatory product parameters.',
      scanned: {
        rawText: rawQrPayload
      },
      fieldComparisons: [],
      mismatchedFields: parseResult.missingFields,
      parseErrors: parseResult.missingFields.map((f) => `Missing mandatory field: ${f}`)
    };
  }

  const scanned = parseResult.product;

  // Step 2: Query candidate records by Product ID
  const allProducts = await localDb.getAllProducts();
  const normalizedScannedId = scanned.productId.trim();

  // Find records matching the ID
  const matchedRecords = allProducts.filter(
    (p) => p.productId.trim() === normalizedScannedId
  );

  // CASE E: Database Error / Ambiguous Records (multiple products registered with identical ID)
  if (matchedRecords.length > 1) {
    return {
      id,
      timestamp,
      status: 'AMBIGUOUS_RECORD',
      title: 'DATABASE CONFLICT / AMBIGUOUS RECORD',
      message: `Database integrity conflict: ${matchedRecords.length} conflicting registered records exist with Product ID "${scanned.productId}".`,
      scanned: {
        ...scanned,
        rawText: rawQrPayload
      },
      fieldComparisons: [],
      mismatchedFields: ['Multiple conflicting records in database'],
      parseErrors: ['Conflicting database records detected for the same Product ID.']
    };
  }

  // CASE C: Product ID does not exist in local registered dataset
  if (matchedRecords.length === 0) {
    return {
      id,
      timestamp,
      status: 'UNREGISTERED',
      title: 'UNREGISTERED PRODUCT',
      message: `Product ID "${scanned.productId}" was not found in the local authorized product dataset.`,
      scanned: {
        ...scanned,
        rawText: rawQrPayload
      },
      registeredRecord: null,
      fieldComparisons: [
        {
          field: 'productId',
          label: 'Product ID',
          scannedValue: scanned.productId,
          registeredValue: 'Not Found in Registry',
          matched: false
        },
        {
          field: 'productName',
          label: 'Product Name',
          scannedValue: scanned.productName,
          registeredValue: '—',
          matched: false
        },
        {
          field: 'manufacturer',
          label: 'Manufacturer',
          scannedValue: scanned.manufacturer,
          registeredValue: '—',
          matched: false
        },
        {
          field: 'batchNumber',
          label: 'Batch Number',
          scannedValue: scanned.batchNumber,
          registeredValue: '—',
          matched: false
        }
      ],
      mismatchedFields: ['Product ID (Unregistered)']
    };
  }

  const registered = matchedRecords[0];

  // Step 3: Exact comparison of all 4 fields against the SAME single candidate record
  const comparisons: FieldComparison[] = [
    {
      field: 'productId',
      label: 'Product ID',
      scannedValue: scanned.productId,
      registeredValue: registered.productId,
      matched: normalizeForComparison(scanned.productId, 'productId') === normalizeForComparison(registered.productId, 'productId')
    },
    {
      field: 'productName',
      label: 'Product Name',
      scannedValue: scanned.productName,
      registeredValue: registered.productName,
      matched: normalizeForComparison(scanned.productName, 'productName') === normalizeForComparison(registered.productName, 'productName')
    },
    {
      field: 'manufacturer',
      label: 'Manufacturer',
      scannedValue: scanned.manufacturer,
      registeredValue: registered.manufacturer,
      matched: normalizeForComparison(scanned.manufacturer, 'manufacturer') === normalizeForComparison(registered.manufacturer, 'manufacturer')
    },
    {
      field: 'batchNumber',
      label: 'Batch Number',
      scannedValue: scanned.batchNumber,
      registeredValue: registered.batchNumber,
      matched: normalizeForComparison(scanned.batchNumber, 'batchNumber') === normalizeForComparison(registered.batchNumber, 'batchNumber')
    }
  ];

  const mismatched = comparisons.filter((c) => !c.matched).map((c) => c.label);

  // CASE A: All four fields match the same authorized record
  if (mismatched.length === 0) {
    return {
      id,
      timestamp,
      status: 'GENUINE',
      title: 'GENUINE PRODUCT',
      message: 'All 4 required parameters match the authorized local registry exactly.',
      scanned: {
        ...scanned,
        rawText: rawQrPayload
      },
      registeredRecord: registered,
      fieldComparisons: comparisons,
      mismatchedFields: []
    };
  }

  // CASE B: Product ID exists, but one or more fields differ -> FAKE / INVALID PRODUCT
  return {
    id,
    timestamp,
    status: 'FAKE_MISMATCH',
    title: 'FAKE / INVALID PRODUCT',
    message: `Tamper / counterfeit detected: ${mismatched.length} parameter(s) do not match authorized specifications for ID "${registered.productId}".`,
    scanned: {
      ...scanned,
      rawText: rawQrPayload
    },
    registeredRecord: registered,
    fieldComparisons: comparisons,
    mismatchedFields: mismatched
  };
}

/**
 * Pure verification function for unit tests (does not depend on IndexedDB)
 */
export function verifyAgainstList(rawQrPayload: string, databaseRecords: ProductRecord[]): VerificationResult {
  const timestamp = new Date().toISOString();
  const id = `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const parseResult = parseQrPayload(rawQrPayload);

  if (!parseResult.success || !parseResult.product) {
    return {
      id,
      timestamp,
      status: 'INVALID_QR',
      title: 'INVALID QR CODE',
      message: parseResult.error || 'Malformed payload',
      scanned: { rawText: rawQrPayload },
      fieldComparisons: [],
      mismatchedFields: parseResult.missingFields,
      parseErrors: parseResult.missingFields
    };
  }

  const scanned = parseResult.product;
  const matches = databaseRecords.filter((p) => p.productId.trim() === scanned.productId.trim());

  if (matches.length > 1) {
    return {
      id,
      timestamp,
      status: 'AMBIGUOUS_RECORD',
      title: 'DATABASE ERROR',
      message: 'Multiple records found for ID',
      scanned: { ...scanned, rawText: rawQrPayload },
      fieldComparisons: [],
      mismatchedFields: ['Multiple conflicting records in database']
    };
  }

  if (matches.length === 0) {
    return {
      id,
      timestamp,
      status: 'UNREGISTERED',
      title: 'UNREGISTERED PRODUCT',
      message: 'Product ID not in database',
      scanned: { ...scanned, rawText: rawQrPayload },
      fieldComparisons: [],
      mismatchedFields: ['Product ID (Unregistered)']
    };
  }

  const registered = matches[0];
  const comparisons: FieldComparison[] = [
    {
      field: 'productId',
      label: 'Product ID',
      scannedValue: scanned.productId,
      registeredValue: registered.productId,
      matched: normalizeForComparison(scanned.productId, 'productId') === normalizeForComparison(registered.productId, 'productId')
    },
    {
      field: 'productName',
      label: 'Product Name',
      scannedValue: scanned.productName,
      registeredValue: registered.productName,
      matched: normalizeForComparison(scanned.productName, 'productName') === normalizeForComparison(registered.productName, 'productName')
    },
    {
      field: 'manufacturer',
      label: 'Manufacturer',
      scannedValue: scanned.manufacturer,
      registeredValue: registered.manufacturer,
      matched: normalizeForComparison(scanned.manufacturer, 'manufacturer') === normalizeForComparison(registered.manufacturer, 'manufacturer')
    },
    {
      field: 'batchNumber',
      label: 'Batch Number',
      scannedValue: scanned.batchNumber,
      registeredValue: registered.batchNumber,
      matched: normalizeForComparison(scanned.batchNumber, 'batchNumber') === normalizeForComparison(registered.batchNumber, 'batchNumber')
    }
  ];

  const mismatched = comparisons.filter((c) => !c.matched).map((c) => c.label);

  if (mismatched.length === 0) {
    return {
      id,
      timestamp,
      status: 'GENUINE',
      title: 'GENUINE PRODUCT',
      message: 'All 4 fields match',
      scanned: { ...scanned, rawText: rawQrPayload },
      registeredRecord: registered,
      fieldComparisons: comparisons,
      mismatchedFields: []
    };
  }

  return {
    id,
    timestamp,
    status: 'FAKE_MISMATCH',
    title: 'FAKE / INVALID PRODUCT',
    message: `Mismatch in ${mismatched.join(', ')}`,
    scanned: { ...scanned, rawText: rawQrPayload },
    registeredRecord: registered,
    fieldComparisons: comparisons,
    mismatchedFields: mismatched
  };
}
