import { ProductRecord, TestCaseResult } from '../types';
import { verifyAgainstList } from './verificationEngine';
import { parseQrPayload } from './qrParser';
import { localDb, INITIAL_SAMPLE_PRODUCTS } from './db';

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

  // Test 1: All fields matching -> Genuine
  {
    const start = performance.now();
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'GENUINE' && res.mismatchedFields.length === 0;
    results.push({
      id: 'TC-01',
      name: 'All Fields Matching',
      description: 'Scanned payload matches all 4 fields of authorized product SB001.',
      expectedStatus: 'GENUINE',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Verified as GENUINE with 0 mismatches.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 2: Product ID not registered -> Unregistered
  {
    const start = performance.now();
    const payload = 'Product: Smart Drone; ID: SD999; Manufacturer: ABC Electronics; Batch: B001';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'UNREGISTERED';
    results.push({
      id: 'TC-02',
      name: 'Product ID Not Registered',
      description: 'Scanned product ID SD999 does not exist in the authorized registry.',
      expectedStatus: 'UNREGISTERED',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Correctly flagged as UNREGISTERED PRODUCT.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 3: Product Name mismatching -> Invalid (Fake)
  {
    const start = performance.now();
    const payload = 'Product: Counterfeit Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'FAKE_MISMATCH' && res.mismatchedFields.includes('Product Name');
    results.push({
      id: 'TC-03',
      name: 'Product Name Mismatch',
      description: 'Scanned ID SB001 has tampered product name "Counterfeit Battery".',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? `Flagged as FAKE_MISMATCH: ${res.mismatchedFields.join(', ')}` : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 4: Manufacturer mismatching -> Invalid (Fake)
  {
    const start = performance.now();
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: Rogue Corp; Batch: B001';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'FAKE_MISMATCH' && res.mismatchedFields.includes('Manufacturer');
    results.push({
      id: 'TC-04',
      name: 'Manufacturer Mismatch',
      description: 'Scanned ID SB001 has unauthorized manufacturer "Rogue Corp".',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? `Flagged as FAKE_MISMATCH: ${res.mismatchedFields.join(', ')}` : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 5: Batch number mismatching -> Invalid (Fake)
  {
    const start = performance.now();
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B999_TAMPERED';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'FAKE_MISMATCH' && res.mismatchedFields.includes('Batch Number');
    results.push({
      id: 'TC-05',
      name: 'Batch Number Mismatch',
      description: 'Scanned ID SB001 has non-matching batch "B999_TAMPERED".',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? `Flagged as FAKE_MISMATCH: ${res.mismatchedFields.join(', ')}` : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 6: Multiple field mismatches -> Invalid (Fake)
  {
    const start = performance.now();
    const payload = 'Product: Bogus Battery; ID: SB001; Manufacturer: Fake Ltd; Batch: B888';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'FAKE_MISMATCH' && res.mismatchedFields.length === 3;
    results.push({
      id: 'TC-06',
      name: 'Multiple Field Mismatches',
      description: 'Scanned ID SB001 has name, manufacturer, and batch mismatches.',
      expectedStatus: 'FAKE_MISMATCH',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? `All 3 fields flagged: ${res.mismatchedFields.join(', ')}` : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 7: Missing batch number -> Invalid QR
  {
    const start = performance.now();
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'INVALID_QR' && res.mismatchedFields.includes('Batch Number');
    results.push({
      id: 'TC-07',
      name: 'Missing Batch Number Field',
      description: 'QR payload omits required "Batch" token.',
      expectedStatus: 'INVALID_QR',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Correctly rejected as INVALID_QR due to missing required batch number.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 8: Malformed text -> Invalid QR
  {
    const start = performance.now();
    const payload = 'RANDOM_GARBAGE_PAYLOAD_NOT_ESP32_FORMAT_XYZ_123';
    const res = verifyAgainstList(payload, testDb);
    const passed = res.status === 'INVALID_QR';
    results.push({
      id: 'TC-08',
      name: 'Malformed Unstructured Text',
      description: 'QR text does not match delimiter format or key-value pattern.',
      expectedStatus: 'INVALID_QR',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Correctly rejected without crashing.' : `Failed: Got ${res.status}`,
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
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001';
    const res = verifyAgainstList(payload, conflictingDb);
    const passed = res.status === 'AMBIGUOUS_RECORD';
    results.push({
      id: 'TC-09',
      name: 'Database Duplicate Conflict (Case E)',
      description: 'Dataset contains two conflicting records with same product ID SB001.',
      expectedStatus: 'AMBIGUOUS_RECORD',
      actualStatus: res.status,
      passed,
      inputPayload: payload,
      details: passed ? 'Refused arbitrary selection and raised AMBIGUOUS_RECORD error.' : `Failed: Got ${res.status}`,
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  // Test 10: Dataset empty -> Unregistered
  {
    const start = performance.now();
    const emptyDb: ProductRecord[] = [];
    const payload = 'Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001';
    const res = verifyAgainstList(payload, emptyDb);
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
      expectedStatus: 'INVALID_QR', // proxy status for display
      actualStatus: caughtError ? 'INVALID_QR' : 'GENUINE',
      passed: caughtError,
      inputPayload: '{ bad_json_not_array: true ',
      details: caughtError ? 'JSON parser safely caught corrupted syntax.' : 'Failed: accepted bad JSON without error.',
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
      details: persistenceOk ? 'Local persistent database queried successfully.' : 'Failed to query local database.',
      durationMs: +(performance.now() - start).toFixed(2)
    });
  }

  return results;
}
