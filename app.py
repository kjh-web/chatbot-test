from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import re
import ast
import gc  # 가비지 컬렉션 임포트
import weakref
import logging
import platform  # 플랫폼 확인용

# Windows에서는 resource 모듈을 사용할 수 없으므로 조건부로 임포트
if platform.system() != "Windows":
    import resource  # 리소스 사용량 모니터링

# galaxy_chatbot.py의 핵심 기능 임포트
from galaxy_chatbot import (
    cohere_embeddings, 
    hybrid_retriever, 
    text_vectorstore, 
    image_vectorstore, 
    llm, 
    AgentState
)

# SearchDocumentsTool 클래스를 임포트하지 않고 필요한 기능만 재구현
from galaxy_chatbot import client, np

# 메모리 사용량 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="갤럭시 S25 매뉴얼 챗봇 API")

# CORS 설정 (Next.js 앱에서 API 호출 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 프로덕션에서는 실제 도메인으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 메모리 사용량 로깅 함수
def log_memory_usage(location=""):
    try:
        if platform.system() != "Windows":
            usage = resource.getrusage(resource.RUSAGE_SELF)
            memory_mb = usage.ru_maxrss / 1024  # KB를 MB로 변환
            logger.info(f"메모리 사용량 ({location}): {memory_mb:.2f} MB")
        else:
            # Windows 환경에서는 다른 방법으로 메모리 사용량 로깅
            import psutil
            process = psutil.Process(os.getpid())
            memory_mb = process.memory_info().rss / 1024 / 1024  # bytes를 MB로 변환
            logger.info(f"메모리 사용량 ({location}): {memory_mb:.2f} MB")
    except Exception as e:
        logger.error(f"메모리 사용량 로깅 오류: {str(e)}")

# 이미지 관련성 분석 함수 (SearchDocumentsTool에서 추출)
def analyze_image_relevance(image_url, query_text):
    try:
        query_embedding = cohere_embeddings.embed_query(query_text)
        
        img_embedding = None
        try:
            resp = client.table("image_embeddings").select("embedding,metadata").eq("metadata->>image_url", image_url).execute()
            if resp and resp.data and len(resp.data) > 0:
                if 'embedding' in resp.data[0]:
                    embedding_str = resp.data[0]['embedding']
                    if isinstance(embedding_str, str):
                        try:
                            embedding_str = embedding_str.replace(" ", "")
                            img_embedding = ast.literal_eval(embedding_str)
                        except:
                            print(f"임베딩 문자열 파싱 실패: {embedding_str[:50]}...")
                            img_embedding = None
                    else:
                        img_embedding = embedding_str
                metadata = resp.data[0].get('metadata', {})
        except Exception as e:
            print(f"이미지 임베딩 검색 오류: {str(e)}")
            metadata = {}
        
        # 임베딩 유사도 계산 (기본 점수 0.5)
        embedding_similarity = 0.5
        if img_embedding:
            try:
                # 코사인 유사도 계산
                norm_q = np.linalg.norm(query_embedding)
                norm_img = np.linalg.norm(img_embedding)
                if norm_q > 0 and norm_img > 0:
                    embedding_similarity = np.dot(query_embedding, img_embedding) / (norm_q * norm_img)
                    # 0~1 범위로 정규화
                    embedding_similarity = (embedding_similarity + 1) / 2
                    # numpy.float64를 Python float로 변환
                    embedding_similarity = float(embedding_similarity)
            except Exception as e:
                print(f"유사도 계산 오류: {str(e)}")
                embedding_similarity = 0.5
        
        # 위치 정보 추출 (URL 패턴 기반)
        vertical_position = 0.5  # 기본값 (중간)
        if "top" in image_url.lower() or "upper" in image_url.lower():
            vertical_position = 0.2  # 위쪽
        elif "bottom" in image_url.lower() or "lower" in image_url.lower():
            vertical_position = 0.8  # 아래쪽
        elif "mid" in image_url.lower() or "middle" in image_url.lower():
            vertical_position = 0.5  # 중간
        
        # 기본 결과 설정
        result = {
            "vertical_position": float(vertical_position),
            "relevance_score": float(embedding_similarity),
            "embedding_similarity": float(embedding_similarity),
            "metadata": metadata
        }
        
        # 메모리 정리
        del query_embedding
        del img_embedding
        
        return result
    except Exception as e:
        print(f"이미지 분석 오류: {str(e)}")
        return {
            "vertical_position": 0.5,  # 기본값
            "relevance_score": 0.5,  # 기본 관련성 점수
            "embedding_similarity": 0.5
        }
    finally:
        # 명시적 가비지 컬렉션
        gc.collect()

