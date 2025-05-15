import { generateDummyPassword } from './db/utils';

export const isProductionEnvironment = process.env.NODE_ENV === 'production';
export const isDevelopmentEnvironment = process.env.NODE_ENV === 'development';
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT,
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

// API URL 설정
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// 개발 환경에서 로깅 제어 플래그
export const ENABLE_DEV_LOGGING = isDevelopmentEnvironment && process.env.ENABLE_DEV_LOGGING !== 'false';

// 세션 관련 설정
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30일
export const SESSION_UPDATE_AGE = 24 * 60 * 60; // 24시간
