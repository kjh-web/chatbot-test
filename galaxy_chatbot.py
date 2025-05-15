# 작성일자 : 2025-04-23

# 1. 필요한 라이브러리 임포트
# 1-1. 환경 변수 라이브러리 임포트
import uuid  # 고유 식별자 생성
import numpy as np  # 수치 연산 모듈
import json  # JSON 파싱용
import re  # 정규표현식 사용
import os  # 운영 체제 관련 함수 임포트
import ast  # 문자열을 파이썬 객체로 변환
from dotenv import load_dotenv  # .env 파일 로드

# 1-2. LangChain 라이브러리 임포트
from langchain_cohere import CohereEmbeddings  # Cohere 임베딩 모델
from langchain.schema import Document  # 문서 스키마
from supabase import create_client  # Supabase 클라이언트
from langchain_community.vectorstores.supabase import SupabaseVectorStore  # Supabase 벡터 저장소
from langchain_community.retrievers import BM25Retriever  # BM25 검색기
from langchain_openai import ChatOpenAI  # OpenAI 챗봇 모델

# 1-4. LangGraph 라이브러리 임포트
from typing import Dict, List, Optional, Any, Tuple  # 타입 힌트 임포트
from langchain_core.messages import HumanMessage, AIMessage  # 메시지 타입
from langchain.tools import BaseTool  # 도구 타입
from langgraph.checkpoint.memory import MemorySaver  # 메모리 저장 체크포인터
from langgraph.graph import START, END, MessagesState  # 그래프 상태
from langgraph.graph.state import StateGraph  # 그래프 상태

