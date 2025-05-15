#!/bin/bash
# 메모리 제한 설정 (512MB로 제한)
export MALLOC_ARENA_MAX=2
export PYTHONMALLOC=malloc
export MALLOC_TRIM_THRESHOLD_=65536
export PYTHONDONTWRITEBYTECODE=1

# 파이썬 GC 최적화
export PYTHONGC=1

# PORT 환경 변수가 설정되어 있지 않으면 기본값 8000 사용
export PORT=${PORT:-8000}

# 메모리 사용량 정보 확인 (가능한 경우)
if [ -f /proc/meminfo ]; then
  echo "시작 시 메모리 상태:"
  grep -E "MemTotal|MemFree|MemAvailable" /proc/meminfo
fi

echo "애플리케이션 시작 중... (포트: $PORT)"

# 서버 실행 (단일 워커, 동시성 제한, 유휴 연결 타임아웃 설정)
exec uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1 --limit-concurrency 5 --timeout-keep-alive 30 