# 페이지의 모든 이미지 검색 함수
def get_all_page_images(page, query_text):
    try:
        # 해당 페이지의 모든 이미지 검색
        resp = client.table("image_embeddings").select("*").eq("metadata->>page", str(page)).execute()
        
        if not resp or not resp.data or len(resp.data) == 0:
            # URL 패턴으로 검색 시도
            resp = client.table("image_embeddings").select("*").ilike("metadata->>image_url", f"%p{page}%").execute()
            if not resp or not resp.data or len(resp.data) == 0:
                return []
        
        page_images = []
        for item in resp.data:
            if 'metadata' in item and item['metadata'] and 'image_url' in item['metadata']:
                img_url = item['metadata']['image_url']
                img_page = item['metadata'].get('page', page)
                
                # 이미지 관련성 분석
                img_analysis = analyze_image_relevance(img_url, query_text)
                
                # 이미지 정보 저장
                image_info = {
                    "url": img_url,
                    "page": img_page,
                    "is_page_match": True,  # 같은 페이지이므로 항상 True
                    "text_similarity": float(img_analysis["embedding_similarity"]),
                    "vertical_position": float(img_analysis["vertical_position"]),
                    "relevance_score": float(img_analysis["relevance_score"]),
                    "score": float(0.7 * img_analysis["relevance_score"] + 0.3)  # 점수 계산 방식 수정
                }
                
                page_images.append(image_info)
        
        # 관련성 점수 기준 내림차순 정렬
        page_images.sort(key=lambda x: x["relevance_score"], reverse=True)
        return page_images
        
    except Exception as e:
        print(f"페이지 이미지 검색 오류: {str(e)}")
        return []