# 2. 환경 변수 설정
load_dotenv()  # .env 파일 로드
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
COHERE_API_KEY = os.environ.get("COHERE_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# 3. 검색기(Retriever) 설정
# 3-1. Cohere 임베딩 (텍스트 및 이미지/멀티모달 임베딩용)
cohere_embeddings = CohereEmbeddings(
    model="embed-v4.0",  # 임베딩 모델 이름
    cohere_api_key=COHERE_API_KEY)  # Cohere API 키 설정

# 3-2. Supabase 텍스트 벡터 스토어 설정
text_vectorstore = SupabaseVectorStore(
    client=client,  # Supabase 클라이언트 설정
    embedding=cohere_embeddings,  # 임베딩 모델 설정
    table_name="text_embeddings",  # 벡터 테이블 이름
    query_name="match_text_embeddings")  # 검색 쿼리 이름

# 3-3. Supabase 이미지 벡터 스토어 설정
image_vectorstore = SupabaseVectorStore(
    client=client,  # Supabase 클라이언트 설정
    embedding=cohere_embeddings,  # 임베딩 모델 설정
    table_name="image_embeddings",  # 벡터 테이블 이름
    query_name="match_image_embeddings")  # 검색 쿼리 이름

# 3-3. Supabase 벡터 스토어 검색기 정의
class EnhancedSupabaseRetriever:
    def __init__(self, client, embeddings, table_name="embeddings", query_name="match_embeddings", k=5):
        self.client = client  # Supabase 클라이언트 설정
        self.embeddings = embeddings  # 임베딩 모델 설정
        self.table_name = table_name  # 벡터 테이블 이름
        self.query_name = query_name  # 검색 쿼리 이름
        self.k = k  # 검색 결과 수
    
    def invoke(self, query, page_filter=None):
        try:
            query_embedding = self.embeddings.embed_query(query)  # 임베딩 생성
            matches = self.client.rpc(  # Supabase RPC 호출
                self.query_name,  # 검색 쿼리 이름
                    {"query_embedding": query_embedding,  # 임베딩 쿼리
                    "match_threshold": 0.5,  # 매칭 임계치
                    "match_count": self.k}).execute()  # 매칭 결과 수
            
            docs = []  # 결과 저장
            if matches.data:  # 결과가 있으면
                for i, match in enumerate(matches.data):  # 결과 반복
                    if 'content' in match and match['content']:  # 콘텐츠가 있으면
                        metadata = match.get('metadata', {}) or {}  # 메타데이터 추출
                        metadata['similarity'] = float(match.get('similarity', 0))  # 점수 추가
                        metadata['source'] = "Vector"  # 소스 정보 추가
                        
                        if page_filter:  # 페이지 필터 적용
                            page_info = str(metadata.get('page', ''))  # 페이지 정보 추출
                            if page_info != str(page_filter):  # 페이지 정보가 일치하지 않으면 건너뜀
                                continue  # 건너뜀
                        
                        docs.append(Document(  # 문서 추가
                            page_content=match['content'],  # 콘텐츠
                            metadata=metadata))  # 메타데이터
            
            return docs  # 결과 반환
        
        except Exception as e:  # 오류 처리
            return []  # 결과 반환
    
    def get_relevant_documents(self, query):  # 관련 문서 검색
        return self.invoke(query)  # 검색 결과 반환

resp = client.table("embeddings").select("content,metadata").execute()  # 벡터 테이블 조회
docs = [Document(page_content=item["content"], metadata=item.get("metadata", {})) for item in resp.data]  # 문서 리스트 생성
texts = [d.page_content for d in docs]  # 문서 내용 리스트 생성

vector_retriever = EnhancedSupabaseRetriever(  # 기본 유사도 검색기
    client=client,  # Supabase 클라이언트
    embeddings=cohere_embeddings,  # 임베딩 모델
    table_name="text_embeddings",  # 벡터 테이블 이름
    query_name="match_text_embeddings",  # 검색 쿼리 이름
    k=5)  # 검색 결과 수

# 3-4. BM25 키워드 검색기 생성
bm25 = BM25Retriever.from_texts(texts=texts, metadatas=[d.metadata for d in docs], k=5)  # BM25 검색기

# 3-5. 강화된 하이브리드 검색기 정의
class EnhancedEnsembleRetriever:
    def __init__(
        self,  # 초기화
        retrievers: List[Any],  # 검색기 목록
        weights: Optional[List[float]] = None,  # 가중치 목록
        verbose: bool = False):  # 디버깅 여부
        self.retrievers = retrievers  # 검색기 목록
        
        if weights is None:  # 가중치 목록이 없으면 균등 가중치 설정
            weights = [1.0 / len(retrievers) for _ in retrievers] # 균등 가중치 설정
        self.weights = weights  # 가중치 목록
        self.verbose = verbose  # 디버깅 여부
        self.retriever_names = ["BM25", "Vector"]  # 검색기 이름 목록 변경
    
    def invoke(self, query: str) -> List[Document]:  # 검색 쿼리 처리
        all_docs = []  # 모든 검색 결과 저장
        retriever_docs = {}  # 각 검색기별 문서 저장
        
        for i, retriever in enumerate(self.retrievers):  # 검색기 반복
            try:
                docs = retriever.invoke(query)  # 검색 쿼리 처리
                retriever_docs[self.retriever_names[i]] = []  # 검색기별 결과 저장
                
                for j, doc in enumerate(docs):  # 문서 반복
                    if doc.metadata is None: # 메타데이터가 없으면
                        doc.metadata = {}  # 빈 딕셔너리로 초기화
                        
                    doc.metadata["source"] = self.retriever_names[i]  # 소스 정보 추가
                    doc.metadata["original_rank"] = j  # 순위 정보 추가
                    doc.metadata["retriever_weight"] = float(self.weights[i])  # 가중치 정보 추가
                    
                    if self.retriever_names[i] == "Vector" and "similarity" in doc.metadata:  # Vector 검색일 경우
                        similarity = float(doc.metadata["similarity"])  # 유사도 점수 추출
                        if similarity > 0.5:  # 유사도 점수가 0.5보다 높으면
                            enhanced_score = 0.8 + (similarity - 0.5) * 0.8  # 유사도 점수 강화
                        else:
                            enhanced_score = similarity * 1.6  # 유사도 점수 강화
                        
                        doc.metadata["score"] = enhanced_score * self.weights[i]  # 가중치 적용
                        doc.metadata["original_similarity"] = similarity  # 원본 유사도 저장 (디버깅용)
                    else:
                        base_score = 1.0 / (1.0 + j)  # 순위 기반 점수
                        doc.metadata["score"] = float(base_score * self.weights[i])  # 순위 기반 점수 계산

                    retriever_docs[self.retriever_names[i]].append(doc)  # 검색기별 결과 저장
                        
                all_docs.append(docs)  # 검색 결과 저장
            
            except Exception as e:
                retriever_docs[self.retriever_names[i]] = []  # 검색기별 결과 초기화
                all_docs.append([])  # 검색 결과 초기화 
                continue
        
        all_documents = []  # 모든 문서 저장
        for i, docs in enumerate(all_docs):  # 검색 결과 반복
            for doc in docs:  # 문서 반복
                all_documents.append((doc, i))  # 문서와 검색기 인덱스 쌍 추가
        
        seen_contents = set()  # 중복 방지를 위한 집합
        final_docs = []  # 최종 결과 저장
        
        for doc, retriever_idx in all_documents:  # 문서와 검색기 인덱스 쌍 반복
            content_hash = hash(doc.page_content)  # 중복 방지를 위한 해시 값
    
            if content_hash in seen_contents: continue  # 중복 방지
            seen_contents.add(content_hash)  # 중복 방지
            base_score = 1.0 / (1.0 + doc.metadata["original_rank"])  # 원본 순위 기반 점수
            weighted_score = base_score * self.weights[retriever_idx]  # 검색기 가중치 적용
            
            doc.metadata["score"] = weighted_score  # 점수 저장
            final_docs.append(doc)  # 최종 결과 추가
    
        final_docs.sort(key=lambda x: x.metadata["score"], reverse=True)  # 점수 순으로 정렬
        result_docs = []  # 검색 결과 저장
        used_contents = set()  # 중복 방지를 위한 집합
        
        for source in self.retriever_names:
            if source in retriever_docs and retriever_docs[source]:  # 검색기별 결과가 있으면
                source_docs = sorted(retriever_docs[source],  # 점수 순으로 정렬
                                   key=lambda x: x.metadata["score"], # 점수 순으로 정렬
                                   reverse=True)  # 내림차순 정렬
                
                for doc in source_docs:  # 검색기별 결과 반복
                    content_hash = hash(doc.page_content)  # 중복 방지를 위한 해시 값
                    
                    if content_hash not in used_contents:  # 중복되지 않으면
                        result_docs.append(doc)  # 검색 결과 추가
                        used_contents.add(content_hash)  # 중복 방지
                        break  # 중복 방지
        
        for doc in final_docs:  # 최종 결과 반복
            content_hash = hash(doc.page_content)  # 중복 방지를 위한 해시 값
            
            if content_hash not in used_contents and len(result_docs) < 5:  # 중복되지 않고 결과 수가 5개 미만이면
                result_docs.append(doc)  # 검색 결과 추가
                used_contents.add(content_hash)  # 중복 방지    
        
        result_docs.sort(key=lambda x: x.metadata["score"], reverse=True)  # 점수 순으로 정렬
        return result_docs[:5]  # 최대 5개 결과 반환

# 3-6. 하이브리드 검색기 설정
hybrid_retriever = EnhancedEnsembleRetriever(
    retrievers=[bm25, vector_retriever],  # 두 개의 검색기 사용
    weights=[0.3, 0.7],  # 가중치 설정 - 벡터 검색 가중치 0.7, BM25 0.3
    verbose=False)  # 디버깅 정보 비활성화

# 4. OpenAI LLM 챗봇 모델 설정
llm = ChatOpenAI(
    model_name="gpt-4o",  # 모델 이름
    temperature=0.2,  # 온도
    api_key=OPENAI_API_KEY)  # OpenAI API 키

# 5. LangGraph 설정
# 5-1. LangGraph 에이전트 클래스 정의
class AgentState(MessagesState):
    context: str  # 검색된 문서 컨텍스트
    conversation_history: Optional[List[Dict]] = None  # 대화 이력 저장
    debug_info: Optional[Dict] = None  # 디버깅 정보

# 5-2. LangGraph 에이전트 검색 정의
class SearchDocumentsTool(BaseTool):
    name: str = "search_documents"  # 도구 이름
    description: str = "갤럭시 S25 매뉴얼에서 관련 정보를 검색합니다."  # 도구 설명

    def analyze_image_relevance(self, image_url, query_text):
        try:
            query_embedding = cohere_embeddings.embed_query(query_text)  # 쿼리 임베딩 생성
            
            img_embedding = None  # 이미지 임베딩 저장
            try:
                resp = client.table("image_embeddings").select("embedding,metadata").eq("metadata->>image_url", image_url).execute()  #
                if resp and resp.data and len(resp.data) > 0:  #
                    if 'embedding' in resp.data[0]:  #
                        embedding_str = resp.data[0]['embedding']  # 임베딩 문자열 추출
                        if isinstance(embedding_str, str):  #
                            try:
                                embedding_str = embedding_str.replace(" ", "")  # 공백 제거
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
            
            return result
        except Exception as e:
            print(f"이미지 분석 오류: {str(e)}")
            return {
                "vertical_position": 0.5,  # 기본값
                "relevance_score": 0.5,  # 기본 관련성 점수
                "embedding_similarity": 0.5
            }
    
    def get_all_page_images(self, page, query_text):
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
                    img_analysis = self.analyze_image_relevance(img_url, query_text)
                    
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
    
    def _run(self, query: str) -> Tuple[str, Dict]:  # 검색 쿼리 처리
        normalized_query = query.strip().rstrip('.!?')  # 검색 쿼리 정규화
        
        debug_info = {  # 디버깅 정보 초기화
            "query": normalized_query,  # 검색 쿼리
            "results": [],  # 검색 결과 저장 
            "image_results": [],  # 이미지 검색 결과 저장
            "page_info": {},  # 페이지 정보 저장
            "vertical_position": {}  # 이미지 위치 정보 저장
        }
        
        try:
            # 1. 텍스트 검색 수행
            docs = hybrid_retriever.invoke(normalized_query)  # 검색 쿼리 처리
            
            if not docs:
                return "매뉴얼에서 관련 정보를 찾을 수 없습니다.", debug_info  # 검색 결과 반환
            
            # 2. 검색 결과에서 페이지 정보 추출
            page_info = {}  # 페이지 번호와 페이지별 점수
            page_numbers = []  # 페이지 번호 리스트
            
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
            
            # 3. 이미지 검색 - 주요 페이지에 대한 검색 수행
            all_images = []  # 모든 이미지 정보 저장

            # 상위 페이지들에 대해 이미지 검색 수행
            page_specific_queries = []

            # 페이지별 이미지 검색 쿼리 구성
            if top_pages:
                # 1. 전체 쿼리로 모든 이미지 검색
                page_specific_queries.append((normalized_query, None))
                
                # 2. 상위 3개 페이지에 대한 페이지별 검색
                for page in top_pages[:3]:
                    page_specific_queries.append((f"{normalized_query} 페이지 {page}", page))

            # 각 쿼리에 대해 이미지 검색 수행
            for query, page_filter in page_specific_queries:
                # 이미지 검색 수행
                try:
                    image_docs = []
                    
                    # 페이지 특정 검색일 경우 해당 페이지로 필터링
                    if page_filter:
                        image_docs = vector_retriever.invoke(query, page_filter=page_filter)
                    else:
                        # 일반 검색은 더 많은 결과 가져오기 - 여기 수정
                        image_docs = vector_retriever.invoke(query)
                        
                        # 여전히 이미지가 없으면 마지막 시도: 직접 테이블에서 검색된 페이지의 이미지만 가져오기
                        if not any(doc.metadata.get('image_url') for doc in image_docs):
                            try:
                                # 디버그 모드 여부 확인을 위한 함수 추가
                                def is_debug_mode():
                                    # __main__ 모듈에 debug_mode 변수가 있으면 가져옴
                                    return debug_mode if 'debug_mode' in globals() else False
                                
                                # 디버그 모드일 때만 출력
                                if is_debug_mode():
                                    print(f"\n✅ 이미지 탐색: 페이지 {top_pages}에 해당하는 이미지만 직접 가져오기")
                                
                                # 메타데이터 필드 중 page 필드가 top_pages 중 하나와 일치하는 레코드 검색
                                for page in top_pages:
                                    try:
                                        # 메타데이터에서 페이지가 일치하는 레코드 검색 (올바른 방법으로 수정)
                                        resp = client.table("image_embeddings").select("*").eq("metadata->>page", str(page)).execute()
                                        
                                        if resp and resp.data and len(resp.data) > 0:
                                            # 디버그 모드일 때만 출력
                                            if is_debug_mode():
                                                print(f"\n✅ 성공: 페이지 {page}에서 {len(resp.data)}개 이미지를 찾았습니다!")
                                            
                                            for item in resp.data:
                                                if 'metadata' in item and item['metadata'] and 'image_url' in item['metadata']:
                                                    img_url = item['metadata']['image_url']
                                                    img_page = item['metadata'].get('page', 'unknown')
                                                    
                                                    # 디버그 모드일 때만 출력
                                                    if is_debug_mode():
                                                        print(f"  ✓ 이미지(페이지 {img_page}): {img_url[:50]}...")
                                                    
                                                    # Document 객체 생성
                                                    doc = Document(
                                                        page_content="이미지 문서", 
                                                        metadata={
                                                            'image_url': img_url,
                                                            'page': img_page,
                                                            'is_page_match': True,
                                                            'score': float(1.0),  # 하드코딩된 값 수정
                                                            'relevance_score': float(0.5),  # 임베딩 분석 없이 기본값 설정
                                                            'source': 'direct_db_query'
                                                        }
                                                    )
                                                    image_docs.append(doc)
                                                    # 하나만 찾아도 충분
                                                    break
                                    except Exception as page_err:
                                        # 디버그 모드일 때만 출력
                                        if is_debug_mode():
                                            print(f"  페이지 {page} 검색 오류: {page_err}")
                                        
                                        # URL에 페이지 번호가 포함된 이미지 검색 시도
                                        try:
                                            # URL 패턴 검색
                                            resp = client.table("image_embeddings").select("*").ilike("metadata->>image_url", f"%p{page}%").execute()
                                            
                                            if resp and resp.data and len(resp.data) > 0:
                                                # 디버그 모드일 때만 출력
                                                if is_debug_mode():
                                                    pass
                                                
                                                for item in resp.data:
                                                    if 'metadata' in item and item['metadata'] and 'image_url' in item['metadata']:
                                                        img_url = item['metadata']['image_url']
                                                        
                                                        # 디버그 모드일 때만 출력
                                                        if is_debug_mode():
                                                            print(f"  ✓ URL 패턴 이미지(페이지 {page}): {img_url[:50]}...")
                                                        
                                                        # Document 객체 생성
                                                        doc = Document(
                                                            page_content="이미지 문서", 
                                                            metadata={
                                                                'image_url': img_url,
                                                                'page': page,  # 패턴에서 찾았으므로 검색한 페이지 번호 사용
                                                                'is_page_match': True,
                                                                'score': float(1.0),  # 하드코딩된 값 수정
                                                                'relevance_score': float(0.5),  # 임베딩 분석 없이 기본값 설정
                                                                'source': 'url_pattern_query'
                                                            }
                                                        )
                                                        image_docs.append(doc)
                                                        # 하나만 찾아도 충분
                                                        break
                                        except Exception as url_err:
                                            # 디버그 모드일 때만 출력
                                            if is_debug_mode():
                                                print(f"  페이지 {page} URL 패턴 검색 오류: {url_err}")
                                    
                                    # 이미지를 찾았는지 확인
                                    if not any(doc.metadata.get('image_url') for doc in image_docs):
                                        # 디버그 모드일 때만 출력
                                        if is_debug_mode():
                                            print("  ❌ 실패: 어떤 페이지에서도 이미지를 찾지 못했습니다.")
                                        
                                        # 마지막 대안: 이미지 테이블에서 아무 이미지나 5개 가져오기
                                        try:
                                            resp = client.table("image_embeddings").select("*").limit(5).execute()
                                            
                                            if resp and resp.data and len(resp.data) > 0:
                                                # 디버그 모드일 때만 출력
                                                if is_debug_mode():
                                                    pass
                                                
                                                for item in resp.data:
                                                    if 'metadata' in item and item['metadata'] and 'image_url' in item['metadata']:
                                                        img_url = item['metadata']['image_url']
                                                        img_page = item['metadata'].get('page', 'unknown')
                                                        
                                                        # Document 객체 생성
                                                        doc = Document(
                                                            page_content="이미지 문서", 
                                                            metadata={
                                                                'image_url': img_url,
                                                                'page': img_page,
                                                                'score': 1.0,  # 낮은 점수 부여
                                                                'relevance_score': 0.9,  # 관련성 점수 추가
                                                                'source': 'fallback_image'
                                                            }
                                                        )
                                                        image_docs.append(doc)
                                        except Exception as fallback_err:
                                            # 디버그 모드일 때만 출력
                                            if is_debug_mode():
                                                print(f"대안 이미지 검색 오류: {fallback_err}")
                            except Exception as direct_err:
                                # 디버그 모드일 때만 출력
                                if is_debug_mode():
                                    print(f"직접 데이터베이스 쿼리 오류: {direct_err}")
                    
                    # 검색된 이미지 정보 처리
                    for img_doc in image_docs:
                        if 'image_url' in img_doc.metadata:
                            # 이미지 URL과 메타데이터 추출
                            url = img_doc.metadata['image_url']
                            
                            # 이미 처리된 URL인지 확인 (중복 방지)
                            if any(img["url"] == url for img in all_images):
                                continue
                            
                            # 페이지 정보 추출
                            img_page = None
                            if "page" in img_doc.metadata:
                                img_page = str(img_doc.metadata["page"])
                            
                            # 페이지 정보가 없으면 URL에서 추출 시도
                            if not img_page:
                                for pattern in [
                                    r"p(\d+)", r"page(\d+)", r"_(\d+)_", r"_(\d+)\.", 
                                    r"-(\d+)-", r"-(\d+)\.", r"/(\d+)/", r"(\d+)\.jpg",
                                    r"_p(\d+)_", r"p(\d+)_", r"_p(\d+)\.", r"figure_p(\d+)"
                                ]:
                                    page_matches = re.findall(pattern, url.lower())
                                    if page_matches:
                                        img_page = page_matches[0]
                                        break
                            
                            # 여전히 페이지 정보가 없으면 JSON 메타데이터에서 추출 시도
                            if not img_page and 'metadata' in img_doc.metadata and img_doc.metadata['metadata']:
                                try:
                                    meta_json = json.loads(img_doc.metadata['metadata'])
                                    if 'page' in meta_json:
                                        img_page = str(meta_json['page'])
                                except:
                                    pass
                            
                            # URL에 페이지 번호가 포함되어 있는지 확인
                            is_page_match = False
                            if img_page and img_page in top_pages:
                                is_page_match = True
                            
                            # 점수 계산 (개선된 방식)
                            url_match_score = 0.7 if is_page_match else 0.1  # 페이지 매칭 점수 증가
                            text_match_score = min(0.5, float(img_doc.metadata.get('similarity', 0)))
                            
                            # 최종 점수 계산
                            image_score = url_match_score + text_match_score
                            
                            # 이미지 정보 저장
                            image_info = {
                                "url": url,
                                "page": img_page,
                                "is_page_match": is_page_match,
                                "text_similarity": float(img_doc.metadata.get('similarity', 0)),
                                "vertical_position": 0.5,  # 기본값
                                "score": image_score,
                                "search_query": query
                            }
                            # fallback으로 score값을 relevance_score에도 기록해 두자
                            image_info["relevance_score"] = image_score
                            
                            all_images.append(image_info)
                except Exception as e:
                    debug_info["image_search_error"] = str(e)
                    import traceback
                    debug_info["image_search_traceback"] = traceback.format_exc()
            
            # 4. 이미지 정보 처리 및 상위 이미지 선택
            best_images = []  # 여러 이미지 저장용 리스트로 변경
            best_image_scores = []
            
            if all_images:
                # 이미지 검색 결과 디버깅
                debug_info["found_images"] = len(all_images)
                debug_info["image_pages"] = [img.get("page") for img in all_images if img.get("page")]
                
                # 페이지 매칭 필터링 강화
                # 1. 검색된 페이지와 일치하는 이미지만 필터링
                matched_images = [img for img in all_images if str(img.get("page")) in [str(p) for p in top_pages]]
                
                # 2. 일치하는 이미지가 있으면 해당 이미지 중에서 선택
                if matched_images:
                    # 디버그 모드일 때만 출력
                    if 'debug_mode' in globals() and debug_mode:
                        pass
                    
                    sorted_images = sorted(matched_images, key=lambda x: x["score"], reverse=True)
                    
                    # 페이지별 이미지 그룹화
                    page_groups = {}
                    for img in sorted_images:
                        if img.get("page"):
                            page = str(img.get("page"))
                            if page not in page_groups:
                                page_groups[page] = []
                            page_groups[page].append(img)
                    
                    # 베스트 페이지의 모든 이미지 가져오기
                    if page_groups:
                        # 점수가 가장 높은 이미지의 페이지
                        best_page = sorted_images[0].get("page")
                        
                        # 해당 페이지의 모든 이미지 가져오기 - 클래스 메서드로 호출
                        all_page_images = self.get_all_page_images(best_page, normalized_query)
                        
                        # 기존 검색 결과와 합치기
                        if best_page in page_groups:
                            existing_urls = [img["url"] for img in page_groups[best_page]]
                            for img in all_page_images:
                                if img["url"] not in existing_urls:
                                    page_groups[best_page].append(img)
                        
                        # 가장 관련성 높은 최대 3개 이미지 선택
                        if best_page in page_groups:
                            page_images = sorted(
                                page_groups[best_page],
                                key=lambda x: x.get("relevance_score", x.get("score", 0)),  # relevance_score가 없으면 score 사용
                                reverse=True
                            )
                            best_images = page_images[:3]  # 최대 3개
                            best_image_scores = [img["score"] for img in best_images]
                            
                            # 검색 결과 텍스트와 이미지 임베딩의 관련성 평가 추가
                            if len(best_images) > 0:
                                try:
                                    # 검색 결과 텍스트 추출
                                    result_texts = []
                                    if docs:
                                        result_texts = [doc.page_content for doc in docs[:3]]  # 상위 3개 문서만 사용
                                    
                                    if result_texts:
                                        # 결과 텍스트 합치기
                                        combined_text = " ".join(result_texts)
                                        
                                        # 각 이미지별로 텍스트와의 관련성 점수 계산
                                        for img in best_images:
                                            # 이미지 URL에서 임베딩 가져오기
                                            img_result = self.analyze_image_relevance(img["url"], combined_text)
                                            # 텍스트 관련성 점수 업데이트
                                            img["text_relevance"] = float(img_result.get("relevance_score", 0.5))
                                            # relevance_score 값을 text_relevance로 업데이트하여 최종 결과에 정확히 표시되도록 함
                                            img["relevance_score"] = float(img["text_relevance"])
                                            
                                            # 디버그 모드일 때만 출력
                                            if 'debug_mode' in globals() and debug_mode:
                                                print(f"\n✅ 이미지 텍스트 관련성 계산: {img['url'][-10:]}, 매칭: {img.get('score', 0):.4f}, 텍스트 관련성: {img.get('text_relevance', 0):.4f}")
                                            
                                            # 이미지가 2개 이상인 경우에만 정렬 (1개면 그대로 유지)
                                            if len(best_images) > 1:
                                                # 텍스트 관련성 점수 기준으로 재정렬
                                                best_images = sorted(best_images, key=lambda x: float(x.get("text_relevance", x.get("relevance_score", 0))), reverse=True)
                                            
                                            # 디버그 정보에 텍스트 관련성 점수 추가
                                            debug_info["text_relevance_scores"] = {
                                                img["url"]: img.get("text_relevance", 0) for img in best_images
                                            }
                                            debug_info["score_calculation"] = "텍스트 관련성 점수 기준으로 이미지 선택됨"
                                            debug_info["text_comparison_result"] = "텍스트와 이미지 관련성 비교 완료"
                                            
                                            # 이미지 수에 따른 메시지 출력
                                            if len(best_images) > 1:
                                                # 디버그 모드일 때만 출력
                                                if 'debug_mode' in globals() and debug_mode:
                                                    print(f"   ✓ 검색 결과 텍스트와 이미지 관련성 비교 완료, 텍스트 관련성 기준으로 최적 이미지 선택됨")
                                            else:
                                                # 디버그 모드일 때만 출력
                                                if 'debug_mode' in globals() and debug_mode:
                                                    print(f"검색 결과 텍스트와 단일 이미지의 관련성 분석 완료")
                                except Exception as compare_err:
                                    # 디버그 모드일 때만 출력
                                    if 'debug_mode' in globals() and debug_mode:
                                        print(f"텍스트-이미지 비교 중 오류: {str(compare_err)}")
                                    debug_info["text_comparison_error"] = str(compare_err)
                else:
                    # 일치하는 이미지가 없으면 전체 이미지 중에서 선택
                    # 디버그 모드일 때만 출력
                    if 'debug_mode' in globals() and debug_mode:
                        print(f"✅ 검색된 페이지와 일치하는 이미지가 없음. 전체 {len(all_images)}개 이미지에서 선택")
                    
                    sorted_images = sorted(all_images, key=lambda x: x["score"], reverse=True)
                    if sorted_images:
                        best_images = [sorted_images[0]]
                        best_image_scores = [sorted_images[0]["score"]]
                        
                        # 일치하는 이미지가 없는 경우에도 텍스트 관련성 분석 추가
                        try:
                            # 검색 결과 텍스트 추출
                            result_texts = []
                            if docs:
                                result_texts = [doc.page_content for doc in docs[:3]]  # 상위 3개 문서만 사용
                            
                            if result_texts:
                                # 결과 텍스트 합치기
                                combined_text = " ".join(result_texts)
                                
                                # 이미지의 텍스트와의 관련성 점수 계산
                                img = best_images[0]
                                img_result = self.analyze_image_relevance(img["url"], combined_text)
                                img["text_relevance"] = float(img_result.get("relevance_score", 0.5))
                                # relevance_score 값을 text_relevance로 업데이트하여 최종 결과에 정확히 표시되도록 함
                                img["relevance_score"] = float(img["text_relevance"])
                                # 디버그 모드일 때만 출력
                                if 'debug_mode' in globals() and debug_mode:
                                    print(f"일치하지 않는 이미지 텍스트 관련성 계산: {img['url'][-10:]}, 관련성: {img['text_relevance']:.4f}")
                                
                                # 디버그 정보에 텍스트 관련성 점수 추가
                                debug_info["text_relevance_scores"] = {
                                    img["url"]: img.get("text_relevance", 0) for img in best_images
                                }
                        except Exception as compare_err:
                            # 디버그 모드일 때만 출력
                            if 'debug_mode' in globals() and debug_mode:
                                print(f"일치하지 않는 이미지 관련성 분석 오류: {str(compare_err)}")
                            debug_info["non_matching_comparison_error"] = str(compare_err)
            
            # 이미지가 하나 이상 선택되었는지 확인
            if best_images:
                best_image = best_images[0]  # 기존 호환성 유지
                best_image_score = best_image["score"]
                
                # 페이지 매칭 정보 추가
                best_image["is_page_match"] = str(best_image.get("page")) in [str(p) for p in top_pages]
                
                for img in best_images:
                    img["is_page_match"] = str(img.get("page")) in [str(p) for p in top_pages]
                
                # 일치하지 않는 경우 경고 출력
                if not best_image["is_page_match"]:
                    # 디버그 모드일 때만 출력
                    if 'debug_mode' in globals() and debug_mode:
                        print(f"⚠️ 경고: 선택된 이미지(페이지 {best_image.get('page')})는 검색된 페이지({top_pages})와 일치하지 않습니다.")
                
                # 페이지 매칭 관련 디버그 정보 추가
                debug_info["best_image_matches_search_page"] = best_image["is_page_match"]
                debug_info["best_images_count"] = len(best_images)
                
                # 이미지 목록 디버그 정보에 추가
                debug_info["best_images"] = best_images
                debug_info["best_image_scores"] = best_image_scores
                
                # 위치 정보 (있을 경우)
                position_value = best_image.get("vertical_position", 0.5)
                if position_value < 0.3:
                    position_text = "위쪽"
                elif position_value > 0.7:
                    position_text = "아래쪽"
                else:
                    position_text = "중간"
                
                # 디버그 모드일 때만 출력
                if 'debug_mode' in globals() and debug_mode:
                    pass
                    # 페이지 일치 여부
                    is_matched = img.get("is_page_match", False)
                    pass
                    
                    # 페이지 불일치 시 추가 디버깅
                    if not is_matched:
                        print(f"이미지 페이지: {img['page']}, 검색된 페이지: {state['debug_info']['page_numbers']}")

            # 5. 최종 결과 구성
            result_text = ""
            
            # 최적의 페이지 기준으로 결과 재정렬
            top_page = top_pages[0] if top_pages else None
            
            # 가장 좋은 이미지가 있으면 그 페이지를 최상위로
            if best_images:
                top_page = best_images[0]["page"]
            
            # 해당 페이지 문서를 상위로 재정렬
            reordered_docs = []
            for doc in docs:
                doc_page = None
                if "page" in doc.metadata:
                    doc_page = str(doc.metadata["page"])
                
                if doc_page == top_page:
                    reordered_docs.insert(0, doc)
                else:
                    reordered_docs.append(doc)
            
            # 결과가 5개 이상이면 5개로 제한
            if len(reordered_docs) > 5:
                reordered_docs = reordered_docs[:5]
            
            # 참조 페이지 목록 저장
            reference_pages = []
            for doc in reordered_docs:
                if "page" in doc.metadata:
                    page = str(doc.metadata["page"])
                    if page not in reference_pages:
                        reference_pages.append(page)
            
            # 텍스트 결과 구성
            for i, doc in enumerate(reordered_docs):
                result_text += f"내용: {doc.page_content}\n"
                result_text += f"카테고리: {doc.metadata.get('category','없음')}\n"
                result_text += f"페이지: {doc.metadata.get('page','없음')}\n"
                
                # 첫 번째 문서에 이미지들 추가 (최소 관련성 점수 기준 추가)
                if i == 0 and best_images:
                    # 관련성 점수 및 매칭 점수 임계값 설정 (변경: 0.4 -> 0.5, 매칭 점수 0.6 추가)
                    relevance_threshold = 0.5
                    matching_threshold = 0.6
                    
                    # 두 임계값을 모두 만족하는 이미지만 필터링
                    filtered_images = [img for img in best_images 
                                      if float(img.get("text_relevance", img.get("relevance_score", 0))) >= relevance_threshold 
                                      and img.get("score", 0) >= matching_threshold]
                    
                    # 임계값을 넘는 이미지가 있는 경우에만 이미지 추가
                    if filtered_images:
                        # 모든 베스트 이미지 URL 추가
                        for j, img in enumerate(filtered_images):
                            result_text += f"[이미지 {j+1}]"
                            if j == 0:
                                result_text += " 👑 텍스트와 가장 관련성 높은 이미지"
                            result_text += f"\n{img['url']}\n"
                            result_text += f"페이지: {img.get('page', '알 수 없음')}\n"
                            
                            # 관련성 점수가 낮은 경우 명시적으로 표시 (변경: 조건 수정)
                            relevance_score = float(img.get('text_relevance', img.get('relevance_score', 0)))
                            match_score = float(img.get('score', 0))

                            if relevance_score < 0.65 or match_score < 0.7:
                                result_text += f"[참고: 이 이미지는 질문과의 관련성이 다소 낮을 수 있습니다. 관련성 점수: {relevance_score:.4f}, 매칭 점수: {match_score:.4f}]\n"
                            elif relevance_score >= 0.8:
                                result_text += f"[이 이미지는 질문과 매우 관련성이 높습니다. 관련성 점수: {relevance_score:.4f}, 매칭 점수: {match_score:.4f}]\n"
                            else:
                                result_text += f"[이미지 {j+1} 관련성 점수: {relevance_score:.4f}, 매칭 점수: {match_score:.4f}]\n"
                    else:
                        # 낮은 관련성으로 인해 이미지를 표시하지 않음을 기록
                        debug_info["images_filtered_due_to_low_relevance"] = True
                
                result_text += "\n"
                
                # 디버그 정보 저장
                item = {
                    "rank": i+1,
                    "source": doc.metadata.get("source", "알 수 없음"),
                    "score": float(doc.metadata.get("score", 0)),
                    "page": doc.metadata.get("page", "없음"),
                    "category": doc.metadata.get("category", "없음"),
                    "section": doc.metadata.get("section", "없음"),
                    "preview": doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
                }
                
                # 이미지 정보 추가
                if i == 0 and best_images:
                    item["images"] = []
                    for img in best_images:
                        item["images"].append({
                            "url": img["url"],
                            "page": img.get("page", "알 수 없음"),
                            "score": float(img["score"]),
                            "relevance_score": float(img.get("text_relevance", img.get("relevance_score", 0)))
                        })
                
                debug_info["results"].append(item)
            
            # 베스트 이미지가 없는 경우에 추가 이미지 검색 시도 - 삭제 (요청 1번)
            # 기존 코드 제거 (추가 이미지 검색 코드 전체 제거)

            # 참조 페이지 정보 추가
            if reference_pages:
                reference_pages.sort()
                
                # 주요 페이지만 표시 (최대 2개)
                if len(reference_pages) > 2:
                    main_pages = reference_pages[:2]
                    reference_text = "\n\n💡 추가 정보가 필요하면 매뉴얼의 관련 섹션을 참고해보세요."
                else:
                    reference_text = "\n\n💡 이 기능에 대해 더 알고 싶으시면 매뉴얼의 관련 섹션을 참고해보세요."
                
                result_text += reference_text
                debug_info["reference_pages"] = reference_pages

            # 이미지 검색 결과 디버깅 정보 개선 (추가)
            if not best_images:
                debug_info["no_image_reason"] = "이미지를 찾지 못했거나 검색된 페이지와 일치하는 이미지가 없음"
                
                # 검색된 모든 이미지 페이지 정보 저장
                all_image_pages = []
                for img in all_images:
                    if "page" in img:
                        all_image_pages.append(img["page"])
                
                if all_image_pages:
                    debug_info["found_image_pages"] = all_image_pages
                    debug_info["found_images_count"] = len(all_images)
                    
                    # 페이지 불일치 확인
                    debug_info["page_mismatch"] = all(str(p) not in top_pages for p in all_image_pages)
                    debug_info["found_pages_not_in_search"] = True

            return result_text, debug_info  # 검색 결과 반환
            
        except Exception as e:  # 오류 처리
            import traceback
            debug_info["error"] = str(e)
            debug_info["traceback"] = traceback.format_exc()
            return "검색 중 오류가 발생했습니다: " + str(e), debug_info  # 오류 반환

# 5-3. LangGraph 에이전트 노드 구성
workflow = StateGraph(AgentState)  # 상태 그래프 생성

# 5-4. LangGraph 에이전트 노드 정의
def agent_node_fn(state: AgentState):
    if state.get("conversation_history") is None:  # 대화 이력이 없으면
        state["conversation_history"] = []  # 대화 이력 초기화
    
    if state.get("debug_info") is None:  # 디버깅 정보가 없으면
        state["debug_info"] = {}  # 디버깅 정보 초기화
    
    last_query = state["messages"][-1].content if state["messages"] else ""  # 마지막 질문 추출
    
    # 1) 컨텍스트 비어 있으면 도구 호출 결과 필요함을 반환
    if not state.get("context"):  # 컨텍스트가 없으면 검색 필요
        return {"messages": state["messages"], "context": None, "conversation_history": state["conversation_history"], "debug_info": state.get("debug_info", {})}  # 검색 결과 반환

    # 2) 이전 대화 내용 추가 - 최대 5개 대화로 확장
    conversation_context = ""  # 대화 컨텍스트 초기화
    if state["conversation_history"]:  # 대화 이력이 있으면
        conversation_context = "이전 대화 내용:\n"  # 대화 컨텍스트 추가
        for i, exchange in enumerate(state["conversation_history"][-5:]):  
            conversation_context += f"[대화 {i+1}]\n"  # 대화 번호 추가
            conversation_context += f"사용자: {exchange['user']}\n"  # 사용자 메시지 추가
            if "ai" in exchange:  # AI 메시지가 있으면
                conversation_context += f"도우미: {exchange['ai']}\n"  # AI 메시지 추가
    
    # 참조 페이지 추출
    reference_pages = []
    if "reference_pages" in state.get("debug_info", {}):
        reference_pages = state["debug_info"]["reference_pages"]
    
    # 3) 컨텍스트가 있으면 LLM으로 최종 답변 - 프롬프트 개선
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
    {state['context']}

    사용자 질문: {last_query}

    위 참고 정보를 바탕으로 상세하고 친절하게 답변해 주세요.  
    내용이 부족하다면 관련된 추가 팁이나 조언도 함께 제공하세요.
    """
    
    response = llm.invoke([HumanMessage(content=prompt)])  # LLM 호출
    ai_msg = response if isinstance(response, AIMessage) else AIMessage(content=response)  # AI 메시지 생성
    
    # 매뉴얼 페이지 참조 문구 추가 (이미 포함되어 있지 않은 경우에만)
    if reference_pages and "매뉴얼의 관련 섹션" not in ai_msg.content and "더 알고 싶으시면" not in ai_msg.content:
        reference_pages.sort()
        
        # 문맥에 맞는 자연스러운 안내문 생성
        if "설정" in last_query.lower() or "방법" in last_query.lower():
            reference_text = "\n\n💡 이 설정에 대해 더 자세히 알고 싶으시면 매뉴얼의 관련 섹션을 참고해보세요."
        elif "기능" in last_query.lower() or "사용" in last_query.lower():
            reference_text = "\n\n💡 이 기능의 추가 옵션과 활용법은 매뉴얼에서 더 자세히 확인하실 수 있습니다."
        else:
            reference_text = "\n\n💡 더 자세한 정보가 필요하시면 매뉴얼의 관련 섹션을 참고해보세요."
        
        ai_msg = AIMessage(content=ai_msg.content + reference_text)
    
    # 4) 대화 이력에 현재 교환 추가
    state["conversation_history"].append({  # 대화 이력에 현재 교환 추가
        "user": last_query,  # 사용자 메시지
        "ai": ai_msg.content})  # AI 메시지
    
    # 5) 대화 이력이 너무 길어지면 오래된 대화 제거 (최대 10개 유지)
    if len(state["conversation_history"]) > 10:  # 대화 이력이 10개 이상이면
        state["conversation_history"] = state["conversation_history"][-10:]  # 최근 10개 대화만 유지
    
    # 6) 베스트 이미지 정보를 응답 아래에 추가 (디버깅 모드가 아니더라도)
    if state.get("debug_info") and "best_images" in state.get("debug_info") and state["debug_info"]["best_images"]:
        best_images = state["debug_info"]["best_images"]
        img_info_text = "\n\n"
        
        for i, img in enumerate(best_images[:3]):  # 최대 3개까지만 표시
            relevance_score = float(img.get('text_relevance', img.get('relevance_score', 0)))
            match_score = float(img.get('score', 0))
            
            # 이전 이미지가 있으면 줄바꿈 한 번만 추가
            if i > 0:
                img_info_text += "\n"
            
            # 첫 번째 이미지이고 여러 이미지가 있는 경우 👑 표시 추가
            if i == 0 and len(best_images) > 1:
                img_info_text += f"[이미지 {i+1}] 👑 텍스트와 가장 관련성 높은 이미지\n{img['url']}\n"
            else:
                img_info_text += f"\n[이미지 {i+1}]\n{img['url']}\n"
                
            img_info_text += f"페이지: {img.get('page', '알 수 없음')}\n"
            img_info_text += f"관련성 점수: {relevance_score:.4f}, 매칭 점수: {match_score:.4f}"
            
            # 이미지 관련성에 대한 설명 추가
            if relevance_score < 0.65 or match_score < 0.7:
                img_info_text += " (낮은 관련성)"
            elif relevance_score >= 0.8:
                img_info_text += " (높은 관련성)"
            else:
                img_info_text += " (중간 관련성)"
        
        ai_msg = AIMessage(content=ai_msg.content + img_info_text)

    return {
        "messages": state["messages"] + [ai_msg],  # 메시지 업데이트
        "context": state["context"],  # 컨텍스트 유지
        "conversation_history": state["conversation_history"],  # 대화 이력 유지
        "debug_info": state.get("debug_info")}  # 디버깅 정보 유지

# 5-5. LangGraph 에이전트 검색 정의
def search_docs_node(state: AgentState):
    last_query = state["messages"][-1].content if state["messages"] else ""  # 마지막 질문 추출
    search_tool = SearchDocumentsTool()  # 검색 도구 생성
    result, debug_info = search_tool._run(last_query)  # 검색 도구 호출
    
    return {
        "messages": state["messages"],  # 메시지 유지
        "context": result,  # 검색 결과 저장
        "conversation_history": state.get("conversation_history", []),  # 대화 이력 유지
        "debug_info": debug_info}  # 디버깅 정보 저장

# 5-6. LangGraph 에이전트 노드 추가
workflow.add_node("agent", agent_node_fn)  # 에이전트 노드 추가
workflow.add_node("search_docs", search_docs_node)  # 검색 노드 추가

# 5-7. LangGraph 조건 함수 정의
def should_search(state: AgentState):
    return state.get("context") is None  # 컨텍스트가 없으면 검색 필요

# 5-8. LangGraph 엣지 연결
workflow.add_edge(START, "agent")  # 시작 노드에서 에이전트 노드로 엣지 추가
workflow.add_conditional_edges(
    "agent",  # 에이전트 노드
    should_search,  # 조건 함수
    {True: "search_docs", False: END})  # 검색 노드로 엣지 추가
    
workflow.add_edge("search_docs", "agent")  # 검색 노드에서 에이전트 노드로 엣지 추가

# 5-9. LangGraph 컴파일 및 초기 상태
memory_saver = MemorySaver()  # 메모리 저장 체크포인터
compiled_graph = workflow.compile(checkpointer=memory_saver)  # 컴파일
thread_id = str(uuid.uuid4())  # 스레드 ID 생성
state = {"messages": [], "context": "", "conversation_history": [], "debug_info": {}}  # 초기 상태에 debug_info 추가
config = {"configurable": {"thread_id": thread_id}}  # 스레드 ID 설정

# 6. 대화형 인터페이스 실행
if __name__ == "__main__":
    print("\n=== 삼성 갤럭시 S25 매뉴얼 도우미 ===")
    print("(종료: q 또는 quit)")
    print("(디버그 모드 설정: d 또는 debug)")
    print("(대화 이력 초기화: r 또는 reset)")
    
    debug_mode = False
    available_commands = {
        "q": "종료", "quit": "종료",
        "d": "디버그", "debug": "디버그",
        "r": "초기화", "reset": "초기화"}
     
    while True:
        q = input("\n[질문]: ")
        q_lower = q.lower().strip()
        
        if q_lower in available_commands:
            command_type = available_commands[q_lower]
            
            if command_type == "종료":
                print("매뉴얼 도우미를 종료합니다. 좋은 하루 되세요!")
                break
                
            elif command_type == "디버그":
                debug_mode = not debug_mode
                print(f"디버그 모드: {'활성화' if debug_mode else '비활성화'}")
                continue
                
            elif command_type == "초기화":
                state = {"messages": [], "context": "", "conversation_history": [], "debug_info": {}}
                print("대화 이력이 초기화되었습니다.")
                continue
        
        if q_lower.startswith("r") or q_lower.startswith("d") or q_lower.startswith("q"):
            if q_lower not in available_commands:
                print(f"'{q}'은(는) 알 수 없는 명령어입니다. 도움이 필요하시면 질문을 입력해주세요.")
                continue

        state["messages"].append(HumanMessage(content=q))
        try:
            state["context"] = ""
            res = compiled_graph.invoke(state, config=config)
            state = res
            
            last_ai = next((m for m in reversed(state["messages"]) if isinstance(m, AIMessage)), None)
            if last_ai:
                print(f"\n[답변]: {last_ai.content}")
                
            if debug_mode and state.get("debug_info"):
                print("\n===== 검색 결과 디버깅 정보 =====")
                
                # 페이지 정보 출력
                if "page_numbers" in state["debug_info"]:
                    print(f"✅ 검색된 페이지: {', '.join(state['debug_info']['page_numbers'])}")
                
                # 오류 발생 시 예외 처리를 위해 try-except 블록 추가
                try:
                    # 이미지 정보 출력
                    if "best_images" in state["debug_info"] and state["debug_info"]["best_images"]:
                        best_images = state["debug_info"]["best_images"]
                        print(f"\n===== 베스트 이미지 정보 ({len(best_images)}개) =====")
                        
                        for i, img in enumerate(best_images):
                            # 이전 이미지와 구분하기 위해 빈 줄 추가 (두 번째 이미지부터)
                            if i > 0:
                                print()
                                
                            print(f"✅ [이미지 {i+1}]")
                            print(f"✅ {img['url']}")
                            print(f"✅ 페이지: {img['page']}")
                            print(f"✅ 매칭 점수: {img['score']:.4f}")
                            
                            # 텍스트 관련성 점수 표시 추가
                            if "text_relevance" in img:
                                print(f"✅ 텍스트 관련성 점수: {img['text_relevance']:.4f}")
                                # 최상위 텍스트 관련성 이미지 강조 표시 - 이미지가 여러 개일 때만 표시
                                if i == 0 and len(best_images) > 1:
                                    print("👑 텍스트와 가장 관련성 높은 이미지")
                    
                    # 텍스트 관련성 점수 비교 결과 표시
                    if "text_relevance_scores" in state["debug_info"]:
                        print("\n===== 텍스트 관련성 비교 결과 =====")
                        for url, score in state["debug_info"]["text_relevance_scores"].items():
                            short_url = url[:50] + "..." if len(url) > 50 else url
                            print(f"✅ {short_url}: {score:.4f}")
                    
                    # 검색 결과 요약 출력
                    if "results" in state["debug_info"]:
                        print("\n===== 검색 결과 요약 =====")
                        results = state["debug_info"]["results"]
                        
                        for i, result in enumerate(results):
                            try:
                                # 필요한 키가 있는지 안전하게 확인
                                preview = result.get('preview', '내용 없음')
                                source = result.get('source', '알 수 없음')
                                score = result.get('score', 0.0)
                                print(f"[{i+1}] [{source}] {preview} (점수: {score:.4f})")
                                
                                # 이미지 관련 정보가 있으면 출력
                                if 'images' in result:
                                    for j, img in enumerate(result['images']):
                                        img_url = img.get('url', '없음')
                                        img_page = img.get('page', '없음')
                                        img_score = img.get('score', 0.0)
                                        rel_score = img.get('relevance_score', 0.0)
                                        print(f"   - 이미지 {j+1}: 페이지 {img_page}, 점수: {img_score:.2f}, 관련성: {rel_score:.2f}")
                            except Exception as ke:
                                print(f"디버깅 정보 출력 오류: {str(ke)}")
                                
                except Exception as debug_err:
                    print(f"\n===== 이미지 정보 디버깅 오류 =====")
                    print(f"오류: {str(debug_err)}")
                
                print("==================================\n")
                
        except Exception as e:
            print(f"오류 발생: {str(e)}")
            print("죄송합니다. 질문을 처리하는 중 문제가 발생했습니다. 다시 시도해 주세요.")
            
            state = {
                "messages": [HumanMessage(content=q)], 
                "context": "",
                "conversation_history": state.get("conversation_history", []),
                "debug_info": {}  # 오류 발생 시 debug_info 초기화
            }
            continue

# 이미지 URL에서 PDF 파일명 추출 함수 추가
def extract_pdf_path_from_url(image_url):
    """이미지 URL에서 PDF 파일명을 추출합니다."""
    try:
        # URL에서 PDF 파일명이 포함된 패턴 찾기
        pdf_pattern = re.search(r'([\w\-]+\.pdf)', image_url.lower())
        if pdf_pattern:
            return pdf_pattern.group(1)
            
        # 페이지 번호가 포함된 패턴에서 PDF 추론하기
        page_pattern = re.search(r'p(\d+)', image_url.lower())
        if page_pattern:
            page_num = page_pattern.group(1)
            return f"galaxy_s25_manual_p{page_num}.pdf"
            
        return None
    except Exception as e:
        print(f"PDF 경로 추출 오류: {str(e)}")
        return None