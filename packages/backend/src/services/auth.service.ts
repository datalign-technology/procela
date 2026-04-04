import { TokenPayload } from '../types';

export interface AuthService {
  validateToken(token: string): Promise<boolean>;
  getUserFromToken(token: string): Promise<TokenPayload | null>;
}

/**
 * Stubbed auth service for local development.
 * Replace with Cognito / Auth0 implementation for production.
 */
export class StubAuthService implements AuthService {
  async validateToken(_token: string): Promise<boolean> {
    // In development, accept any non-empty token
    return true;
  }

  async getUserFromToken(_token: string): Promise<TokenPayload | null> {
    // Return a mock user for development
    return {
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'dev@clarity360.local',
      orgId: '00000000-0000-0000-0000-000000000010',
      role: 'ORG_ADMIN',
      name: 'Dev User',
    };
  }
}

export const authService: AuthService = new StubAuthService();
