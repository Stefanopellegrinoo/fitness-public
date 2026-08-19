// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// NOTE: Vitest v4 requires `function`/`class` (not arrow functions) as the
// mock implementation whenever the mocked export is invoked with `new` in
// the SUT (here, `new BrowserMultiFormatReader()`); an arrow-function
// implementation throws "TypeError: ... is not a constructor". See
// task-3-report.md for the RED evidence.
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: vi.fn().mockImplementation(function () {
    return {
      decodeFromVideoDevice: vi.fn((_d: unknown, _v: unknown, cb: (r: any, e: any) => void) => {
        cb({ getText: () => '3017620422003' }, null);
        return { stop: vi.fn() };
      }),
    };
  }),
}));

import { BarcodeScanner } from './barcode-scanner';
import { BrowserMultiFormatReader } from '@zxing/browser';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
});

describe('BarcodeScanner', () => {
  it('calls onScan with the decoded barcode when active', async () => {
    const onScan = vi.fn();
    render(<BarcodeScanner active onScan={onScan} />);
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('3017620422003'));
  });

  it('does not decode when inactive', async () => {
    const onScan = vi.fn();
    render(<BarcodeScanner active={false} onScan={onScan} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(onScan).not.toHaveBeenCalled();
  });

  it('reports a permission error when the camera is denied', async () => {
    const onScan = vi.fn();
    const onError = vi.fn();
    vi.mocked(BrowserMultiFormatReader).mockImplementationOnce(function () {
      return {
        decodeFromVideoDevice: vi.fn(() => {
          const err = new Error('Permission denied');
          err.name = 'NotAllowedError';
          return Promise.reject(err);
        }),
      };
    } as any);
    render(<BarcodeScanner active onScan={onScan} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('permission'));
  });
});
