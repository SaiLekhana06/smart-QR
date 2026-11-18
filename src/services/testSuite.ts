import { ProductRecord, TestCaseResult } from '../types';
import { verifyAgainstList } from './verificationEngine';
import { parseQrPayload } from './qrParser';
import { localDb } from './db';

export async function runAllVerificationTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const testDb: ProductRecord[] = [
    {
      productName: 'Smart Battery',
      productId: 'SB001',
      manufacturer: 'ABC Electronics',
      batchNumber: 'B001'
    },
    {
      productName: 'Smart Sensor',
      productId: 'SS002',
      manufacturer: 'XYZ Electronics',
      batchNumber: 'B002'
    },
    {
      productName: 'Smart Controller',
      productId: 'SC003',
      manufacturer: 'Tech Solutions',
      batchNumber: 'B003'
    }
  ];

  // Test 1: Plain Product ID QR + matching Batch Number -> Genuine
  {
    const start = performance.now();
    const payload = 'SB001';
    const res = verifyAgainstList(payload, testDb, 'B001');
    const passed = res.status === 'GENUINE' && res.registeredRecord === null;
    results.push({
      id: 'TC-01',
      name: 'Product ID Only QR + Matching Batch',
      description: 'QR contains only Product ID "SB001" and entered batch "B001" matches registry without exposing product details.',
      expectedStatus: 'GENUINE',
      actualStatus: res.status,
      passed,
      inputPayload: `${payload} (Batch: B001)`,
      details: passed
        ? 'Verified as GENUINE PRODUCT with complete product details hidden.'
        : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 2: Product ID not registered -> "This product is not developed by us"
  {
    const start = performance.now();
    const payload = 'SD999';
    const res = verifyAgainstList(payload, testDb, 'B001');
    const passed =
      res.status === 'UNREGISTERED' &&
      res.title === 'This product is not developed by us';
    results.push({
      id: 'TC-02',
      name: 'Unregistered Product ID',
      description: 'Scanned product ID SD999 does not exist in registered products.',
      expectedStatus: 'UNREGISTERED',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed
        ? 'Correctly displayed "This product is not developed by us".'
        : `Failed: Got ${res.status} (${res.title})`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 3: Key-Value "ID: SB001" QR format + matching Batch -> Genuine
  {
    const start = performance.now();
    const payload = 'ID: SB001';
    const res = verifyAgainstList(payload, testDb, 'B001');
    const passed = res.status === 'GENUINE' && res.scanned.productId === 'SB001';
    results.push({
      id: 'TC-03',
      name: 'Key-Value Product ID Format',
      description: 'QR formatted as "ID: SB001" parses Product ID and verifies matching batch B001.',
      expectedStatus: 'GENUINE',
      actualStatus: res.status,
      passed,
      inputPayload: `${payload} (Batch: B001)`,
      details: passed ? 'Extracted SB001 and verified GENUINE.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 4: JSON '{"productId": "SS002"}' QR format + matching Batch -> Genuine
  {
    const start = performance.now();
    const payload = '{"productId": "SS002"}';
    const res = verifyAgainstList(payload, testDb, 'B002');
    const passed = res.status === 'GENUINE' && res.scanned.productId === 'SS002';
    results.push({
      id: 'TC-04',
      name: 'JSON Product ID Format',
      description: 'JSON QR payload containing only productId SS002 verifies with batch B002.',
      expectedStatus: 'GENUINE',
      actualStatus: res.status,
      passed,
      inputPayload: `${payload} (Batch: B002)`,
      details: passed ? 'Extracted SS002 and verified GENUINE.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 5: Batch number mismatch -> Fake Product
  {
    const start = performance.now();
    const payload = 'SB001';
    const res = verifyAgainstList(payload, testDb, 'B999_TAMPERED');
    const passed = res.status === 'FAKE_MISMATCH' && res.registeredRecord === null;
    results.push({
      id: 'TC-05',
      name: 'Batch Number Mismatch (Fake Product)',
      description: 'Product ID SB001 matches, but entered batch "B999_TAMPERED" fails verification.',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: `${payload} (Batch: B999_TAMPERED)`,
      details: passed
        ? 'Flagged as FAKE PRODUCT with no product details revealed.'
        : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 6: Case-sensitive batch enforcement -> Fake Product
  {
    const start = performance.now();
    const payload = 'SB001';
    const res = verifyAgainstList(payload, testDb, 'b001');
    const passed = res.status === 'FAKE_MISMATCH';
    results.push({
      id: 'TC-06',
      name: 'Case-Sensitive Batch Enforcement',
      description: 'Lowercase "b001" does not match registered batch "B001".',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: `${payload} (Batch: b001)`,
      details: passed ? 'Enforced exact case-sensitive batch match.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 7: Empty QR payload -> Invalid QR
  {
    const start = performance.now();
    const payload = '   ';
    const parseRes = parseQrPayload(payload);
    const res = verifyAgainstList(payload, testDb, 'B001');
    const passed = !parseRes.success && res.status === 'INVALID_QR';
    results.push({
      id: 'TC-07',
      name: 'Empty QR Payload Rejection',
      description: 'Empty or whitespace-only QR payload is safely rejected as INVALID_QR.',
      expectedStatus: 'INVALID_QR',
      actualStatus: res.status,
      passed,
      inputPayload: '(empty)',
      details: passed ? 'Correctly rejected empty QR payload.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 8: Malformed unstructured text -> Invalid QR
  {
    const start = performance.now();
    const payload = 'RANDOM GARBAGE PAYLOAD NOT AN ID';
    const res = verifyAgainstList(payload, testDb, 'B001');
    const passed = res.status === 'INVALID_QR';
    results.push({
      id: 'TC-08',
      name: 'Malformed Unstructured Text',
      description: 'QR text containing spaces/unstructured text is rejected without crashing.',
      expectedStatus: 'INVALID_QR',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Correctly rejected as INVALID_QR.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 9: Conflicting product IDs in dataset -> Ambiguous / Database Error
  {
    const start = performance.now();
    const conflictingDb: ProductRecord[] = [
      ...testDb,
      {
        productName: 'Conflicting Battery Copy',
        productId: 'SB001',
        manufacturer: 'Alternate Vendor',
        batchNumber: 'B001-ALT'
      }
    ];
    const payload = 'SB001';
    const res = verifyAgainstList(payload, conflictingDb, 'B001');
    const passed = res.status === 'AMBIGUOUS_RECORD';
    results.push({
      id: 'TC-09',
      name: 'Database Duplicate Conflict',
      description: 'Dataset contains two conflicting records with same product ID SB001.',
      expectedStatus: 'AMBIGUOUS_RECORD',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed
        ? 'Refused arbitrary selection and raised AMBIGUOUS_RECORD error.'
        : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 10: Dataset empty -> Unregistered
  {
    const start = performance.now();
    const emptyDb: ProductRecord[] = [];
    const payload = 'SB001';
    const res = verifyAgainstList(payload, emptyDb, 'B001');
    const passed = res.status === 'UNREGISTERED';
    results.push({
      id: 'TC-10',
      name: 'Empty Registered Dataset',
      description: 'Verification with an empty local database returns UNREGISTERED.',
      expectedStatus: 'UNREGISTERED',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Handled empty dataset safely.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 11: Dataset import containing malformed JSON
  {
    const start = performance.now();
    let caughtError = false;
    try {
      await localDb.importProductsFromJson('{ bad_json_not_array: true ');
    } catch {
      caughtError = true;
    }
    results.push({
      id: 'TC-11',
      name: 'Malformed JSON Import Rejection',
      description: 'Importing corrupt JSON payload throws safe validation error.',
      expectedStatus: 'INVALID_QR',
      actualStatus: caughtError ? 'INVALID_QR' : 'GENUINE',
      passed: caughtError,
      inputPayload: '{ bad_json_not_array: true ',
      details: caughtError
        ? 'JSON parser safely caught corrupted syntax.'
        : 'Failed: accepted bad JSON without error.',
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 12: Database persistence & sample products availability
  {
    const start = performance.now();
    let persistenceOk = false;
    try {
      const prods = await localDb.getAllProducts();
      persistenceOk = prods.length > 0;
    } catch {
      persistenceOk = false;
    }
    results.push({
      id: 'TC-12',
      name: 'Local Database Persistent Store',
      description: 'IndexedDB opens and queries stored registered records.',
      expectedStatus: 'GENUINE',
      actualStatus: persistenceOk ? 'GENUINE' : 'FAKE_MISMATCH',
      passed: persistenceOk,
      inputPayload: 'IndexedDB: SmartQrLocalDb / products',
      details: persistenceOk
        ? 'Local persistent database queried successfully.'
        : 'Failed to query local database.',
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  return results;
}
