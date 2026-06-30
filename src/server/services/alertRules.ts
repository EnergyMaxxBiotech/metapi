export function isCloudflareChallenge(message?: string | null): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return text.includes('cloudflare') || text.includes('cf challenge') || text.includes('challenge required');
}

const SESSION_TOKEN_REBIND_HINT = '请在中转站重新生成系统访问令牌后重新绑定账号';

function isEndpointDispatchDeniedMessage(message?: string | null): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return (
    /does\s+not\s+allow\s+\/v1\/[a-z0-9/_:-]+\s+dispatch/i.test(message)
    || text.includes('dispatch denied')
  );
}

function containsHttpStatus(message: string | null | undefined, status: number): boolean {
  if (!message) return false;
  return new RegExp(`(?:^|\\b)(?:http\\s*)?${status}(?:\\b|:)`, 'i').test(message);
}

function isRequestValidationFailure(text: string): boolean {
  return (
    text.includes('invalid_argument') ||
    text.includes('invalid_request_error') ||
    text.includes('input token limit') ||
    text.includes('context length') ||
    text.includes('maximum context') ||
    text.includes('max context') ||
    text.includes('too many tokens')
  );
}

function isCapabilityOrBillingFailure(text: string): boolean {
  return (
    /model\s+.+\s+is\s+not\s+supported/.test(text) ||
    text.includes('not supported for format') ||
    text.includes('no payment method') ||
    text.includes('payment method') ||
    text.includes('billing') ||
    text.includes('insufficient quota') ||
    text.includes('quota exceeded')
  );
}

function isTransientUpstreamFailure(text: string): boolean {
  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('service unavailable') ||
    text.includes('bad gateway') ||
    text.includes('gateway timeout') ||
    text.includes('cloudflare') ||
    text.includes('cf challenge') ||
    text.includes('overloaded')
  );
}

function hasCredentialFailureSignal(text: string): boolean {
  return (
    text.includes('jwt expired') ||
    text.includes('token expired') ||
    text.includes('expired token') ||
    text.includes('invalid_token') ||
    text.includes('expired_token') ||
    text.includes('invalid_api_key') ||
    text.includes('expired_api_key') ||
    /invalid\s+(?:access\s+|refresh\s+|session\s+)?token/.test(text) ||
    /(?:access\s+|refresh\s+|session\s+)?token\s+(?:is\s+)?invalid/.test(text) ||
    /(?:access\s+|refresh\s+|session\s+)?token\s+(?:is\s+)?expired/.test(text) ||
    /access\s+token\s+(?:is\s+)?required/.test(text) ||
    /invalid\s+api\s+key/.test(text) ||
    /api\s+key\s+(?:is\s+)?invalid/.test(text) ||
    /incorrect\s+api\s+key/.test(text) ||
    /api\s+key\s+(?:is\s+)?expired/.test(text) ||
    /token\s*(?:无效|过期)/.test(text) ||
    /(?:令牌|访问令牌).*(?:无效|过期)/.test(text)
  );
}

function hasHttpAuthFailureSignal(text: string): boolean {
  return (
    text.includes('unauthorized') ||
    text.includes('unauthenticated') ||
    text.includes('authentication required') ||
    text.includes('authorization required') ||
    text.includes('not authenticated') ||
    text.includes('invalid authorization')
  );
}

export function isTokenExpiredError(input: { status?: number; message?: string | null }): boolean {
  const rawMessage = input.message || '';
  const text = (input.message || '').toLowerCase();
  if (isEndpointDispatchDeniedMessage(rawMessage)) return false;
  if (!text) return false;

  // NewAPI-like sites may return this when session context is missing for an action,
  // which does not always mean the account token is expired.
  if (text.includes('未登录且未提供 access token')) return false;

  const hasCredentialFailure = hasCredentialFailureSignal(text);
  if (!hasCredentialFailure && (
    isRequestValidationFailure(text) ||
    isCapabilityOrBillingFailure(text) ||
    isTransientUpstreamFailure(text)
  )) {
    return false;
  }

  if (input.status === 401 || containsHttpStatus(rawMessage, 401)) {
    return hasCredentialFailure || hasHttpAuthFailureSignal(text);
  }

  return hasCredentialFailure;
}

export function appendSessionTokenRebindHint(message?: string | null): string {
  const raw = String(message || '').trim();
  if (!raw) return raw;
  if (raw.includes(SESSION_TOKEN_REBIND_HINT)) return raw;

  const text = raw.toLowerCase();
  const looksLikeInvalidAccessToken = (
    raw.includes('无权进行此操作，access token 无效') ||
    /invalid\s+access\s+token/.test(text) ||
    /access\s+token\s+is\s+invalid/.test(text) ||
    /access\s+token.*无效/.test(raw)
  );
  if (!looksLikeInvalidAccessToken) return raw;

  return `${raw}，${SESSION_TOKEN_REBIND_HINT}`;
}
