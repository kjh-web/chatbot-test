'use server';

import { z } from 'zod';

import { createUser, getUser } from '@/lib/db/queries';
import { ENABLE_DEV_LOGGING } from '@/lib/constants';

import { signIn } from './auth';

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// 로깅 유틸리티 함수
const logInfo = (message: string, ...args: any[]) => {
  if (process.env.NODE_ENV === 'development' && ENABLE_DEV_LOGGING !== false) {
    console.log(message, ...args);
  }
};

const logError = (message: string, error: any) => {
  // 오류 로그는 항상 출력 (보안/디버깅에 중요)
  console.error(message, error);
};

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data' | 'account_not_found';
  error?: string;
  timestamp?: number;
}

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    // 사용자 존재 여부 확인
    const existingUsers = await getUser(validatedData.email);
    
    // 계정이 존재하지 않는 경우
    if (existingUsers.length === 0) {
      console.log('[LOGIN] 계정을 찾을 수 없음:', validatedData.email);
      return { 
        status: 'account_not_found',
        error: '등록된 계정을 찾을 수 없습니다.',
        timestamp: Date.now()
      };
    }
    
    // 계정이 존재하면 로그인 시도
    try {
      const result = await signIn('credentials', {
        email: validatedData.email,
        password: validatedData.password,
        redirect: false,
      });
      
      if (result?.error) {
        console.log('[LOGIN] 로그인 실패 (인증 오류):', validatedData.email, result.error);
        return { 
          status: 'failed', 
          error: '계정 정보가 일치하지 않습니다.',
          timestamp: Date.now()
        };
      }
      
      console.log('[LOGIN] 로그인 성공:', validatedData.email);
      return { 
        status: 'success',
        timestamp: Date.now()
      };
    } catch (signInError) {
      // 로그인 실패 (비밀번호 오류)
      console.log('[LOGIN] 로그인 실패 (비밀번호 오류):', validatedData.email, signInError);
      return { 
        status: 'failed', 
        error: '계정 정보가 일치하지 않습니다.',
        timestamp: Date.now()
      };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        status: 'invalid_data',
        timestamp: Date.now()
      };
    }

    // 기타 오류 처리
    logError('[LOGIN] 예상치 못한 오류:', error);
    return { 
      status: 'failed',
      error: '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      timestamp: Date.now()
    };
  }
};

export interface RegisterActionState {
  status:
    | 'idle'
    | 'in_progress'
    | 'success'
    | 'failed'
    | 'user_exists'
    | 'invalid_data'
    | 'database_error';
  error?: string;
  timestamp?: number;
}

// 회원가입 제출 방지를 위한 플래그 (중복 제출 방지)
let isRegistrationInProgress = false;
// 마지막 처리된 이메일 추적 (중복 방지)
let lastProcessedEmail = '';

export const register = async (
  state: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    // 상태가 이미 성공 상태라면 중복 실행 방지
    if (state.status === 'success') {
      console.log('[REGISTER] 이미 성공 상태, 중복 실행 방지');
      return { 
        ...state,
        status: 'success',
        timestamp: Date.now() // 타임스탬프 업데이트하여 클라이언트에서 변경 감지하도록
      };
    }
    
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });
    
    // 같은 이메일로 최근에 처리된 요청이 있는지 확인
    if (lastProcessedEmail === validatedData.email && state.status !== 'idle') {
      console.log('[REGISTER] 같은 이메일로 진행 중, 중복 요청 방지');
      return state;
    }
    
    // 이미 진행 중인 등록이 있으면 중복 실행 방지
    if (isRegistrationInProgress) {
      console.log('[REGISTER] 이미 진행 중, 중복 실행 방지');
      return { status: 'in_progress' };
    }
    
    console.log('[REGISTER] 새 요청 처리 시작:', validatedData.email);
    isRegistrationInProgress = true;
    lastProcessedEmail = validatedData.email;

    logInfo('회원가입 시도:', validatedData.email);
    
    // 사용자 중복 확인
    let existingUsers = [];
    try {
      existingUsers = await getUser(validatedData.email);
      logInfo('기존 사용자 검색 결과:', existingUsers.length > 0 ? '사용자 존재' : '사용자 없음');
    } catch (dbError) {
      logError('사용자 검색 중 오류:', dbError);
      isRegistrationInProgress = false;
      console.log('[REGISTER] 데이터베이스 오류로 종료');
      // 연결 실패 시 명확하게 오류 반환
      return { 
        status: 'database_error',
        error: '데이터베이스 연결 오류가 발생했습니다. 네트워크 연결을 확인해주세요.',
        timestamp: Date.now()
      };
    }

    if (existingUsers.length > 0) {
      logInfo('이미 존재하는 사용자');
      isRegistrationInProgress = false;
      console.log('[REGISTER] 사용자가 이미 존재해서 종료');
      return { 
        status: 'user_exists',
        timestamp: Date.now()
      };
    }
    
    // 계정 생성
    try {
      await createUser(validatedData.email, validatedData.password);
      logInfo('계정 생성 성공');
    } catch (createError) {
      logError('계정 생성 중 오류:', createError);
      isRegistrationInProgress = false;
      console.log('[REGISTER] 계정 생성 오류로 종료');
      
      // ECONNREFUSED 오류인 경우 더 명확한 메시지 제공
      if (createError instanceof Error && (createError as any).code === 'ECONNREFUSED') {
        return { 
          status: 'database_error', 
          error: '데이터베이스 서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.',
          timestamp: Date.now()
        };
      }
      
      return { 
        status: 'failed',
        timestamp: Date.now()
      };
    }
    
    // 로그인 시도
    try {
      const signInResult = await signIn('credentials', {
        email: validatedData.email,
        password: validatedData.password,
        redirect: false,
      });
      logInfo('로그인 성공');
      console.log('[REGISTER] 로그인 결과:', signInResult ? '성공' : '실패');
    } catch (signInError) {
      logError('로그인 중 오류:', signInError);
      console.log('[REGISTER] 로그인 오류 발생했지만 계속 진행');
      // 로그인 오류가 발생해도 계정은 생성되었으므로 성공으로 처리
    }

    isRegistrationInProgress = false;
    console.log('[REGISTER] 회원가입 성공으로 완료');
    return { 
      status: 'success',
      timestamp: Date.now()
    };
  } catch (error) {
    logError('회원가입 과정 중 오류:', error);
    isRegistrationInProgress = false;
    console.log('[REGISTER] 예상치 못한 오류로 종료');
    
    if (error instanceof z.ZodError) {
      logInfo('유효성 검증 오류:', error.errors);
      return { 
        status: 'invalid_data',
        timestamp: Date.now()
      };
    }

    return { 
      status: 'failed',
      timestamp: Date.now()
    };
  }
};
