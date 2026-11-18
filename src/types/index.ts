/**
 * SmartQR Core Type Definitions
 * Tamper-Proof / Duplication-Proof Product Authentication System
 */

export interface ProductRecord {
  productName: string;
  productId: string;
  manufacturer: string;
  batchNumber: string;
  registeredAt?: string;
  notes?: string;
}

export type VerificationStatus =
  | 'GENUINE'
  | 'FAKE_MISMATCH'
  | 'UNREGISTERED'
  | 'INVALID_QR'
  | 'AMBIGUOUS_RECORD';

export interface FieldComparison {
  field: 'productName' | 'productId' | 'manufacturer' | 'batchNumber';
  label: string;
  scannedValue: string;
  registeredValue: string;
  matched: boolean;
}

export interface VerificationResult {
  id: string;
  timestamp: string;
  status: VerificationStatus;
  title: string;
  message: string;
  scanned: {
    productName?: string;
    productId?: string;
    manufacturer?: string;
    batchNumber?: string;
    rawText: string;
  };
  registeredRecord?: ProductRecord | null;
  fieldComparisons: FieldComparison[];
  mismatchedFields: string[];
  parseErrors?: string[];
}

export interface ScanHistoryEntry {
  id: string;
  timestamp: string;
  rawText: string;
  productName: string;
  productId: string;
  manufacturer: string;
  batchNumber: string;
  status: VerificationStatus;
  mismatchedFields: string[];
  registeredProductId?: string;
  notes?: string;
}

export interface DatasetStats {
  totalRegistered: number;
  totalScans: number;
  genuineCount: number;
  fakeMismatchCount: number;
  unregisteredCount: number;
  invalidQrCount: number;
  ambiguousCount: number;
  lastScanTimestamp: string | null;
}

export interface ParseResult {
  success: boolean;
  product?: {
    productName: string;
    productId: string;
    manufacturer: string;
    batchNumber: string;
  };
  missingFields: string[];
  rawText: string;
  error?: string;
}

export interface TestCaseResult {
  id: string;
  name: string;
  description: string;
  expectedStatus: VerificationStatus;
  actualStatus: VerificationStatus;
  passed: boolean;
  inputPayload: string;
  details: string;
  durationMs: number;
}
