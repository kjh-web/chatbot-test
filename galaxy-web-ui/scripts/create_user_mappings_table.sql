-- 기존 테이블 삭제 (DROP 명령 추가)
DROP TABLE IF EXISTS user_mappings;

-- 사용자 ID 매핑 테이블 생성
CREATE TABLE IF NOT EXISTS user_mappings (
  id SERIAL PRIMARY KEY,
  next_auth_id UUID NOT NULL,
  supabase_id UUID NOT NULL,
  chat_id UUID, -- 채팅 ID 필드 추가 (NULL 허용)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  email TEXT
);

-- 복합 유니크 제약 조건 추가
ALTER TABLE user_mappings ADD CONSTRAINT user_mappings_next_auth_id_chat_id_key UNIQUE (next_auth_id, chat_id);

-- 인덱스 생성 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_user_mappings_next_auth_id ON user_mappings(next_auth_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_supabase_id ON user_mappings(supabase_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_chat_id ON user_mappings(chat_id);

-- 기본 테스트 데이터 추가 (기본 매핑, chat_id는 NULL)
INSERT INTO user_mappings (next_auth_id, supabase_id, chat_id, created_at, email)
VALUES 
  ('58e0ea15-3c59-46aa-bd69-3751bb0a0b4b', '0f705e4c-9270-4dd4-8b55-5f46ec04c196', NULL, NOW(), 'test@example.com')
ON CONFLICT (next_auth_id, chat_id) DO NOTHING;

-- 사용 방법 설명
-- 1. Supabase Studio에서 SQL 편집기로 이 파일을 실행하거나
-- 2. psql 명령어로 실행: psql -U <사용자명> -d <데이터베이스명> -a -f create_user_mappings_table.sql 