import type {
  AssertionRule,
  AuthConfig,
  AuthProfile,
  CaptureRule,
  FormDataEntry,
  GraphQLConfig,
  HttpMethod,
  KeyValueEntry,
  PathParamEntry,
  QueryParamEntry,
  RequestBodyConfig,
  RequestProtocol,
} from './collectionSchema';
import type { VariableInterpolationContext } from './interpolation';

export interface HttpTimingBreakdown {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  downloadMs: number;
  totalMs: number;
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  raw: string;
}

export interface TlsCertificateDetails {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  protocol: string;
  cipher: string;
  fingerprint256?: string;
}

export interface RedirectHop {
  fromUrl: string;
  toUrl: string;
  statusCode: number;
  method: string;
  durationMs: number;
}

export interface CapturedVariableResult {
  variable: string;
  scope: CaptureRule['scope'];
  source: CaptureRule['source'];
  expression?: string;
  value: string | null;
  matched: boolean;
  secret?: boolean;
  error?: string;
}

export interface AssertionEvaluationResult {
  rule: AssertionRule;
  passed: boolean;
  actual: unknown;
  message: string;
}

export interface PreparedHttpRequest {
  /** Unique identifier used for in-flight cancellation (`http:cancel`). */
  requestId?: string;
  protocol?: RequestProtocol;
  method: HttpMethod;
  url: string;
  queryParams?: QueryParamEntry[];
  pathParams?: PathParamEntry[];
  /** Ancestor headers (e.g. Collection defaults -> Folder chain) merged before request headers. */
  inheritedHeaders?: KeyValueEntry[];
  headers?: KeyValueEntry[];
  body?: RequestBodyConfig;
  graphql?: GraphQLConfig;
  /** Request-level auth config (`inherit`, `none`, `profile`, `bearer`, `basic`, `apikey`, `digest`, `awsv4`, `oauth2`). */
  auth?: AuthConfig;
  /** Ancestor auth configs ordered from nearest parent folder up to collection defaults, or outermost to innermost. */
  ancestorAuthChain?: Array<AuthConfig | undefined>;
  /** Collection-level default auth config. */
  collectionDefaultAuth?: AuthConfig;
  /** Named auth profiles defined on the collection. */
  authProfiles?: AuthProfile[];
  /** Variable interpolation context (`{{variable}}`). */
  interpolationContext?: VariableInterpolationContext;
  /** Optional collection/environment/scope identifiers for OAuth 2.0 token caching. */
  collectionId?: string;
  environmentId?: string;
  authOwnerId?: string;
  /** Timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Follow 3xx HTTP redirects (default true). */
  followRedirects?: boolean;
  /** Maximum number of redirects to follow (default 10). */
  maxRedirects?: number;
  /** Verify TLS/SSL server certificates (default true). */
  verifySsl?: boolean;
  /** Declarative post-response variable extraction rules. */
  captures?: CaptureRule[];
  /** Declarative post-response test assertions. */
  assertions?: AssertionRule[];
}

export interface HttpResponseResult {
  requestId: string;
  ok: boolean;
  cancelled?: boolean;
  timedOut?: boolean;
  error?: string;
  finalUrl: string;
  method: string;
  status: number;
  statusText: string;
  httpVersion: string;
  remoteAddress?: string;
  headers: Record<string, string>;
  rawHeaders: Array<{ key: string; value: string }>;
  cookies: ParsedSetCookie[];
  body: string;
  bodyBase64?: string;
  isBinary: boolean;
  contentType: string;
  /** Uncompressed payload size in bytes. */
  sizeBytes: number;
  /** Compressed / over-the-wire payload size in bytes. */
  transferSizeBytes: number;
  timings: HttpTimingBreakdown;
  tls: TlsCertificateDetails | null;
  redirects: RedirectHop[];
  captures: CapturedVariableResult[];
  assertions: AssertionEvaluationResult[];
  /** Effective request headers actually sent on the final hop. */
  sentHeaders: Record<string, string>;
}

export type {
  AssertionRule,
  AuthConfig,
  AuthProfile,
  CaptureRule,
  FormDataEntry,
  GraphQLConfig,
  HttpMethod,
  KeyValueEntry,
  PathParamEntry,
  QueryParamEntry,
  RequestBodyConfig,
  RequestProtocol,
};
