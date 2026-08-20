import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectBrowserGpuFlagInfo,
  getGpuMockFromQuery,
  getBrowserOverrideFromQuery,
  evaluateBrowserCompatibility,
} from '~/utils/browser-compatibility';

describe('browser-compatibility GPU & Flags', () => {
  const originalLocation = window.location;

  afterEach(() => {
    // Restore window.location search
    window.history.replaceState({}, '', '/');
  });

  describe('detectBrowserGpuFlagInfo', () => {
    it('detects Chrome / Chromium correctly', () => {
      const info = detectBrowserGpuFlagInfo('chrome');
      expect(info.browserFamily).toBe('chrome');
      expect(info.flagUrl).toBe('chrome://flags/#enable-unsafe-webgpu');
      expect(info.flagName).toBe('enable-unsafe-webgpu');
    });

    it('detects Edge correctly', () => {
      const info = detectBrowserGpuFlagInfo('edge');
      expect(info.browserFamily).toBe('edge');
      expect(info.flagUrl).toBe('edge://flags/#enable-unsafe-webgpu');
    });

    it('detects Firefox correctly', () => {
      const info = detectBrowserGpuFlagInfo('firefox');
      expect(info.browserFamily).toBe('firefox');
      expect(info.flagUrl).toBe('about:config');
      expect(info.flagName).toBe('dom.webgpu.enabled');
    });

    it('detects Safari correctly', () => {
      const info = detectBrowserGpuFlagInfo('safari');
      expect(info.browserFamily).toBe('safari');
      expect(info.flagUrl).toBeUndefined();
    });
  });

  describe('Query parameter overrides', () => {
    it('parses mock_gpu=none as false', () => {
      window.history.replaceState({}, '', '/?mock_gpu=none');
      expect(getGpuMockFromQuery()).toBe(false);
    });

    it('parses mock_gpu=webgpu as true', () => {
      window.history.replaceState({}, '', '/?mock_gpu=webgpu');
      expect(getGpuMockFromQuery()).toBe(true);
    });

    it('parses mock_browser=firefox', () => {
      window.history.replaceState({}, '', '/?mock_browser=firefox');
      expect(getBrowserOverrideFromQuery()).toBe('firefox');
      const info = detectBrowserGpuFlagInfo();
      expect(info.browserFamily).toBe('firefox');
    });
  });

  describe('evaluateBrowserCompatibility WebGPU check', () => {
    it('respects mock_gpu=none in evaluateBrowserCompatibility', () => {
      window.history.replaceState({}, '', '/?mock_gpu=none');
      const report = evaluateBrowserCompatibility();
      const gpuCheck = report.checks.find((c) => c.id === 'webgpu');
      expect(gpuCheck?.supported).toBe(false);
    });
  });
});
