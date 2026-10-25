import type { OAuth2Config } from './collectionSchema';
import type { VariableInterpolationContext } from './interpolation';

export interface OAuth2TokenCoordinate {
  collectionId: string;
  environmentId?: string;
  profileOrRequestId: string;
}

export interface DecodedJwtToken {
  isJwt: boolean;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature?: string;
  issuedAt?: string;
  expiresAt?: string;
  isExpired?: boolean;
  expiresInSeconds?: number;
  subject?: string;
  issuer?: string;
  audience?: string | string[];
  scopes?: string[];
  error?: string;
}

export interface OAuth2TokenRecord {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  scope?: string;
  idToken?: string;
  expiresIn?: number;
  acquiredAt: string;
  expiresAt?: string;
  rawResponse: Record<string, unknown>;
  decodedJwt?: DecodedJwtToken;
}

export interface OAuth2Diagnostics {
  requestUrl: string;
  grantType: string;
  clientAuthMethod: string;
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
}

export interface OAuth2TokenExchangeResult {
  ok: boolean;
  token?: OAuth2TokenRecord;
  error?: string;
  status?: number;
  diagnostics?: OAuth2Diagnostics;
}

export interface OAuth2GetTokenRequest {
  config: OAuth2Config;
  coordinate?: OAuth2TokenCoordinate;
  interpolationContext?: VariableInterpolationContext;
  verifySsl?: boolean;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

export interface OAuth2RefreshTokenRequest {
  config: OAuth2Config;
  refreshToken?: string;
  coordinate?: OAuth2TokenCoordinate;
  interpolationContext?: VariableInterpolationContext;
  verifySsl?: boolean;
  timeoutMs?: number;
}
