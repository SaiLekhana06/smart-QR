import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Play,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Cpu,
  Clock,
  Layers,
  FileCheck
} from 'lucide-react';
import { TestCaseResult } from '../types';
import { runAllVerificationTests } from '../services/testSuite';

interface TestSuiteViewProps {
  initialTests?: TestCaseResult[];
}

export const TestSuiteView: React.FC<TestSuiteViewProps> = () => {
  const [tests, setTests] = useState<TestCaseResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const executeSuite = async () => {
    setIsRunning(true);
    try {
      const results = await runAllVerificationTests();
      setTests(results);
      setHasRun(true);
    } finally {
      setIsRunning(false);
    }
  };

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-white">Engineering Project Test Harness</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic verification test suite validating Section 14 & 16 criteria for B.Tech project defense.
          </p>
        </div>

        <button
          onClick={executeSuite}
          disabled={isRunning}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 disabled:opacity-50 text-xs font-bold text-white shadow-lg shadow-cyan-600/30 transition"
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Executing Test Suite...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Run All 12 Test Cases</span>
            </>
          )}
        </button>
      </div>

      {/* Summary Scorecard */}
      {hasRun && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                Total Test Cases
              </span>
              <div className="text-2xl font-black text-white mt-1">{tests.length}</div>
            </div>
            <Layers className="w-7 h-7 text-cyan-400 opacity-60" />
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-emerald-900/60 flex items-center justify-between">
            <div>
              <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                Passed Tests
              </span>
              <div className="text-2xl font-black text-emerald-400 mt-1">{passCount}</div>
            </div>
            <CheckCircle2 className="w-7 h-7 text-emerald-400 opacity-80" />
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-rose-900/60 flex items-center justify-between">
            <div>
              <span className="text-xs text-rose-400 font-semibold uppercase tracking-wider">
                Failed Tests
              </span>
              <div className="text-2xl font-black text-rose-400 mt-1">{failCount}</div>
            </div>
            <XCircle className="w-7 h-7 text-rose-400 opacity-80" />
          </div>
        </div>
      )}

      {/* Test Cases Table */}
      {hasRun ? (
        <div className="space-y-3">
          {tests.map((test) => (
            <div
              key={test.id}
              className={`p-4 rounded-xl border transition-all ${
                test.passed
                  ? 'bg-slate-900/90 border-slate-800 hover:border-emerald-800/80'
                  : 'bg-rose-950/30 border-rose-800/80'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {test.passed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-cyan-400">
                        {test.id}
                      </span>
                      <h3 className="text-sm font-bold text-white">{test.name}</h3>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          test.passed
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {test.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">{test.description}</p>
                  </div>
                </div>

                <div className="text-right sm:shrink-0 flex sm:flex-col items-center sm:items-end justify-between text-xs text-slate-400">
                  <span className="font-mono text-[11px] text-slate-400">
                    Latency: {test.durationMs}ms
                  </span>
                  <span className="text-[11px]">
                    Expected: <strong className="text-white">{test.expectedStatus}</strong>
                  </span>
                </div>
              </div>

              {/* Payload & Details Accordion / Subbox */}
              <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 break-all select-all">
                  <span className="text-slate-400 block text-[10px] font-sans font-semibold mb-0.5">
                    Input Tested:
                  </span>
                  {test.inputPayload}
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
                  <span className="text-slate-400 block text-[10px] font-semibold mb-0.5">
                    Engine Assertion Result:
                  </span>
                  {test.details}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
          <Sparkles className="w-12 h-12 text-cyan-400 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">Automated Acceptance Test Harness</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Click the button above to execute all 12 mandatory engineering test cases against the live verification engine, parsing routines, and persistent storage layer.
            </p>
          </div>
          <button
            onClick={executeSuite}
            className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white transition shadow-sm"
          >
            Execute Test Suite Now
          </button>
        </div>
      )}
    </div>
  );
};
