import {
  DashboardStats,
  DemoSampleQrs,
  Esp32Status,
  PrintLogEntry,
  ProductRecord,
  QrGenerationJob,
  QrScanRecord,
  SecurityEventEntry,
  TestCaseResult,
  VerificationLogEntry,
  VerificationResult
} from '../types';

const SESSION_STORAGE_KEY = 'smartqr_active_session_token';
const ADMIN_TOKEN_KEY = 'smartqr_admin_token';

function getSavedSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSessionToken(token?: string | null): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveAdminToken(token?: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const adminToken = getAdminToken();
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(init?.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'UNAUTHORIZED') {
      saveAdminToken(null);
    }
    // Pass structured status responses like 423 LOCKED or 429 RATE_LIMITED when present
    if (data && typeof data.status === 'string') {
      return data as T;
    }
    throw new Error(data?.message || `Request failed with HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  // --- Auth ---
  async getAuthStatus(): Promise<{ authenticated: boolean; username: string | null }> {
    return requestJson('/api/auth/me');
  },

  async login(
    username: string,
    password: string
  ): Promise<{ authenticated: boolean; username: string; token?: string }> {
    const res = await requestJson<{ authenticated: boolean; username: string; token?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password })
      }
    );
    if (res.token) {
      saveAdminToken(res.token);
    }
    return res;
  },

  async logout(): Promise<{ authenticated: boolean }> {
    saveAdminToken(null);
    return requestJson('/api/auth/logout', { method: 'POST' });
  },

  // --- Public Verification Workflow ---
  async validateQr(rawPayload: string, scanEventId?: string): Promise<VerificationResult> {
    const eventId =
      scanEventId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `scan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

    const res = await requestJson<VerificationResult>('/api/verify/validate-qr', {
      method: 'POST',
      body: JSON.stringify({ rawPayload, scanEventId: eventId })
    });
    if (res.sessionToken) {
      saveSessionToken(res.sessionToken);
    }
    return { ...res, rawPayload };
  },

  async getCurrentSession(): Promise<VerificationResult | null> {
    const savedToken = getSavedSessionToken();
    const res = await requestJson<{
      hasSession: boolean;
      status?: 'BATCH_REQUIRED' | 'LOCKED';
      qrId?: string;
      productUniqueId?: string;
      sessionToken?: string;
      attemptCount?: number;
      maxAttempts?: number;
      attemptsRemaining?: number;
      lockedUntil?: string | null;
      expiresAt?: string;
      restoredFromSession?: boolean;
    }>('/api/verify/session/current', {
      headers: savedToken ? { 'x-session-token': savedToken } : undefined
    });

    if (!res.hasSession || !res.status) {
      saveSessionToken(null);
      return null;
    }

    if (res.sessionToken) {
      saveSessionToken(res.sessionToken);
    }

    return {
      status: res.status,
      title:
        res.status === 'LOCKED'
          ? 'BATCH VERIFICATION TEMPORARILY LOCKED'
          : 'QR CODE VALIDATED',
      message:
        res.status === 'LOCKED'
          ? 'Maximum incorrect batch-number attempts reached. This verification session is temporarily locked.'
          : 'Enter the batch number to check whether your product is genuine or fake.',
      qrId: res.qrId,
      productUniqueId: res.productUniqueId,
      sessionToken: res.sessionToken,
      attemptCount: res.attemptCount,
      maxAttempts: res.maxAttempts,
      attemptsRemaining: res.attemptsRemaining,
      lockedUntil: res.lockedUntil,
      expiresAt: res.expiresAt,
      restoredFromSession: true
    };
  },

  async dismissSession(): Promise<void> {
    await fetch('/api/verify/session/dismiss', {
      method: 'POST',
      credentials: 'include'
    }).catch(() => {});
    saveSessionToken(null);
  },

  async submitBatch(batchNumber: string, sessionToken?: string): Promise<VerificationResult> {
    const token = sessionToken || getSavedSessionToken() || undefined;
    const res = await requestJson<VerificationResult>('/api/verify/submit-batch', {
      method: 'POST',
      body: JSON.stringify({ batchNumber, sessionToken: token })
    });

    if (res.status === 'GENUINE' || res.status === 'GENUINE_DUPLICATE_WARNING' || res.status === 'EXPIRED') {
      saveSessionToken(null);
    }
    return res;
  },

  // --- Public Dashboard & Demo Samples ---
  async getDashboardStats(): Promise<DashboardStats> {
    return requestJson('/api/dashboard/stats');
  },

  async getDemoSampleQrs(): Promise<DemoSampleQrs> {
    return requestJson('/api/demo/sample-qrs');
  },

  // --- Admin Products & QR Labels ---
  async getProducts(): Promise<ProductRecord[]> {
    const res = await requestJson<{ products: ProductRecord[] }>('/api/products');
    return res.products;
  },

  async createProduct(product: {
    productId: string;
    productName: string;
    manufacturer: string;
    batchNumber: string;
    manufacturingDate: string;
    notes?: string;
  }): Promise<{ product: ProductRecord; generationJob?: QrGenerationJob }> {
    return requestJson<{ product: ProductRecord; generationJob?: QrGenerationJob }>('/api/products', {
      method: 'POST',
      body: JSON.stringify(product)
    });
  },

  async updateProduct(
    productId: string,
    updates: {
      productName: string;
      manufacturer: string;
      batchNumber: string;
      manufacturingDate: string;
      notes?: string;
    }
  ): Promise<void> {
    await requestJson(`/api/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async deleteProduct(productId: string): Promise<void> {
    await requestJson(`/api/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE'
    });
  },

  async importProducts(
    items: unknown[],
    mode: 'merge' | 'replace'
  ): Promise<{
    imported: number;
    skippedDuplicates: number;
    invalidCount: number;
    errors: string[];
  }> {
    return requestJson('/api/products/import', {
      method: 'POST',
      body: JSON.stringify({ items, mode })
    });
  },

  async resetSampleProducts(): Promise<void> {
    await requestJson('/api/products/reset-sample', { method: 'POST' });
  },

  // --- ESP32 QR Generation Queue & Hardware Status ---
  async getEsp32Status(): Promise<Esp32Status> {
    return requestJson('/api/esp32/status');
  },

  async getQrJobs(): Promise<QrGenerationJob[]> {
    const res = await requestJson<{ jobs: QrGenerationJob[] }>('/api/qr-jobs');
    return res.jobs;
  },

  async getQrJobStatus(jobId: string): Promise<QrGenerationJob> {
    const res = await requestJson<{ job: QrGenerationJob }>(
      `/api/qr-jobs/${encodeURIComponent(jobId)}`
    );
    return res.job;
  },

  async requestQrGeneration(
    productId: string,
    forceNew = false
  ): Promise<{ alreadyQueued: boolean; job: QrGenerationJob }> {
    return requestJson('/api/qr-jobs/request', {
      method: 'POST',
      body: JSON.stringify({ productId, forceNew })
    });
  },

  async retryQrJob(jobId: string): Promise<{ job: QrGenerationJob }> {
    return requestJson(`/api/qr-jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST'
    });
  },

  async setQrStatus(qrId: string, status: 'active' | 'revoked'): Promise<{ qrId: string; status: 'active' | 'revoked' }> {
    return requestJson(`/api/qr/${encodeURIComponent(qrId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  },

  async getPrintLogs(): Promise<PrintLogEntry[]> {
    const res = await requestJson<{ printLogs: PrintLogEntry[] }>('/api/prints');
    return res.printLogs;
  },

  async getHistory(): Promise<{
    logs: VerificationLogEntry[];
    securityEvents: SecurityEventEntry[];
    qrScans: QrScanRecord[];
  }> {
    return requestJson('/api/history');
  },

  // --- Isolated Backend Test Suite ---
  async runBackendTestSuite(): Promise<TestCaseResult[]> {
    const res = await requestJson<{ results: TestCaseResult[] }>('/api/testsuite/run', {
      method: 'POST'
    });
    return res.results;
  }
};
