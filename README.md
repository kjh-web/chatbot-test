# 갤럭시 S25 챗봇

갤럭시 S25 매뉴얼에 대한 질문과 답변을 제공하는 챗봇 애플리케이션입니다.

## 구현 기능

1. **하이브리드 RAG 검색 시스템**
   - 벡터 검색(임베딩 기반)과 키워드 검색(BM25)을 결합
   - Cohere 임베딩 모델 사용
   - 텍스트와 이미지의 멀티모달 검색 지원
   - Supabase 벡터 데이터베이스 활용

2. **LangGraph 기반 대화 관리**
   - 컨텍스트 인식 대화 처리
   - 대화 이력 관리 및 활용
   - 검색 결과 순위화 및 필터링

3. **멀티모달 응답 생성**
   - 텍스트 응답 생성
   - 관련 이미지 추천 및 표시
   - 텍스트-이미지 관련성 분석

4. **Next.js 프론트엔드 구현**
   - 반응형 웹 디자인
   - 모바일 대응 UI
   - 멀티모달 입력 지원

5. **GPT 모델 변경 지원**
   - GPT-4o
   - GPT-4.1
   - GPT-4o mini

6. **채팅 이력 관리**
   - 사용자별 채팅 이력 저장
   - 대화 연속성 유지
   - 데이터베이스 연동 저장 시스템

## 배포 구성

프로젝트는 Render와 Next.js를 활용한 배포 구성으로 운영됩니다:

### Render + Next.js 구성

```
+------------------+     +------------------+     +----------------+
|                  |     |                  |     |                |
|  Next.js UI      +---->+  FastAPI (Render)+---->  LangGraph     |
|  (웹 인터페이스)   |     |  (백엔드 API)     |     |  (대화 관리)    |
|                  |     |                  |     |                |
+------------------+     +------------------+     +----------------+
                               |                        |
                         +----------------+     +----------------+
                         |                |     |                |
                         |  Supabase      |     |  OpenAI API    |
                         |  (벡터 DB)     |     |  (GPT 모델)    |
                         |                |     |                |
                         +----------------+     +----------------+
```

이 구성에서는:
- Next.js 프론트엔드와 FastAPI 백엔드가 모두 Render에 배포됩니다
- 사용자는 Next.js 웹 애플리케이션을 통해 챗봇과 상호작용합니다
- Render의 CI/CD 파이프라인을 통해 자동 배포됩니다

## 배포 방식

### Render 배포 (Next.js + FastAPI)
   - Next.js 프론트엔드를 Render에 배포
   - FastAPI 백엔드도 별도로 Render에 배포
   - 장점: 안정적인 프로덕션 환경, 자동 CI/CD 파이프라인
   - 주로 최종 사용자 서비스용으로 활용

### Docker 컨테이너화
   - 로컬 개발 환경 일관성
   - 멀티 스테이지 빌드
   - 모든 배포 환경에서 일관성 보장

## 구성 요소

1. **백엔드 (Python)**
   - `galaxy_chatbot.py`: LangGraph 기반 챗봇 코어 로직
   - `app.py`: FastAPI 기반 API 서버

2. **프론트엔드 (Next.js)**
   - `galaxy-web-ui/`: Next.js 웹 애플리케이션
   - 반응형 UI 컴포넌트
   - 멀티모달 입력 지원

3. **데이터베이스**
   - Supabase 벡터 저장소 연동
   - 사용자 세션 및 채팅 기록 관리

4. **CI/CD 설정**
   - 자동화된 배포 파이프라인
   - 환경별 설정 관리

## 주요 개선사항

1. **모델 변경 및 최적화**
   - GPT-4o, GPT-4.1, GPT-4o mini 모델 선택 지원
   - 응답 속도 최적화

2. **채팅 기록 관리 개선**
   - 세션 ID와 데이터베이스 ID 연동
   - 채팅 이력 저장 및 복원 기능

3. **오류 처리 강화**
   - PGRST116 오류 처리
   - 채팅 ID 관련 예외 처리
   - 네트워크 오류 관리

4. **UI/UX 개선**
   - 이미지 표시 및 연동 강화
   - 사용자 경험 최적화
   - 샘플 질문 관리
   - 메시지 편집 기능 제거로 UI 안정성 향상

## 환경 변수 설정

프로젝트를 실행하기 전에 다음 환경 변수를 설정해야 합니다:

### 백엔드 (`.env` 파일 생성)

```
# OpenAI API 키
OPENAI_API_KEY=your_openai_api_key_here

# Cohere API 키
COHERE_API_KEY=your_cohere_api_key_here

# Supabase 설정
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

### 프론트엔드 (`galaxy-web-ui/.env.local` 파일 생성)

```
# API URL (배포 시 변경)
NEXT_PUBLIC_API_URL=http://localhost:8000

# OpenAI API 키
OPENAI_API_KEY=your_openai_api_key_here

# Cohere API 키
COHERE_API_KEY=your_cohere_api_key_here

# Supabase 설정
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

## 설치 및 실행

### 백엔드

```bash
# 필요한 패키지 설치
pip install -r requirements.txt

# FastAPI 서버 실행
python app.py
```

### 프론트엔드

```bash
# galaxy-web-ui 디렉토리로 이동
cd galaxy-web-ui

# 필요한 패키지 설치
npm install

# 개발 서버 실행
npm run dev
```

### Docker 실행

```bash
# Docker 이미지 빌드
docker build -t galaxy-chatbot .

# Docker 컨테이너 실행
docker run -p 8000:8000 galaxy-chatbot
```

## 배포

### Render 배포 (Next.js + FastAPI)

1. FastAPI 백엔드 배포:
   - Render 대시보드에서 "Web Service" 생성
   - GitHub 저장소 연결
   - 환경 변수 설정
   - 빌드 명령: `pip install -r requirements.txt`
   - 시작 명령: `uvicorn app:app --host 0.0.0.0 --port $PORT`

2. Next.js 프론트엔드 배포:
   - Render 대시보드에서 "Static Site" 생성
   - GitHub 저장소의 `galaxy-web-ui` 디렉토리 지정
   - 빌드 명령: `npm install && npm run build`
   - 출력 디렉토리: `out`
   - 환경 변수로 백엔드 API URL 지정

## 기술 스택

- **백엔드**: Python, FastAPI, LangGraph, OpenAI API, Cohere API
- **프론트엔드**: Next.js, React, TypeScript
- **데이터베이스**: Supabase
- **배포**: Render, Docker

## 프로젝트 구조

```
galaxy-rag-chatbot/
├── app.py                  # FastAPI 서버
├── galaxy_chatbot.py       # 챗봇 코어 로직
├── requirements.txt        # Python 의존성
├── Dockerfile              # Docker 설정
├── docker-compose.yml      # Docker Compose 설정
├── render.yaml             # Render 배포 설정
├── galaxy-web-ui/          # Next.js 애플리케이션
│   ├── components/         # UI 컴포넌트
│   ├── app/                # 페이지 및 라우팅
│   ├── lib/                # 유틸리티 함수
│   └── package.json        # JS 의존성
└── README.md               # 프로젝트 문서
```