# 직접 문서 검색 기능 구현 (_run 함수 대체)
def perform_search(query: str):
    """검색 기능 래퍼 함수"""
    log_memory_usage("검색 시작")
    
    normalized_query = query.strip().rstrip('.!?')
    
    debug_info = {
        "query": normalized_query,
        "results": [],
        "image_results": [],
        "page_info": {},
        "vertical_position": {}
    }
    
    try:
        # 1. 텍스트 검색 수행
        docs = hybrid_retriever.invoke(normalized_query)
        
        if not docs:
            return "매뉴얼에서 관련 정보를 찾을 수 없습니다.", debug_info
        
        # 2. 검색 결과에서 페이지 정보 추출
        page_info = {}
        page_numbers = []
        
        # 페이지 번호 직접 추출 (쿼리에서)
        extracted_page = None
        page_pattern = re.search(r'(?:페이지|page|p)?\s*(\d+)(?:페이지|쪽|page)?', normalized_query.lower())
        if page_pattern:
            extracted_page = page_pattern.group(1)
            debug_info["extracted_page"] = extracted_page
        
        # 검색 결과에서 페이지 정보 수집
        for rank, doc in enumerate(docs):
            doc_page = None
            
            # 메타데이터에서 페이지 번호 추출
            if "page" in doc.metadata:
                doc_page = str(doc.metadata["page"])
            elif "category" in doc.metadata and doc.metadata["category"]:
                if isinstance(doc.metadata["category"], str) and "p" in doc.metadata["category"].lower():
                    page_matches = re.findall(r'p(\d+)', doc.metadata["category"].lower())
                    if page_matches:
                        doc_page = page_matches[0]
            
            if doc_page:
                # 페이지별 점수 계산 (순위에 반비례)
                page_score = 1.0 / (rank + 1)
                
                # 쿼리에서 추출한 페이지와 일치하면 점수 가중치
                if extracted_page and doc_page == extracted_page:
                    page_score *= 1.5
                
                # 페이지 정보 저장
                if doc_page not in page_info:
                    page_info[doc_page] = {
                        "score": page_score,
                        "content": [doc.page_content]
                    }
                    page_numbers.append(doc_page)
                else:
                    page_info[doc_page]["score"] += page_score
                    page_info[doc_page]["content"].append(doc.page_content)
        
        # 페이지 점수 기준으로 정렬
        sorted_pages = sorted([(page, info["score"]) for page, info in page_info.items()], 
                            key=lambda x: x[1], reverse=True)
        top_pages = [page for page, _ in sorted_pages]
        
        # 디버그 정보에 페이지 정보 추가
        debug_info["page_numbers"] = top_pages
        debug_info["page_info"] = {page: " ".join(page_info[page]["content"])[:200] 
                                 for page in page_info}
        debug_info["page_scores"] = {page: float(page_info[page]["score"]) 
                                   for page in page_info}
        
        # 3. 이미지 검색 - 주요 페이지에 대한 이미지 가져오기
        all_images = []
        
        # 상위 페이지에 있는 모든 이미지 검색
        if top_pages:
            best_page = top_pages[0]
            # 해당 페이지의 모든 이미지 가져오기
            page_images = get_all_page_images(best_page, normalized_query)
            
            if page_images:
                # 최대 3개까지 이미지 선택
                best_images = page_images[:3]
                debug_info["best_images"] = best_images
                
                # 관련 텍스트 준비 (검색 결과 사용)
                result_texts = [doc.page_content for doc in docs[:3]]
                combined_text = " ".join(result_texts)
                
                # 각 이미지별 텍스트 관련성 점수 계산
                for img in best_images:
                    img_result = analyze_image_relevance(img["url"], combined_text)
                    img["text_relevance"] = float(img_result.get("relevance_score", 0.5))
                    img["relevance_score"] = float(img["text_relevance"])
        
        # 5. 최종 결과 구성
        result_text = ""
        
        # 참조 페이지 목록 저장
        reference_pages = []
        for doc in docs:
            if "page" in doc.metadata:
                page = str(doc.metadata["page"])
                if page not in reference_pages:
                    reference_pages.append(page)
        
        # 텍스트 결과 구성
        for i, doc in enumerate(docs[:5]):  # 최대 5개만 사용
            result_text += f"내용: {doc.page_content}\n"
            result_text += f"카테고리: {doc.metadata.get('category','없음')}\n"
            result_text += f"페이지: {doc.metadata.get('page','없음')}\n"
            result_text += "\n"
            
            # 디버그 정보 저장
            debug_info["results"].append({
                "rank": i+1,
                "source": doc.metadata.get("source", "알 수 없음"),
                "score": float(doc.metadata.get("score", 0)),
                "page": doc.metadata.get("page", "없음"),
                "category": doc.metadata.get("category", "없음"),
                "section": doc.metadata.get("section", "없음"),
                "preview": doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
            })
        
        # 참조 페이지 정보 추가
        if reference_pages:
            reference_pages.sort()
            debug_info["reference_pages"] = reference_pages

        log_memory_usage("검색 완료")
        
        # 결과 반환 전 임시 객체 정리
        del docs
        
        return result_text, debug_info
    except Exception as e:
        import traceback
        debug_info["error"] = str(e)
        debug_info["traceback"] = traceback.format_exc()
        return "검색 중 오류가 발생했습니다: " + str(e), debug_info
    finally:
        # 명시적 가비지 컬렉션
        gc.collect()

# 요청 모델 정의
class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = None
    debug_mode: Optional[bool] = False

# 응답 모델 정의
class ChatResponse(BaseModel):
    answer: str
    context: str
    images: Optional[List[Dict[str, Any]]] = None
    debug_info: Optional[Dict[str, Any]] = None

# 검색 요청 모델
class SearchRequest(BaseModel):
    query: str
    page_filter: Optional[str] = None
    limit: Optional[int] = 5

# 이미지 검색 요청 모델
class ImageSearchRequest(BaseModel):
    query: str
    page: Optional[str] = None
    limit: Optional[int] = 3

