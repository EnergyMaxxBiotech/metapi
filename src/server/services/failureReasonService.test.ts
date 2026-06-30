import { describe, expect, it } from 'vitest';
import { classifyFailureReason } from './failureReasonService.js';

describe('failureReasonService', () => {
  it('classifies turnstile requirement as manual verification', () => {
    const result = classifyFailureReason({
      message: 'Turnstile token 为空',
      status: 'failed',
    });
    expect(result.code).toBe('manual_turnstile_required');
    expect(result.category).toBe('verification');
  });

  it('classifies cloudflare tunnel outage', () => {
    const result = classifyFailureReason({
      message: 'HTTP 530 Cloudflare Tunnel error | Error 1033',
      status: 'failed',
      httpStatus: 530,
    });
    expect(result.code).toBe('cloudflare_tunnel_unavailable');
    expect(result.category).toBe('network');
  });

  it('classifies token errors using status and message', () => {
    const result = classifyFailureReason({
      message: 'invalid access token',
      status: 'failed',
      httpStatus: 401,
    });
    expect(result.code).toBe('token_expired');
    expect(result.category).toBe('auth');
  });

  it('does not classify upstream request, capability, or billing failures as token expiration', () => {
    const requestValidation = classifyFailureReason({
      message: "Error code: 400 - {'error': {'code': 'invalid_argument', 'message': 'input token limit is 202752', 'type': 'invalid_request_error'}}",
      status: 'failed',
      httpStatus: 400,
    });
    const unsupportedModel = classifyFailureReason({
      message: 'HTTP 401 - Model minimax-m3-free is not supported for format openai',
      status: 'failed',
      httpStatus: 401,
    });
    const billing = classifyFailureReason({
      message: 'HTTP 401 - No payment method. Add a payment method here: https://example.com/billing',
      status: 'failed',
      httpStatus: 401,
    });

    expect(requestValidation.code).not.toBe('token_expired');
    expect(unsupportedModel.code).not.toBe('token_expired');
    expect(billing.code).not.toBe('token_expired');
  });

  it('classifies already checked in as state info', () => {
    const result = classifyFailureReason({
      message: '今天已经签到过啦',
      status: 'success',
    });
    expect(result.code).toBe('already_checked_in');
    expect(result.category).toBe('state');
  });

  it('classifies missing checkin endpoint as site capability issue', () => {
    const result = classifyFailureReason({
      message: 'checkin endpoint not found',
      status: 'skipped',
    });
    expect(result.code).toBe('checkin_not_supported');
    expect(result.category).toBe('site');
    expect(result.title).toBe('站点未开启签到');
  });

  it('classifies sub2api unsupported checkin message as site capability issue', () => {
    const result = classifyFailureReason({
      message: 'Check-in is not supported by Sub2API',
      status: 'failed',
    });
    expect(result.code).toBe('checkin_not_supported');
    expect(result.category).toBe('site');
  });
});
