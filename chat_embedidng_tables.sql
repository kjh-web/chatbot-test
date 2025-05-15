-- 벡터 익스텐션 활성화 (이미 존재하면 건너뜀)
CREATE EXTENSION IF NOT EXISTS vector;

-- 텍스트 임베딩을 저장할 기본 테이블 재정의 (기존 테이블이 있으면 오류가 발생할 수 있음)
CREATE TABLE IF NOT EXISTS text_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text,                  -- 텍스트 내용
  metadata jsonb,                -- 메타데이터 (출처, 페이지 번호 등)
  embedding vector(1536)         -- 코히어 임베딩 벡터 (1536 차원)
);

-- 이미지 임베딩을 저장할 테이블 생성
CREATE TABLE IF NOT EXISTS image_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text,                  -- 이미지 설명 텍스트
  metadata jsonb,                -- 메타데이터 (출처, 페이지 번호, 그림 번호 등)
  image_url text,                -- 이미지 URL 저장 (선택 사항)
  embedding vector(1536)         -- 코히어 임베딩 벡터 (1536 차원)
);

-- 텍스트 임베딩 인덱스 생성
CREATE INDEX IF NOT EXISTS on_text_embeddings_embedding ON text_embeddings 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 이미지 임베딩 인덱스 생성
CREATE INDEX IF NOT EXISTS on_image_embeddings_embedding ON image_embeddings 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 텍스트 임베딩 검색 함수
  CREATE OR REPLACE FUNCTION match_text_embeddings(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    similarity float
  )
  LANGUAGE sql STABLE
  AS $$
    SELECT
      id,
      content,
      metadata,
      1 - (embedding <=> query_embedding) AS similarity
    FROM text_embeddings
    WHERE 1 - (embedding <=> query_embedding) > match_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
  $$; 

  -- 이미지 임베딩 검색 함수
  CREATE OR REPLACE FUNCTION match_image_embeddings(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    image_url text,
    similarity float
  )
  LANGUAGE sql STABLE
  AS $$
    SELECT
      id,
      content,
      metadata,
      image_url,
      1 - (embedding <=> query_embedding) AS similarity
    FROM image_embeddings
    WHERE 1 - (embedding <=> query_embedding) > match_threshold
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
  $$; 

  -- 이미지 메타데이터 필터링을 포함한 검색 함수
  CREATE OR REPLACE FUNCTION match_image_embeddings_with_filter(
    query_embedding vector(1536),
    filter_key text,
    filter_value text,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    image_url text,
    similarity float
  )
  LANGUAGE sql STABLE
  AS $$
    SELECT
      id,
      content,
      metadata,
      image_url,
      1 - (embedding <=> query_embedding) AS similarity
    FROM image_embeddings
    WHERE 1 - (embedding <=> query_embedding) > match_threshold
      AND metadata->>filter_key = filter_value
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
  $$;

  -- 통합 검색 함수: 텍스트와 이미지 임베딩을 모두 검색
  CREATE OR REPLACE FUNCTION match_unified_embeddings(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    image_url text,
    similarity float,
    source text  -- 출처 테이블 표시 ('text' 또는 'image')
  )
  LANGUAGE plpgsql
  AS $$
  DECLARE
    text_limit integer;
    image_limit integer;
    total_image_count integer;
  BEGIN
    -- 각 소스별 최대 결과 수 설정 (텍스트 70%, 이미지 30%)
    text_limit := CEIL(match_count * 0.7)::int;
    image_limit := CEIL(match_count * 0.3)::int;
    
    -- 이미지 데이터 개수 확인 (디버깅 목적)
    SELECT COUNT(*) INTO total_image_count FROM image_embeddings 
    WHERE 1 - (embedding <=> query_embedding) > match_threshold;
    
    RAISE NOTICE 'Total image count for query: %', total_image_count;

    -- 텍스트와 이미지 검색 결과를 UNION ALL로 통합하고 최종적으로 유사도 기준 정렬
    RETURN QUERY
    (
      -- 텍스트 임베딩 검색 결과 
      SELECT 
        te.id,
        te.content,
        te.metadata,
        NULL::text as image_url,
        1 - (te.embedding <=> query_embedding) AS similarity,
        'text'::text as source
      FROM text_embeddings te
      WHERE 1 - (te.embedding <=> query_embedding) > match_threshold
      ORDER BY 1 - (te.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT text_limit
    )
    
    UNION ALL
    
    (
      -- 이미지 임베딩 검색 결과 - 조건 개선
      SELECT 
        ie.id,
        ie.content,
        ie.metadata,
        CASE 
          WHEN ie.image_url IS NULL OR TRIM(ie.image_url) = '' OR LOWER(TRIM(ie.image_url)) = 'none' THEN NULL
          ELSE ie.image_url
        END as image_url,
        1 - (ie.embedding <=> query_embedding) AS similarity,
        'image'::text as source  -- 명시적으로 'image'로 설정
      FROM image_embeddings ie
      WHERE 1 - (ie.embedding <=> query_embedding) > match_threshold
        -- 메타데이터에 type=image가 있거나 이미지 URL이 있는 경우 포함
        AND (
          (ie.metadata->>'type' = 'image' OR ie.metadata->>'category' = 'figure')
          OR (ie.image_url IS NOT NULL AND LENGTH(ie.image_url) > 5)
        )
      ORDER BY 1 - (ie.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT image_limit
    )
    
    -- 최종적으로 유사도 기준으로 정렬 (중요)
    ORDER BY similarity DESC
    LIMIT match_count;
  END;
  $$;

  -- 메타데이터 필터링이 포함된 통합 검색 함수
  CREATE OR REPLACE FUNCTION match_unified_embeddings_with_filter(
    query_embedding vector(1536),
    filter_key text,
    filter_value text,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    image_url text,
    similarity float,
    source text  -- 출처 테이블 표시 ('text' 또는 'image')
  )
  LANGUAGE plpgsql
  AS $$
  DECLARE
    text_limit integer;
    image_limit integer;
  BEGIN
    -- 각 소스별 최대 결과 수 설정 (텍스트 70%, 이미지 30%)
    text_limit := CEIL(match_count * 0.7)::int;
    image_limit := CEIL(match_count * 0.3)::int;
    
    -- 텍스트와 이미지 검색 결과를 UNION ALL로 통합하고 최종적으로 유사도 기준 정렬
    RETURN QUERY
    (
      -- 텍스트 임베딩 검색 결과 (필터 적용)
      SELECT 
        te.id,
        te.content,
        te.metadata,
        NULL::text as image_url,
        1 - (te.embedding <=> query_embedding) AS similarity,
        'text'::text as source
      FROM text_embeddings te
      WHERE 1 - (te.embedding <=> query_embedding) > match_threshold
        AND te.metadata->>filter_key = filter_value
      ORDER BY 1 - (te.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT text_limit
    )
    
    UNION ALL
    
    (
      -- 이미지 임베딩 검색 결과 (필터 적용) - 조건 개선
      SELECT 
        ie.id,
        ie.content,
        ie.metadata,
        CASE 
          WHEN ie.image_url IS NULL OR TRIM(ie.image_url) = '' OR LOWER(TRIM(ie.image_url)) = 'none' THEN NULL
          ELSE ie.image_url
        END as image_url,
        1 - (ie.embedding <=> query_embedding) AS similarity,
        'image'::text as source
      FROM image_embeddings ie
      WHERE 1 - (ie.embedding <=> query_embedding) > match_threshold
        AND ie.metadata->>filter_key = filter_value
        -- 메타데이터에 type=image가 있거나 이미지 URL이 있는 경우 포함
        AND (
          (ie.metadata->>'type' = 'image' OR ie.metadata->>'category' = 'figure')
          OR (ie.image_url IS NOT NULL AND LENGTH(ie.image_url) > 5)
        )
      ORDER BY 1 - (ie.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT image_limit
    )
    
    -- 최종적으로 유사도 기준으로 정렬
    ORDER BY similarity DESC
    LIMIT match_count;
  END;
  $$;

  -- 특정 소스에서만 검색하는 통합 검색 함수
  CREATE OR REPLACE FUNCTION match_unified_embeddings_by_source(
    query_embedding vector(1536),
    source_type text,  -- 'text' 또는 'image'
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10
  )
  RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    image_url text,
    similarity float,
    source text
  )
  LANGUAGE plpgsql STABLE
  AS $$
  DECLARE
    text_limit integer;
    image_limit integer;
  BEGIN
    text_limit := CEIL(match_count * 0.7)::int;
    image_limit := CEIL(match_count * 0.3)::int;

    IF source_type = 'text' THEN
      RETURN QUERY
      SELECT
        te.id,
        te.content,
        te.metadata,
        null::text as image_url,
        1 - (te.embedding <=> query_embedding) AS similarity,
        'text'::text as source
      FROM text_embeddings te
      WHERE 1 - (te.embedding <=> query_embedding) > match_threshold
      ORDER BY 1 - (te.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT match_count;
      
    ELSIF source_type = 'image' THEN
      RETURN QUERY
      SELECT
        ie.id,
        ie.content,
        ie.metadata,
        CASE 
          WHEN ie.image_url IS NULL OR TRIM(ie.image_url) = '' OR LOWER(TRIM(ie.image_url)) = 'none' THEN NULL
          ELSE ie.image_url
        END as image_url,
        1 - (ie.embedding <=> query_embedding) AS similarity,
        'image'::text as source
      FROM image_embeddings ie
      WHERE 1 - (ie.embedding <=> query_embedding) > match_threshold
        -- 메타데이터에 type=image가 있거나 이미지 URL이 있는 경우 포함
        AND (
          (ie.metadata->>'type' = 'image' OR ie.metadata->>'category' = 'figure')
          OR (ie.image_url IS NOT NULL AND LENGTH(ie.image_url) > 5)
        )
      ORDER BY 1 - (ie.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT match_count;
      
    ELSE
      -- 기본값: 두 테이블 모두 검색
      RETURN QUERY
      (SELECT
        te.id,
        te.content,
        te.metadata,
        null::text as image_url,
        1 - (te.embedding <=> query_embedding) AS similarity,
        'text'::text as source
      FROM text_embeddings te
      WHERE 1 - (te.embedding <=> query_embedding) > match_threshold
      ORDER BY 1 - (te.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT text_limit)
      
      UNION ALL
      
      (SELECT
        ie.id,
        ie.content,
        ie.metadata,
        CASE 
          WHEN ie.image_url IS NULL OR TRIM(ie.image_url) = '' OR LOWER(TRIM(ie.image_url)) = 'none' THEN NULL
          ELSE ie.image_url
        END as image_url,
        1 - (ie.embedding <=> query_embedding) AS similarity,
        'image'::text as source
      FROM image_embeddings ie
      WHERE 1 - (ie.embedding <=> query_embedding) > match_threshold
        -- 메타데이터에 type=image가 있거나 이미지 URL이 있는 경우 포함
        AND (
          (ie.metadata->>'type' = 'image' OR ie.metadata->>'category' = 'figure')
          OR (ie.image_url IS NOT NULL AND LENGTH(ie.image_url) > 5)
        )
      ORDER BY 1 - (ie.embedding <=> query_embedding) DESC  -- 명시적 정렬
      LIMIT image_limit)
      
      ORDER BY similarity DESC
      LIMIT match_count;
    END IF;
  END;
  $$;

-- 텍스트 임베딩 테이블에 RLS 활성화
ALTER TABLE text_embeddings ENABLE ROW LEVEL SECURITY;

-- 이미지 임베딩 테이블에 RLS 활성화
ALTER TABLE image_embeddings ENABLE ROW LEVEL SECURITY;

-- 텍스트 임베딩 테이블 정책 설정
CREATE POLICY "Allow public read access for text_embeddings" 
  ON text_embeddings 
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow public insert access for text_embeddings" 
  ON text_embeddings 
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow public update access for text_embeddings" 
  ON text_embeddings 
  FOR UPDATE 
  USING (true);

CREATE POLICY "Allow public delete access for text_embeddings" 
  ON text_embeddings 
  FOR DELETE 
  USING (true);

-- 이미지 임베딩 테이블 정책 설정
CREATE POLICY "Allow public read access for image_embeddings" 
  ON image_embeddings 
  FOR SELECT 
  USING (true);

CREATE POLICY "Allow public insert access for image_embeddings" 
  ON image_embeddings 
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow public update access for image_embeddings" 
  ON image_embeddings 
  FOR UPDATE 
  USING (true);

CREATE POLICY "Allow public delete access for image_embeddings" 
  ON image_embeddings 
  FOR DELETE 
  USING (true); 