# 챗봇 대화 처리 엔드포인트
@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        # 래퍼 함수를 사용하여 검색 실행
        context, debug_info = perform_search(request.message)
        
        # 대화 히스토리 구성
        conversation_history = request.history if request.history else []
        
        # 프롬프트 구성
        conversation_context = ""
        if conversation_history:
            conversation_context = "이전 대화 내용:\n"
            for i, exchange in enumerate(conversation_history[-5:]):  
                conversation_context += f"[대화 {i+1}]\n"
                # 대화 히스토리 구조 확인 및 올바른 필드 접근
                if "user" in exchange and "ai" in exchange:
                    # user와 ai 필드 형식인 경우 (streamlit_app.py에서 보내는 형식)
                    conversation_context += f"사용자: {exchange.get('user', '')}\n"
                    conversation_context += f"도우미: {exchange.get('ai', '')}\n"
                elif "role" in exchange and "content" in exchange:
                    # role과 content 필드 형식인 경우
                    if exchange["role"] == "user":
                        conversation_context += f"사용자: {exchange.get('content', '')}\n"
                    elif exchange["role"] == "assistant":
                        conversation_context += f"도우미: {exchange.get('content', '')}\n"
                else:
                    # 기타 경우 (키가 없는 경우) - 기본 처리
                    user_msg = exchange.get('user', exchange.get('content', ''))
                    conversation_context += f"사용자: {user_msg}\n"
                    ai_msg = exchange.get('ai', '')
                    if ai_msg:
                        conversation_context += f"도우미: {ai_msg}\n"
        
        # 참조 페이지 추출
        reference_pages = []
        if "reference_pages" in debug_info:
            reference_pages = debug_info["reference_pages"]
        
        # 프롬프트 구성
        prompt = f"""
        당신은 삼성 갤럭시 S25의 친절하고 도움이 되는 가상 도우미입니다. 
        사용자의 질문에 대해 상세하고 유용한 정보를 제공하며, 필요한 경우 단계별 안내를 해주세요.
        기술적인 정보뿐만 아니라 실제 사용자가 이해하기 쉽고 도움이 되는 조언도 함께 제공해 주세요.
        친근하고 대화하듯 답변하되, 정확한 정보를 제공하는 것이 가장 중요합니다.

        대화 맥락 유지에 관한 안내:
        • 사용자의 질문이 짧거나 모호한 경우, 이전 대화 맥락을 고려해 답변해 주세요.
        • "이것은?", "어떻게?", "왜?" 같은 짧은 질문이나 이전 답변에서 언급된 용어나 개념에 대한 질문은 
          이전 대화 주제와 연결지어 해석하는 것이 자연스럽습니다.
        • 사용자의 이전 질문들과 당신의 답변을 함께 고려하여 연속성 있는 대화를 만들어 주세요.
        • 사용자가 새로운 주제로 전환하지 않는 한, 이전 대화의 맥락을 유지해 주세요.

        {conversation_context}

        참고할 정보는 다음과 같습니다:
        {context}

        사용자 질문: {request.message}

        위 참고 정보를 바탕으로 상세하고 친절하게 답변해 주세요.  
        내용이 부족하다면 관련된 추가 팁이나 조언도 함께 제공하세요.
        """
        
        # LLM 응답 생성
        response = llm.invoke(prompt)
        answer = response.content
        
        # 매뉴얼 페이지 참조 문구 추가 (이미 포함되어 있지 않은 경우에만)
        if reference_pages and "매뉴얼의 관련 섹션" not in answer and "더 알고 싶으시면" not in answer:
            reference_pages.sort()
            
            # 문맥에 맞는 자연스러운 안내문 생성
            if "설정" in request.message.lower() or "방법" in request.message.lower():
                reference_text = "\n\n💡 이 설정에 대해 더 자세히 알고 싶으시면 매뉴얼의 관련 섹션을 참고해보세요."
            elif "기능" in request.message.lower() or "사용" in request.message.lower():
                reference_text = "\n\n💡 이 기능의 추가 옵션과 활용법은 매뉴얼에서 더 자세히 확인하실 수 있습니다."
            else:
                reference_text = "\n\n💡 더 자세한 정보가 필요하시면 매뉴얼의 관련 섹션을 참고해보세요."
            
            answer += reference_text
        
        # 이미지 정보 추가
        images = []
        if debug_info and "best_images" in debug_info and debug_info["best_images"]:
            images = debug_info["best_images"]
            
            # 추가 이미지 정보 텍스트도 응답에 포함
            img_info_text = "\n\n"
            
            for i, img in enumerate(images[:3]):  # 최대 3개까지만 표시
                relevance_score = float(img.get('text_relevance', img.get('relevance_score', 0)))
                match_score = float(img.get('score', 0))
                
                # 이미지 간 공백 처리
                if i > 0:
                    img_info_text += "\n\n"
                
                # 이미지 태그와 URL - Next.js가 인식할 수 있는 정확한 형식
                # 첫 번째 이미지이고 여러 이미지가 있는 경우 👑 표시 추가
                if i == 0 and len(images) > 1:
                    img_info_text += f"[이미지 {i+1}] 👑 텍스트와 가장 관련성 높은 이미지\n"
                else:
                    img_info_text += f"[이미지 {i+1}]\n"
                
                # URL은 반드시 별도 줄에 단독으로 배치 (Next.js 인식용)
                img_info_text += f"{img['url']}\n\n"
                
                # 메타데이터는 URL 뒤에 별도로 표시
                img_info_text += f"페이지: {img.get('page', '알 수 없음')}\n"
                img_info_text += f"관련성 점수: {relevance_score:.4f}, 매칭 점수: {match_score:.4f}"
                
                # 이미지 관련성에 대한 설명 추가
                if relevance_score < 0.65 or match_score < 0.7:
                    img_info_text += " (낮은 관련성)"
                elif relevance_score >= 0.8:
                    img_info_text += " (높은 관련성)"
                else:
                    img_info_text += " (중간 관련성)"
            
            answer += img_info_text
        
        # 디버그 모드가 아니면 debug_info를 None으로 설정
        if not request.debug_mode:
            debug_info = None
        
        return ChatResponse(
            answer=answer,
            context=context,
            images=[{
                "url": img["url"],
                "page": str(img.get("page", "")),
                "relevance_score": float(img.get("relevance_score", 0.5)),
                "match_score": float(img.get("score", 0.5)),
                "text_relevance": float(img.get("text_relevance", 0.5))
            } for img in images],
            debug_info=debug_info
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"오류 발생: {str(e)}")

