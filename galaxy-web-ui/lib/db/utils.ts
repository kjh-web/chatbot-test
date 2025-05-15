import { generateId } from 'ai';
import { genSaltSync, hashSync } from 'bcrypt-ts';

// 데이터베이스 연결 문자열 교정 함수
export function correctConnectionString(inputString: string): string {
  if (!inputString) return inputString;
  
  // 원래 연결 문자열 로깅 (일부 가려서)
  const hiddenString = inputString.replace(/:([^@]+)@/, ':****@');
  console.log('원본 연결 문자열 패턴:', hiddenString);
  
  // 대괄호 제거 (암호에 대괄호가 있는 경우)
  let corrected = inputString.replace(/\[([^\]]+)\]/g, '$1');
  
  // 마지막 슬래시가 없으면 추가
  if (corrected.includes('@') && !corrected.endsWith('/') && !corrected.includes('/', corrected.indexOf('@'))) {
    corrected += '/';
  }
  
  // PostgreSQL 프로토콜 확인
  if (!corrected.startsWith('postgres://') && corrected.startsWith('postgresql://')) {
    corrected = corrected.replace('postgresql://', 'postgres://');
    console.log('프로토콜 수정: postgresql:// → postgres://');
  }
  
  // 연결 문자열 구조 검증
  const connPattern = /^(postgres:\/\/|postgresql:\/\/)([^:]+):([^@]+)@([^:\/]+)(:[0-9]+)?(\/[^?]*)?(\?.*)?$/;
  const match = corrected.match(connPattern);
  
  if (match) {
    const [, protocol, username, password, host, port, database, params] = match;
    console.log('연결 문자열 파싱 성공:');
    console.log('  프로토콜:', protocol);
    console.log('  사용자:', username);
    console.log('  호스트:', host);
    console.log('  포트:', port || '기본값');
    console.log('  데이터베이스:', database || '기본값');
    console.log('  파라미터:', params || '없음');
    
    // 포트가 없으면 추가
    if (!port) {
      corrected = corrected.replace(host, host + ':5432');
      console.log('기본 포트 추가: 5432');
    }
    
    // SSL 모드가 없으면 추가
    if (params && !params.includes('sslmode=')) {
      corrected += (params.includes('?') ? '&' : '?') + 'sslmode=require';
      console.log('SSL 모드 추가: sslmode=require');
    } else if (!params) {
      corrected += '?sslmode=require';
      console.log('SSL 모드 추가: sslmode=require');
    }
  } else {
    console.error('연결 문자열 형식이 올바르지 않습니다:', hiddenString);
  }
  
  return corrected;
}

export function generateHashedPassword(password: string) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);

  return hash;
}

export function generateDummyPassword() {
  const password = generateId(12);
  const hashedPassword = generateHashedPassword(password);

  return hashedPassword;
}

// 데이터베이스 연결 검증 상태 전역 관리
// Node.js의 process 객체를 사용하여 애플리케이션 수명 주기 동안 상태 유지
// Next.js 개발 환경에서 HMR로 인한 모듈 재로드 문제를 해결
if (!process.env.DB_CONNECTION_VALIDATED) {
  process.env.DB_CONNECTION_VALIDATED = 'false';
}
if (!process.env.CONNECTION_STRING_LOGGED) {
  process.env.CONNECTION_STRING_LOGGED = 'false';
}

export const dbConnectionState = {
  isConnectionValidated: () => process.env.DB_CONNECTION_VALIDATED === 'true',
  setConnectionValidated: () => { process.env.DB_CONNECTION_VALIDATED = 'true'; },
  isConnectionStringLogged: () => process.env.CONNECTION_STRING_LOGGED === 'true',
  setConnectionStringLogged: () => { process.env.CONNECTION_STRING_LOGGED = 'true'; }
};
