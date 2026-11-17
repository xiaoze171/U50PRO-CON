import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractVerificationCode } from '../src/utils/format.js';

test('business notifications do not expose capacity, dates, references or links as verification codes', () => {
  for (const message of [
    '【业务通知】云盘定向流量500G-立即生效（当月有效）。',
    '【业务通知】套餐包含1024 MB，确认办理成功。',
    '【业务通知】套餐有效期至2026年11月30日。',
    '【业务通知】服务有效期：2026-11-30。',
    '【业务通知】已确认办理，业务编号：1234567890123456。',
    '【业务通知】支付成功，订单号：ABC12345，金额1000元。',
    '【安全通知】请登录 https://example.com/login/123456 确认您的账号。',
  ]) assert.equal(extractVerificationCode(message), '', message);
});

test('real codes survive numeric and alphanumeric extraction beside unrelated business values', () => {
  for (const [message, expected] of [
    ['验证码：032798，5分钟内有效。', '032798'],
    ['【服务】校验码 A1B2C3，您正在登录，请勿泄露。', 'A1B2C3'],
    ['Your verification code is x7K2p9. Valid for 5 minutes.', 'x7K2p9'],
    ['123456 用于本次登录，请勿告知他人。', '123456'],
    ['注册验证码：654321，活动有效期2026-11-30，登录后赠送500G空间。', '654321'],
    ['验证码：123456。详情 https://example.com/verify/876543 。', '123456'],
  ]) assert.equal(extractVerificationCode(message), expected, message);
});
