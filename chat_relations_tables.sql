-- 채팅 및 메시지 관련 테이블 생성 스크립트
-- Supabase RAG 시스템을 위한 관계형 테이블 구조

-- 사용자 테이블 생성
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar NOT NULL UNIQUE,
  password varchar,  -- 실제 구현에서는 해시된 비밀번호 저장
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz
);

-- 채팅 테이블 생성
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  title varchar DEFAULT '새 대화',
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz,
  visibility varchar DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'shared'))
);

-- 메시지 테이블 생성
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE,
  role varchar NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  created_at timestamptz DEFAULT NOW(),
  parts jsonb,  -- 추가 메시지 구성요소 (코드 블록, 수식 등)
  attachments jsonb  -- 첨부 파일 정보
);

-- 투표 테이블 생성 (메시지 피드백)
CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  is_upvoted bool DEFAULT TRUE,
  created_at timestamptz DEFAULT NOW()
);

-- 사용자 매핑 테이블 생성 (외부 인증 시스템 연동)
CREATE TABLE IF NOT EXISTS user_mappings (
  id int4 PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  next_auth_id uuid NOT NULL,
  supabase_id uuid NOT NULL REFERENCES users(id),
  chat_id uuid REFERENCES chats(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz,
  email text,
  CONSTRAINT user_mappings_next_auth_id_chat_id_key UNIQUE (next_auth_id, chat_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_votes_message_id ON votes(message_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_supabase_id ON user_mappings(supabase_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_next_auth_id ON user_mappings(next_auth_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);

-- 함수: 채팅 내역 조회
CREATE OR REPLACE FUNCTION get_chat_history(chat_id_param uuid)
RETURNS TABLE (
  id uuid,
  role varchar,
  content text,
  created_at timestamptz,
  parts jsonb
)
LANGUAGE sql
AS $$
  SELECT id, role, content, created_at, parts
  FROM messages
  WHERE chat_id = chat_id_param
  ORDER BY created_at ASC;
$$;

-- 함수: 사용자의 최근 채팅 목록 조회
CREATE OR REPLACE FUNCTION get_recent_chats(user_id_param uuid, limit_param int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  title varchar,
  created_at timestamptz,
  updated_at timestamptz,
  message_count bigint,
  last_message text
)
LANGUAGE sql
AS $$
  SELECT 
    c.id, 
    c.title, 
    c.created_at, 
    c.updated_at,
    COUNT(m.id) AS message_count,
    (
      SELECT content 
      FROM messages 
      WHERE chat_id = c.id 
      ORDER BY created_at DESC 
      LIMIT 1
    ) AS last_message
  FROM chats c
  LEFT JOIN messages m ON c.id = m.chat_id
  WHERE c.user_id = user_id_param
  GROUP BY c.id, c.title, c.created_at, c.updated_at
  ORDER BY c.updated_at DESC
  LIMIT limit_param;
$$;

-- 함수: 새 메시지가 추가될 때 채팅 updated_at 업데이트
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chats
  SET updated_at = NOW()
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성
CREATE TRIGGER update_chat_timestamp_trigger
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_chat_timestamp();

-- 채팅-메시지-임베딩 연결 뷰
CREATE OR REPLACE VIEW chat_messages_embeddings AS
SELECT
  c.id AS chat_id,
  c.title AS chat_title,
  c.user_id,
  m.id AS message_id,
  m.role,
  m.content,
  m.created_at AS message_created_at,
  e.id AS embedding_id,
  e.similarity
FROM chats c
JOIN messages m ON c.id = m.chat_id
LEFT JOIN (
  SELECT 
    id, 
    content, 
    metadata->>'message_id' AS message_id,
    metadata->>'similarity' AS similarity
  FROM text_embeddings
  WHERE metadata->>'message_id' IS NOT NULL
) e ON m.id::text = e.message_id;

-- 권한 설정 (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- 사용자 테이블 정책
CREATE POLICY "Users can only see their own data" 
  ON users 
  FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can only update their own data" 
  ON users 
  FOR UPDATE 
  USING (auth.uid() = id);

-- 채팅 테이블 정책
CREATE POLICY "Users can select their own chats" 
  ON chats 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chats" 
  ON chats 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chats" 
  ON chats 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chats" 
  ON chats 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- 메시지 테이블 정책
CREATE POLICY "Users can select messages in their chats" 
  ON messages 
  FOR SELECT 
  USING (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert messages to their chats" 
  ON messages 
  FOR INSERT 
  WITH CHECK (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()));

CREATE POLICY "Users can update messages in their chats" 
  ON messages 
  FOR UPDATE 
  USING (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete messages in their chats" 
  ON messages 
  FOR DELETE 
  USING (chat_id IN (SELECT id FROM chats WHERE user_id = auth.uid()));

-- 임베딩-메시지 참조 관계 예시
COMMENT ON TABLE text_embeddings IS '문서 텍스트 임베딩 테이블 - 메시지와 연결하려면 metadata에 message_id 필드를 추가하세요';

-- 메타데이터 예시 코멘트
COMMENT ON COLUMN text_embeddings.metadata IS '
메타데이터 예시:
{
  "source": "document",
  "page": "5",
  "category": "tutorial",
  "message_id": "uuid-of-message"  <- 이 필드를 통해 메시지와 연결
}
';

-- 샘플 데이터 (테스트용)
-- INSERT INTO users (email) VALUES ('test@example.com');
-- INSERT INTO chats (user_id, title) 
--   SELECT id, '샘플 대화' FROM users WHERE email='test@example.com';
-- INSERT INTO messages (chat_id, role, content)
--   SELECT c.id, 'user', '안녕하세요, RAG 시스템에 대해 알려주세요.'
--   FROM chats c JOIN users u ON c.user_id = u.id WHERE u.email='test@example.com';
-- INSERT INTO messages (chat_id, role, content)
--   SELECT c.id, 'assistant', 'RAG(Retrieval Augmented Generation)는 정보 검색과 생성 모델을 결합한 시스템입니다...'
--   FROM chats c JOIN users u ON c.user_id = u.id WHERE u.email='test@example.com'; 