# 텍스트 검색 엔드포인트
@app.post("/search")
async def search(request: SearchRequest):
    try:
        # 쿼리 정규화
        normalized_query = request.query.strip().rstrip('.!?')
        
        # 하이브리드 검색기 사용
        docs = hybrid_retriever.invoke(normalized_query)
        
        # 페이지 필터 적용 (선택 사항)
        if request.page_filter:
            docs = [doc for doc in docs if doc.metadata.get("page") == request.page_filter]
        
        # 결과 제한
        if request.limit and request.limit < len(docs):
            docs = docs[:request.limit]
        
        # 결과 구성
        results = []
        for doc in docs:
            results.append({
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": float(doc.metadata.get("score", 0))
            })
        
        return {"results": results}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"검색 오류: {str(e)}")

# 이미지 검색 엔드포인트
@app.post("/image-search")
async def image_search(request: ImageSearchRequest):
    try:
        # 페이지 기반 이미지 검색
        if request.page:
            images = get_all_page_images(request.page, request.query)
            
            # 결과 제한
            if request.limit and request.limit < len(images):
                images = images[:request.limit]
            
            return {"images": images}
        
        # 쿼리 기반 이미지 검색
        else:
            # 쿼리 임베딩 생성
            query_embedding = cohere_embeddings.embed_query(request.query)
            
            # 이미지 벡터 검색
            docs = image_vectorstore.similarity_search_by_vector(
                query_embedding,
                k=request.limit or 3
            )
            
            # 결과 구성
            images = []
            for doc in docs:
                if 'image_url' in doc.metadata:
                    # 이미지 관련성 분석
                    img_analysis = analyze_image_relevance(
                        doc.metadata['image_url'], 
                        request.query
                    )
                    
                    images.append({
                        "url": doc.metadata['image_url'],
                        "page": doc.metadata.get('page', 'unknown'),
                        "relevance_score": float(img_analysis["relevance_score"]),
                        "vertical_position": float(img_analysis["vertical_position"]),
                        "metadata": doc.metadata
                    })
            
            return {"images": images}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이미지 검색 오류: {str(e)}")

# 상태 확인 엔드포인트
@app.get("/health")
async def health_check():
    return {"status": "healthy", "message": "갤럭시 S25 챗봇 API가 정상 작동 중입니다."}

# 루트 경로 핸들러 추가
@app.get("/")
async def read_root():
    return {
        "message": "갤럭시 S25 매뉴얼 챗봇 API",
        "version": "1.0.0",
        "endpoints": {
            "chat": "/chat - POST 요청으로 챗봇과 대화",
            "search": "/search - POST 요청으로 매뉴얼 검색",
            "image_search": "/image-search - POST 요청으로 이미지 검색",
            "health": "/health - GET 요청으로 API 상태 확인"
        },
        "docs": "/docs - API 문서 확인"
    }

# 각 요청 처리 후 메모리 정리를 위한 이벤트 핸들러
@app.middleware("http")
async def clean_memory_after_request(request, call_next):
    response = await call_next(request)
    gc.collect()
    return response

# 직접 실행 시 서버 구동
if __name__ == "__main__":
    # 환경 변수에서 포트 읽기 (없으면 기본값 8000 사용)
    port = int(os.environ.get("PORT", 8000))
    
    # 서버 시작
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)