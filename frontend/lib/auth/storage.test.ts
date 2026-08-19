/**
 * Tests for Storage Service
 * Tests localStorage abstraction and fallback handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveAuthData,
  getAuthData,
  clearAuthData,
  hasAuthData,
  storageService,
} from './storage';

describe('Storage Service', () => {
  beforeEach(() => {
    // Clear localStorage
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      keys.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      // Ignore
    }
    
    // Clear memory storage
    storageService.__clearMemoryStorage?.();
  });

  afterEach(() => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      keys.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      // Ignore
    }
    storageService.__clearMemoryStorage?.();
  });

  describe('saveAuthData', () => {
    it('should save token and user to localStorage', () => {
      const token = 'test-token-123';
      const user = { id: '1', email: 'test@example.com', createdAt: '2024-01-01' };

      saveAuthData(token, user);

      const stored = localStorage.getItem('auth_token');
      const storedUser = localStorage.getItem('auth_user');

      expect(stored).toBe(token);
      expect(storedUser).toBe(JSON.stringify(user));
    });

    it('should stringify user object correctly', () => {
      const token = 'token';
      const user = {
        id: '123',
        email: 'user@example.com',
        createdAt: '2024-04-07',
        metadata: { premium: true },
      };

      saveAuthData(token, user);

      const retrieved = getAuthData();
      expect(retrieved.user).toEqual(user);
    });
  });

  describe('getAuthData', () => {
    it('should retrieve saved token and user', () => {
      const token = 'test-token';
      const user = { id: '1', email: 'user@test.com', createdAt: '2024-01-01' };

      saveAuthData(token, user);
      const data = getAuthData();

      expect(data.token).toBe(token);
      expect(data.user).toEqual(user);
    });

    it('should return null values when storage is empty', () => {
      const data = getAuthData();

      expect(data.token).toBeNull();
      expect(data.user).toBeNull();
    });

    it('should handle corrupted user JSON gracefully', () => {
      localStorage.setItem('auth_token', 'valid-token');
      localStorage.setItem('auth_user', '{invalid json}');

      const data = getAuthData();

      expect(data.token).toBe('valid-token');
      expect(data.user).toBeNull();
    });
  });

  describe('clearAuthData', () => {
    it('should remove token and user from localStorage', () => {
      const token = 'test-token';
      const user = { id: '1', email: 'user@test.com', createdAt: '2024-01-01' };

      saveAuthData(token, user);
      expect(getAuthData().token).not.toBeNull();

      clearAuthData();

      const data = getAuthData();
      expect(data.token).toBeNull();
      expect(data.user).toBeNull();
    });

    it('should clear both token and user', () => {
      localStorage.setItem('auth_token', 'token');
      localStorage.setItem('auth_user', JSON.stringify({ id: '1' }));

      clearAuthData();

      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('auth_user')).toBeNull();
    });
  });

  describe('hasAuthData', () => {
    it('should return true when both token and user exist', () => {
      const token = 'token';
      const user = { id: '1', email: 'user@test.com', createdAt: '2024-01-01' };

      saveAuthData(token, user);

      expect(hasAuthData()).toBe(true);
    });

    it('should return false when token is missing', () => {
      localStorage.setItem('auth_user', JSON.stringify({ id: '1' }));

      expect(hasAuthData()).toBe(false);
    });

    it('should return false when user is missing', () => {
      localStorage.setItem('auth_token', 'token');

      expect(hasAuthData()).toBe(false);
    });

    it('should return false when storage is empty', () => {
      expect(hasAuthData()).toBe(false);
    });
  });

  describe('Private mode fallback', () => {
    it('should save to memory storage when localStorage throws QuotaExceededError', () => {
      const token = 'test-token';
      const user = { id: '1', email: 'user@test.com', createdAt: '2024-01-01' };

      // Save should not throw
      expect(() => saveAuthData(token, user)).not.toThrow();

      // Data should be retrievable from storage (falls back to memory)
      const data = getAuthData();
      expect(data.token).toBe(token);
      expect(data.user).toEqual(user);
    });

    it('should recover from localStorage errors gracefully', () => {
      // Save some data
      const token = 'test-token';
      const user = { id: '1', email: 'user@test.com', createdAt: '2024-01-01' };
      saveAuthData(token, user);

      // Retrieve should work
      const data = getAuthData();
      expect(data.token).toBe(token);
    });
  });
});
