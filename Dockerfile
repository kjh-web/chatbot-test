FROM python:3.11-slim

WORKDIR /app

# 필요한 시스템 패키지 설치 최소화
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    curl \
    git \
    python3-dev \
    python3-pip \
    default-jre \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 메모리 설정 최적화
ENV PYTHONUNBUFFERED=1
ENV PYTHONMALLOC=malloc
ENV MALLOC_TRIM_THRESHOLD_=65536
ENV PYTHONDONTWRITEBYTECODE=1

# requirements.txt 복사 및 의존성 설치
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 소스 코드 복사
COPY . /app/

# 환경 변수 설정
ENV PORT=8000

# 시작 스크립트에 실행 권한 부여
RUN chmod +x start.sh

# 포트 노출
EXPOSE 8000

# 직접 uvicorn 명령 실행
CMD ["./start.sh"] 