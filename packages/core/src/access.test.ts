import { describe, expect, it } from 'vitest';
import { soundsLikeAuthCheck } from './access.js';

describe('the words a check of who is asking is named with (P90)', () => {
  it('hears a check in the name of the call or of the type it is called on', () => {
    for (const name of [
      'LibrarianAuth',
      'authorize',
      'authenticate',
      'verify',
      'verifySignature',
      'hasPermission',
      'checkAccess',
      'isAllowed',
      'entitlements',
      'requireRole',
      'MembershipService',
      'employeeCheck',
      'SessionStore',
      'token_service',
      'signature',
      'CredentialsVault',
    ]) {
      expect(soundsLikeAuthCheck(name), name).toBe(true);
    }
  });

  it('hears nothing in a parse, a validation or a load, nor inside a longer word', () => {
    for (const name of ['parse', 'parseBody', 'validate', 'validateInput', 'load', 'loadItem', 'remember', 'controller', 'catalogue']) {
      expect(soundsLikeAuthCheck(name), name).toBe(false);
    }
  });

  it('answers for any of the names given, and nothing for none', () => {
    expect(soundsLikeAuthCheck(undefined, 'parse', 'DeskAccess')).toBe(true);
    expect(soundsLikeAuthCheck()).toBe(false);
  });
});
